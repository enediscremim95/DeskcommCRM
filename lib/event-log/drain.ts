/**
 * Cron driver genérico do event_log — a peça prometida em dispatcher.ts.
 *
 * Seleciona SÓ event_types com handler registrado: tipos drenados por crons
 * dedicados (ex. ai_agent.dispatch_requested → agent-dispatcher) não têm
 * handler no registry e ficam intocados.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchEvent, getRegisteredHandlers, type EventRow } from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";

export const EVENT_LOG_MAX_ATTEMPTS = 5;

/** Depois disto, um evento em `processing` é considerado órfão e volta à fila. */
const PROCESSING_STALE_MS = 10 * 60 * 1000;

export interface DrainSummary {
  /**
   * Os `skipped` COM motivo, para o resumo poder ser lido de fora do banco.
   *
   * Opcional de propósito: quem monta um `DrainSummary` literal (por exemplo
   * `tests/unit/event-log-drain-loop.test.ts`) não precisa mudar.
   */
  pulados?: string[];
  scanned: number;
  done: number;
  retried: number;
  failed: number;
  dead: number;
}

function backoffAt(attempts: number): string {
  // 1min, 2min, 4min, 8min... (2^n minutos)
  const minutes = Math.pow(2, attempts);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

interface StuckEventRow {
  id: string;
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

export interface StuckEventRecoverySummary {
  requeued: number;
  dead: number;
}

/**
 * Recupera leases abandonados por qualquer consumidor do `event_log`.
 *
 * Uma queda conta como tentativa. Sem isso, o mesmo evento pode derrubar o
 * processo, voltar a `pending` com o mesmo contador e repetir para sempre.
 */
export async function recoverStuckEvents(
  admin: SupabaseClient,
  now = new Date(),
): Promise<StuckEventRecoverySummary> {
  const summary = { requeued: 0, dead: 0 };
  const cutoff = new Date(now.getTime() - PROCESSING_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("event_log")
    .select("id, attempts, last_error, updated_at")
    .eq("status", "processing")
    .lt("updated_at", cutoff);

  if (error) {
    logger.error("[event-log.drain] falha ao procurar eventos presos", { error: error.message });
    return summary;
  }

  for (const raw of data ?? []) {
    const row = raw as unknown as StuckEventRow;
    const attempts = Math.max(0, row.attempts) + 1;
    const dead = attempts >= EVENT_LOG_MAX_ATTEMPTS;
    const recoveryError = dead
      ? `derrubou o processo repetidamente; encerrado após ${attempts} tentativas`
      : `processamento interrompido pela queda do processo; tentativa ${attempts}/${EVENT_LOG_MAX_ATTEMPTS}`;
    const lastError = row.last_error
      ? `${row.last_error}; ${recoveryError}`
      : recoveryError;

    // CAS pelo estado e pelo instante do claim. Se outro dreno já recuperou a
    // linha, esta atualização não toca nada e não conta duas tentativas.
    const { data: recovered } = await admin
      .from("event_log")
      .update({
        status: dead ? "dead" : "pending",
        attempts,
        last_error: lastError,
        next_attempt_at: null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "processing")
      .eq("updated_at", row.updated_at)
      .select("id");

    if (!recovered?.length) continue;
    summary[dead ? "dead" : "requeued"] += 1;
  }

  if (summary.requeued || summary.dead) {
    logger.warn("[event-log.drain] eventos presos em processing recuperados", summary);
  }
  return summary;
}

export async function drainEventLog(
  admin: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<DrainSummary> {
  const limit = opts.limit ?? 50;
  const summary: DrainSummary = {
    scanned: 0,
    done: 0,
    retried: 0,
    failed: 0,
    dead: 0,
    pulados: [],
  };

  const nowIso = new Date().toISOString();
  const recovered = await recoverStuckEvents(admin, new Date(nowIso));
  summary.dead += recovered.dead;

  const handledTypes = [...new Set(getRegisteredHandlers().flatMap((h) => h.events))];
  if (!handledTypes.length) return summary;

  const { data: rows, error } = await admin
    .from("event_log")
    // `created_at` viaja porque um consumidor não consegue distinguir "evento de
    // agora" de "evento de três dias parado em `pending`" sem ele — e o drain
    // leva 50 por tick sem janela de recência, então um backlog vira enxurrada
    // de efeitos com data errada no primeiro tick depois de um deploy.
    .select(
      "id, organization_id, event_type, entity_kind, entity_id, payload, metadata, consumed_by, attempts, created_at",
    )
    .eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .in("event_type", handledTypes)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("[event-log.drain] select failed", { error: error.message });

    return summary;
  }

  for (const raw of rows ?? []) {
    const row = raw as unknown as EventRow;
    summary.scanned += 1;

    // Claim otimista — outra instância pode ter pego a mesma linha.
    const { data: claimed } = await admin
      .from("event_log")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;

    const results = await dispatchEvent(row);

    const okKeys = results
      .filter((r) => r.status === "ok" || r.status === "skipped")
      .map((r) => r.consumer_key);
    const consumedBy = [...new Set([...row.consumed_by, ...okKeys])];
    const retry = results.find((r) => r.status === "retry");
    const errors = results.filter((r) => r.status === "error");

    if (retry) {
      // Reagendamento benigno (ex. janela anti-ban): NÃO conta attempt — mesmo
      // que outro handler do mesmo tick tenha retornado erro (esse handler
      // nunca entrou em consumed_by, então ele reroda no próximo tick; aqui só
      // preservamos o last_error dele pra visibilidade/observabilidade).
      // retry_at é opcional no HandlerResult — sem ele, aplica o mesmo backoff
      // do branch de erro pra não busy-loop reprocessando a cada tick.
      const retryAt = retry.retry_at ?? backoffAt(row.attempts + 1);
      await admin
        .from("event_log")
        .update({
          status: "pending",
          consumed_by: consumedBy,
          next_attempt_at: retryAt,
          updated_at: new Date().toISOString(),
          ...(errors.length
            ? {
                last_error: errors
                  .map((e) => `${e.consumer_key}: ${e.detail ?? "error"}`)
                  .join("; "),
              }
            : {}),
        })
        .eq("id", row.id);
      summary.retried += 1;
    } else if (errors.length) {
      const attempts = row.attempts + 1;
      const dead = attempts >= EVENT_LOG_MAX_ATTEMPTS;
      await admin
        .from("event_log")
        .update({
          status: dead ? "dead" : "pending",
          attempts,
          consumed_by: consumedBy,
          last_error: errors.map((e) => `${e.consumer_key}: ${e.detail ?? "error"}`).join("; "),
          next_attempt_at: dead ? null : backoffAt(attempts),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      summary[dead ? "dead" : "failed"] += 1;
    } else {
      // O MOTIVO DE UM `skipped` SOBREVIVE À LINHA.
      //
      // `skipped` conta como sucesso — e deve mesmo: o handler decidiu que não
      // era caso dele. Mas o `detail` era DESCARTADO por construção, e com ele
      // a única evidência de por que um evento não fez nada. Quem investigasse
      // "subi o material e não aconteceu nada" encontrava uma linha `done` sem
      // uma palavra de explicação.
      //
      // Não muda o desfecho do evento; só deixa de jogar fora a resposta.
      const pulados = results.filter((r) => r.status === "skipped" && r.detail);
      // E o motivo sai também no RESUMO, não só na linha.
      //
      // A linha basta para quem tem psql; não basta para o CI, onde o único
      // artefato que sobrevive ao job é o trace — e o trace guarda o CORPO da
      // resposta HTTP. Um e2e que morre porque o gatilho pulou ficava sem poder
      // dizer QUAL pulo foi: travou por horas o diagnóstico de
      // `gatilho-de-etapa.spec.ts`, com `failed=0` e nenhuma pista.
      if (pulados.length)
        summary.pulados?.push(
          ...pulados.map((r) => `${row.event_type}/${r.consumer_key}: ${r.detail}`),
        );
      await admin
        .from("event_log")
        .update({
          status: "done",
          consumed_by: consumedBy,
          updated_at: new Date().toISOString(),
          ...(pulados.length
            ? { last_error: pulados.map((r) => `${r.consumer_key}: ${r.detail}`).join("; ") }
            : {}),
        })
        .eq("id", row.id);
      summary.done += 1;
    }
  }
  return summary;
}
