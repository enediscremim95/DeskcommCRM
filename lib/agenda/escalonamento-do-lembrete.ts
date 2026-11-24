/**
 * ESCALONAMENTO PÓS-LEMBRETE — "caso não confirme, escalar para o SDR humano".
 *
 * Opt-in por tipo de agendamento (`calendar_event_types.reminder_escalation_enabled`,
 * migration 0320, padrão DESLIGADO; espera `reminder_escalation_minutes`, padrão
 * 20). Roda dentro do cron `agenda-reminder` que já existe (a cada 5 min) — nada
 * de fila ou worker novo.
 *
 * ─── O que é "confirmou" ────────────────────────────────────────────────────
 *
 * QUALQUER mensagem recebida NA CONVERSA EM QUE O LEMBRETE SAIU
 * (`reminder_conversation_id`) depois do envio. Simples de propósito: "ok",
 * "estarei lá" ou uma pergunta sobre o link mostram que a pessoa viu o lembrete
 * e está na conversa — e aí a IA continua com ela. Mensagem em outra conversa,
 * de outro número ou de outra organização não conta.
 *
 * ─── Quando o prazo começa ──────────────────────────────────────────────────
 *
 * Só depois de um envio que NÃO falhou: a mensagem do lembrete
 * (`reminder_message_id`) precisa estar `sent`/`delivered`/`read`. `failed` =
 * `not_applicable` (não dá para cobrar resposta de quem não recebeu);
 * `queued`/`sending` = espera. Lembrete enviado antes desta versão (sem
 * `reminder_message_id`) = `not_applicable`: não há como provar que saiu.
 *
 * ─── Ordem e idempotência ───────────────────────────────────────────────────
 *
 * 1. corte barato (prazo ainda não venceu → nem toca no banco);
 * 2. POSSE ATÔMICA: `update … set reminder_escalation_claimed_at = agora where
 *    checked_at is null and claimed_at is null` devolvendo a linha. Quem não
 *    ganha a posse não faz nada. Posse velha (> 10 min, rodada que morreu) é
 *    liberada antes;
 * 3. RELEITURA depois da posse — compromisso, tipo (MESMA organização, ainda
 *    ligado), mensagem do lembrete e resposta. Cancelado, já começou, desligado
 *    ou respondeu → carimba sem efeito;
 * 4. efeitos: tarefa + aviso (`criarTarefaHumana`, chaves únicas) e
 *    `triggerHandoff` NA conversa do lembrete;
 * 5. carimbo `checked_at/_result` condicionado à posse.
 * Falha transitória (tarefa lançou, handoff `orchestrator_error` /
 * `elegibilidade_indeterminada`) devolve a posse SEM carimbar: a próxima rodada
 * tenta de novo, e a tarefa não duplica (`source_key`) nem o aviso
 * (`dedupe_key`). Limite conhecido: se o orquestrador falhar DEPOIS de avisar o
 * lead, o retry pode avisá-lo de novo — o handoff oficial não tem chave de envio.
 *
 * ⚠️ `organization_id` SEMPRE da linha do compromisso, em toda leitura/escrita —
 * inclusive do TIPO: `event_type_id` tem FK só por `id`, então um vínculo
 * cruzado entre organizações não pode emprestar opt-in, prazo ou modelo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { logger } from "@/lib/logger";
import { criarTarefaHumana } from "@/lib/tarefas/tarefa-humana";

export type DecisaoDoEscalonamento = "aguardar" | "confirmed" | "escalated" | "not_applicable";

const STATUS_VIVOS = new Set(["confirmed", "pending"]);
const ENVIO_OK = new Set(["sent", "delivered", "read"]);
const ENVIO_EM_VOO = new Set(["queued", "sending", "pending"]);
const LIMITE = 200;
/** Menor espera aceita pela coluna — o corte grosso da consulta. */
const MENOR_ESPERA_MS = 5 * 60_000;
/** Posse mais velha que isto é de uma rodada que morreu. */
const LEASE_MS = 10 * 60_000;
/** Recusas do orquestrador que são infraestrutura, não estado: ficam para retry. */
const HANDOFF_TRANSITORIO = new Set(["orchestrator_error", "elegibilidade_indeterminada"]);

/** A regra, pura. `envio` é o status da mensagem do lembrete (null = desconhecido). */
export function decidirEscalonamento(i: {
  agora: Date;
  lembreteEnviadoEm: Date;
  esperaMin: number;
  comecaEm: Date;
  status: string;
  respondeuDepois: boolean;
  envio?: string | null;
  ligado?: boolean;
}): DecisaoDoEscalonamento {
  if (i.ligado === false) return "not_applicable";
  if (!STATUS_VIVOS.has(i.status)) return "not_applicable";
  if (i.envio !== undefined) {
    if (i.envio === null || (!ENVIO_OK.has(i.envio) && !ENVIO_EM_VOO.has(i.envio))) return "not_applicable";
    if (ENVIO_EM_VOO.has(i.envio)) {
      return i.comecaEm.getTime() <= i.agora.getTime() ? "not_applicable" : "aguardar";
    }
  }
  if (i.respondeuDepois) return "confirmed";
  if (i.agora.getTime() < i.lembreteEnviadoEm.getTime() + i.esperaMin * 60_000) return "aguardar";
  if (i.comecaEm.getTime() <= i.agora.getTime()) return "not_applicable";
  return "escalated";
}

interface TipoEmbutido {
  organization_id?: string;
  reminder_escalation_enabled: boolean;
  reminder_escalation_minutes: number;
}

interface CompromissoLembrado {
  id: string;
  organization_id: string;
  event_type_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  title: string;
  status: string;
  starts_at: string;
  reminder_sent_at: string;
  reminder_message_id: string | null;
  reminder_conversation_id: string | null;
  reminder_escalation_checked_at?: string | null;
  calendar_event_types?: TipoEmbutido | TipoEmbutido[] | null;
}

export interface ResumoDoEscalonamento {
  examinados: number;
  escalados: number;
  confirmados: number;
  nao_aplicaveis: number;
  aguardando: number;
  erros: number;
}

export interface DepsDoEscalonamento {
  criarTarefa?: typeof criarTarefaHumana;
  handoff?: typeof triggerHandoff;
}

const COLUNAS =
  "id, organization_id, event_type_id, contact_id, conversation_id, title, status, starts_at, " +
  "reminder_sent_at, reminder_message_id, reminder_conversation_id, reminder_escalation_checked_at";

function embutido(l: CompromissoLembrado): TipoEmbutido | null {
  const t = l.calendar_event_types;
  if (!t) return null;
  return Array.isArray(t) ? (t[0] ?? null) : t;
}

/** O tipo DESTE compromisso, lido na organização DELE. Null = vínculo inválido. */
async function tipoDaMesmaOrg(admin: SupabaseClient, l: CompromissoLembrado): Promise<TipoEmbutido | null> {
  if (!l.event_type_id) return null;
  const { data, error } = await admin
    .from("calendar_event_types")
    .select("organization_id, reminder_escalation_enabled, reminder_escalation_minutes")
    .eq("organization_id", l.organization_id)
    .eq("id", l.event_type_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TipoEmbutido | null) ?? null;
}

async function statusDoEnvio(admin: SupabaseClient, l: CompromissoLembrado): Promise<string | null> {
  if (!l.reminder_message_id) return null;
  const { data, error } = await admin
    .from("messages")
    .select("status")
    .eq("organization_id", l.organization_id)
    .eq("id", l.reminder_message_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { status?: string } | null)?.status ?? null;
}

async function respondeuNaConversaDoLembrete(admin: SupabaseClient, l: CompromissoLembrado): Promise<boolean> {
  if (!l.reminder_conversation_id) return false;
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", l.organization_id)
    .eq("conversation_id", l.reminder_conversation_id)
    .eq("direction", "inbound")
    .gt("sent_at", l.reminder_sent_at)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Posse atômica. Devolve o instante da posse (a "senha" das escritas seguintes) ou null. */
async function tomarPosse(admin: SupabaseClient, l: CompromissoLembrado, agora: Date): Promise<string | null> {
  // Posse abandonada por uma rodada que morreu volta a ficar livre.
  const { error: libErr } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_claimed_at: null })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .is("reminder_escalation_checked_at", null)
    .lt("reminder_escalation_claimed_at", new Date(agora.getTime() - LEASE_MS).toISOString());
  if (libErr) throw new Error(libErr.message);

  const posse = agora.toISOString();
  const { data, error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_claimed_at: posse })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .is("reminder_escalation_checked_at", null)
    .is("reminder_escalation_claimed_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data as unknown[] | null)?.length ? posse : null;
}

async function devolverPosse(admin: SupabaseClient, l: CompromissoLembrado, posse: string): Promise<void> {
  const { error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_claimed_at: null })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .eq("reminder_escalation_claimed_at", posse);
  if (error) throw new Error(error.message);
}

async function carimbar(
  admin: SupabaseClient,
  l: CompromissoLembrado,
  resultado: Exclude<DecisaoDoEscalonamento, "aguardar">,
  posse: string,
  agora: Date,
): Promise<void> {
  const { error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_checked_at: agora.toISOString(), reminder_escalation_result: resultado })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .eq("reminder_escalation_claimed_at", posse)
    .is("reminder_escalation_checked_at", null);
  if (error) throw new Error(error.message);
}

export async function escalonarLembretesSemResposta(
  admin: SupabaseClient,
  agora: Date,
  deps: DepsDoEscalonamento = {},
): Promise<ResumoDoEscalonamento> {
  const criarTarefa = deps.criarTarefa ?? criarTarefaHumana;
  const handoff = deps.handoff ?? triggerHandoff;
  const resumo: ResumoDoEscalonamento = {
    examinados: 0,
    escalados: 0,
    confirmados: 0,
    nao_aplicaveis: 0,
    aguardando: 0,
    erros: 0,
  };

  // O embed `!inner` é só o corte GROSSO (tipo ligado). A palavra final sobre o
  // tipo é `tipoDaMesmaOrg`, lido na organização do compromisso.
  const { data, error } = await admin
    .from("calendar_appointments")
    .select(
      `${COLUNAS}, calendar_event_types!inner(organization_id, reminder_escalation_enabled, reminder_escalation_minutes)`,
    )
    .eq("calendar_event_types.reminder_escalation_enabled", true)
    .not("reminder_sent_at", "is", null)
    .is("reminder_escalation_checked_at", null)
    .lte("reminder_sent_at", new Date(agora.getTime() - MENOR_ESPERA_MS).toISOString())
    .gt("starts_at", new Date(agora.getTime() - 86_400_000).toISOString())
    .order("reminder_sent_at", { ascending: true })
    .limit(LIMITE);
  if (error) {
    logger.error("[agenda-reminder] consulta do escalonamento falhou", { error: error.message });
    resumo.erros += 1;
    return resumo;
  }

  for (const candidato of (data ?? []) as unknown as CompromissoLembrado[]) {
    const grosso = embutido(candidato);
    // Tipo de OUTRA organização no embed: nem olha. (A releitura abaixo também barra.)
    if (!grosso?.reminder_escalation_enabled || (grosso.organization_id && grosso.organization_id !== candidato.organization_id)) {
      continue;
    }
    // Corte barato: o prazo nem venceu, nada a tocar.
    const venceEm = new Date(candidato.reminder_sent_at).getTime() + Number(grosso.reminder_escalation_minutes ?? 20) * 60_000;
    if (agora.getTime() < venceEm) {
      resumo.aguardando += 1;
      continue;
    }
    resumo.examinados += 1;

    let posse: string | null = null;
    try {
      posse = await tomarPosse(admin, candidato, agora);
      if (!posse) continue; // outra rodada está cuidando deste compromisso

      // ── RELEITURA depois da posse: nada que foi lido antes vale ──
      const { data: freshRow, error: fErr } = await admin
        .from("calendar_appointments")
        .select(COLUNAS)
        .eq("id", candidato.id)
        .eq("organization_id", candidato.organization_id)
        .maybeSingle();
      if (fErr) throw new Error(fErr.message);
      const l = freshRow as unknown as CompromissoLembrado | null;
      if (!l || l.reminder_escalation_checked_at) {
        if (l) await devolverPosse(admin, candidato, posse);
        continue;
      }
      const tipo = await tipoDaMesmaOrg(admin, l);
      const decisao = decidirEscalonamento({
        agora,
        lembreteEnviadoEm: new Date(l.reminder_sent_at),
        esperaMin: Number(tipo?.reminder_escalation_minutes ?? 20),
        comecaEm: new Date(l.starts_at),
        status: l.status,
        ligado: Boolean(tipo?.reminder_escalation_enabled),
        envio: await statusDoEnvio(admin, l),
        respondeuDepois: await respondeuNaConversaDoLembrete(admin, l),
      });

      if (decisao === "aguardar") {
        await devolverPosse(admin, l, posse);
        resumo.aguardando += 1;
        continue;
      }
      if (decisao !== "escalated") {
        await carimbar(admin, l, decisao, posse, agora);
        if (decisao === "confirmed") resumo.confirmados += 1;
        else resumo.nao_aplicaveis += 1;
        continue;
      }

      const org = l.organization_id;
      let nome: string | null = null;
      if (l.contact_id) {
        const { data: contato } = await admin
          .from("contacts")
          .select("name, display_name")
          .eq("organization_id", org)
          .eq("id", l.contact_id)
          .maybeSingle();
        const c = contato as { display_name?: string | null; name?: string | null } | null;
        nome = c?.display_name ?? c?.name ?? null;
      }
      const conversa = l.reminder_conversation_id;
      const tarefa = await criarTarefa(admin, {
        organizationId: org,
        sourceKey: `agenda:${l.id}:lembrete_sem_confirmacao`,
        title: `Ligar para ${nome?.trim() || "o cliente"} e confirmar presença em "${l.title}"`.slice(0, 200),
        description:
          "O cliente não respondeu ao lembrete da reunião. Ligue; se não atender, mande mensagem. " +
          "Confirme a presença e registre o resultado.",
        priority: "urgent",
        dueAt: new Date(l.starts_at),
        contactId: l.contact_id,
        conversationId: conversa,
        tituloDoAviso: "Cliente não confirmou a reunião depois do lembrete",
      });
      if (conversa) {
        const r = await handoff({
          conversationId: conversa,
          organizationId: org,
          reason: "lembrete_sem_confirmacao",
          leadId: tarefa.leadId,
          metadata: { source: "agenda_reminder_escalation", appointment_id: l.id, task_id: tarefa.taskId },
        });
        if (!r.triggered && HANDOFF_TRANSITORIO.has(r.reason)) {
          // Infra falhou: NÃO é escalado ainda. Devolve a posse e tenta na próxima rodada.
          await devolverPosse(admin, l, posse);
          resumo.erros += 1;
          logger.warn("[agenda-reminder] handoff transitório; escalonamento fica pendente", {
            appointmentId: l.id,
            motivo: r.reason,
          });
          continue;
        }
        if (!r.triggered) {
          // Conversa já com pessoa / IA já silenciada: tarefa e aviso bastam.
          logger.info("[agenda-reminder] escalonamento sem handoff", { appointmentId: l.id, motivo: r.reason });
        }
      }
      await carimbar(admin, l, "escalated", posse, agora);
      resumo.escalados += 1;
    } catch (err) {
      resumo.erros += 1;
      if (posse) {
        try {
          await devolverPosse(admin, candidato, posse);
        } catch {
          // A posse expira sozinha (LEASE_MS).
        }
      }
      logger.error("[agenda-reminder] escalonamento falhou; tenta na próxima rodada", {
        appointmentId: candidato.id,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }
  return resumo;
}
