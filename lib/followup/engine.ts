import { FOLLOWUP_DEFERRED, lerJanelaDoFluxo, type SendWindow } from "@/lib/tempo/janela-followup";
import type { JobClaim } from "@/lib/agent-engine/queue/claim";
import { assertAgendaEffectSupabase } from "@/lib/agenda/efeito";
import { AgendaDeferredError } from "@/lib/agenda/protecao-followup";
import type { ServiceBoundary } from "@/lib/atendimento/fronteira";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
import { assertServiceBoundarySupabase } from "@/lib/atendimento/origem";
/**
 * Follow-up flow engine — worker tick (Task 4.1). Orchestrates DB access
 * around the pure decisions in `node-handlers.ts`: claim due enrollments,
 * load the pinned graph + lead facts, run `processNode`, persist the result.
 *
 * `AdminClient` is a narrow interface (not `SupabaseClient` directly) so this
 * file is testable against the bare-Postgres harness used by
 * `tests/invariants/**` (no PostgREST there — see `pg-admin-client.ts` for
 * the pg-backed adapter used by the DB test) as well as production, where
 * `createSupabaseAdminClient` below adapts the real service-role client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { idsDoContatoEGemeos } from "@/lib/channels/contato-por-telefone";
import { logger } from "@/lib/logger";

import { flowGraphSchema, type FlowGraph, type FlowNode, type ReplySaveTo } from "./graph-schema";
import {
  ACTION_RECHECK_MS,
  BACKOFF_MS,
  ehConfirmacao,
  latestRepeatIndex,
  occupancyEventCount,
  actionTurnCompleted,
  processNode,
  repeatTakenFromEvents,
  repeatTotalFromEvents,
  resolveWaitPhase,
  selectEdge,
  type EnrollmentEventRef,
  type EnrollmentOutcome,
  type EnrollmentRow,
  type EnrollmentStatus,
  type LeadFacts,
  type NodeResult,
} from "./node-handlers";
import { coletarEsperasAdaptativas, type EsperaAdaptativa, type TimingPlan } from "./timing-plan";
import {
  avisoDeRecuperacaoEsgotada,
  type AvisoRecuperacaoEsgotada,
} from "./no-show-recuperacao-esgotada";
import { interpolarDestino, persistirRespostaFollowupSupabase } from "./persistir-resposta";
import { moverEtapaDoFluxo, type ResultadoMoverEtapa } from "./mover-etapa";
import {
  criarTarefaHumana,
  interpolarTarefa,
  type NovaTarefaHumana,
  type ResultadoTarefaHumana,
} from "@/lib/tarefas/tarefa-humana";

const MAX_STEPS = 80;
const CLAIM_LEASE_SECONDS = 120;
const DEFAULT_CLAIM_LIMIT = 20;
const MAX_ERROR_LEN = 300;

export interface EnrollmentPatch {
  status?: EnrollmentStatus;
  current_node_id?: string;
  next_eval_at?: string | null;
  claimed_until?: string | null;
  attempts?: number;
  last_error?: string | null;
  steps_taken?: number;
  outcome?: EnrollmentOutcome | null;
  cancel_reason?: string | null;
  completed_at?: string | null;
  updated_at?: string;
  /** Plano de tempo decidido no acionamento (migration 0144) — escrito uma vez, pela ponte. */
  timing_plan?: TimingPlan;
}

export interface FollowupJobRequest {
  organization_id: string;
  contact_id: string;
  payload: {
    service_boundary?: ServiceBoundary | null;
    automatic_silence?: boolean;
    followup_enrollment_id: string;
    node_id: string;
    source_step_key?: string;
    purpose: "send_message" | "classify" | "plan_timing";
    /** action (mode 'ai_message') — Task 5.1: repassado ao turno pra virar o bloco de orientação. */
    prompt_hint?: string;
    /** action (mode 'text') — corpo pronto; o turno envia sem chamar o modelo. */
    fixed_body?: string;
    /** action (mode 'template') — id em `message_templates`; o turno carrega o corpo e envia sem modelo. */
    template_id?: string;
    volta_index?: number;
    volta_total?: number;
    /** ai_classify — Task 5.1: classes possíveis + dica opcional pro classificador. */
    classes?: string[];
    hint?: string;
    /** trigger (purpose 'plan_timing'): TODAS as esperas adaptativas do fluxo, com o
     *  intervalo e a orientação de cada uma. O planejador precisa ver a sequência
     *  inteira — decidir bem a 1ª espera e mal a 3ª não é um plano. */
    waits?: EsperaAdaptativa[];
  };
}

/** DB surface the engine needs — see file header for why this isn't `SupabaseClient` directly. */
export interface AdminClient {
  assertServiceBoundary?(enrollment: EnrollmentRow): Promise<void>;
  assertAgenda?(enrollment:EnrollmentRow):Promise<void>;
  claimDueEnrollments(limit: number, leaseSeconds: number): Promise<EnrollmentRow[]>;
  loadSendWindow?(orgId: string, pointerId: string): Promise<SendWindow | undefined>;
  loadDeferredSend?(enrollment: EnrollmentRow, stepKey: string, now: Date): Promise<string | null>;
  loadFlowGraph(orgId: string, versionId: string): Promise<FlowGraph | null>;
  loadLeadFacts(orgId: string, contactId: string): Promise<{
    lead_stage: string | null;
    tags: string[];
    contact_name?: string | null;
    custom_fields?: Record<string, unknown>;
  }>;
  loadEnrollmentEvents(enrollmentId: string): Promise<EnrollmentEventRef[]>;
  /** Latest inbound `messages.body` for the contact (optionally scoped to the enrollment conversation). */
  loadLastInboundBody(
    orgId: string,
    contactId: string,
    conversationId: string | null,
    /** Só mensagens deste instante em diante — senão o SIM da pergunta anterior casa no próximo `match_reply`. */
    naoAntesDe?: string | null,
  ): Promise<string | null>;
  /** Inserts the step's audit event; `inserted:false` means idempotency_key already existed (23505 replay). */
  insertEnrollmentEvent(event: {
    organization_id: string;
    enrollment_id: string;
    node_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
  }): Promise<{ inserted: boolean }>;
  applyEnrollmentStep?(id:string,orgId:string,patch:EnrollmentPatch,event:{job_claim?:JobClaim;job_id?:string;node_id:string;event_type:string;payload:Record<string,unknown>;idempotency_key:string}):Promise<void>;
  updateEnrollment(id: string, orgId: string, patch: EnrollmentPatch): Promise<void>;
  loadFlowPointerName(orgId: string, pointerId: string): Promise<string | null>;
  insertDeadInboxItem(item: { organization_id: string; title: string; body: string; ref_id: string }): Promise<void>;
  /**
   * Régua de recuperação de falta esgotada sem resposta — abre um item na
   * Central referenciando o COMPROMISSO. Opcional: só a produção precisa; os
   * adaptadores de teste que não exercitam no-show podem omitir. Ver
   * `no-show-recuperacao-esgotada.ts`.
   */
  abrirAvisoRecuperacaoEsgotada?(item: AvisoRecuperacaoEsgotada): Promise<void>;
  /**
   * Ação interna `human_task` (migration 0320). Opcional na interface porque os
   * adaptadores de teste que não exercitam a ação não precisam dela; o engine
   * lança `efeito_indisponivel` se um grafo pedir e o adaptador não tiver.
   */
  criarTarefaHumana?(input: NovaTarefaHumana): Promise<ResultadoTarefaHumana>;
  /** Ação interna `move_stage` — ver `mover-etapa.ts`. */
  moverEtapa?(input: {
    organizationId: string;
    contactId: string;
    stageId: string | null | undefined;
    requestId: string;
    flowPointerId: string;
    origemLeadId?: string | null;
  }): Promise<ResultadoMoverEtapa>;
  persistirRespostaFollowup(input: {
    organization_id: string;
    contact_id: string;
    save_to: ReplySaveTo;
    value: string;
  }): Promise<void>;
}

export interface TickDeps {
  db: AdminClient;
  clock: () => Date;
  enqueueJob: (job: FollowupJobRequest) => Promise<void>;
}

export interface TickSummary {
  /**
   * Distingue "o claim falhou" de "nada vencido" — os dois produzem
   * `claimed: 0`, e sem esta marca o segundo esconde o primeiro para sempre.
   */
  claim_falhou?: boolean;
  claimed: number;
  advanced: number;
  scheduled: number;
  failed: number;
  dead: number;
}

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // last_error nunca carrega PII — mensagens são strings de código controladas
  // pelo próprio engine; o truncamento é só cinto de segurança contra erro
  // inesperado de driver/DB verboso.
  return raw.slice(0, MAX_ERROR_LEN);
}

function eventTypeFor(result: NodeResult): string {
  switch (result.kind) {
    case "advance":
      // O trigger desistiu de esperar o plano de tempo. Evento PRÓPRIO porque a
      // consequência é visível pro operador (as esperas do fluxo saem no máximo);
      // enterrá-lo como mais um `node_advanced` esconderia o motivo.
      return result.reason === "plan_timeout" ? "timing_plan_desistido" : "node_advanced";
    case "wait":
      return "wait_started";
    case "enqueue_turn":
      return result.purpose === "classify" ? "classify_enqueued" : "turn_enqueued";
    case "recheck":
      return "action_recheck";
    case "complete":
      return "flow_completed";
    // `dead`/`fail` never reach the event-insert (handled at the top of applyResult) — cases
    // present only for switch exhaustiveness, mirroring how `fail` is already listed here.
    case "dead":
      return "flow_dead";
    case "fail":
      return "node_failed";
  }
}

function eventPayload(result: NodeResult): Record<string, unknown> {
  switch (result.kind) {
    case "advance":
      return {
        next_node_id: result.next_node_id,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        ...(result.repeat !== undefined
          ? { repeat_index: result.repeat.index, repeat_total: result.repeat.total }
          : {}),
      };
    case "wait":
      return {
        next_eval_at: result.next_eval_at.toISOString(),
        ...(result.wake_status !== undefined ? { wake_status: result.wake_status } : {}),
      };
    case "recheck":
      return { next_eval_at: result.next_eval_at.toISOString() };
    case "enqueue_turn":
      return { purpose: result.purpose, wake_status: result.wake_status };
    case "complete":
      return { outcome: result.outcome, cancel_reason: result.cancel_reason ?? null };
    case "dead":
      return { reason: result.reason };
    case "fail":
      return { error: result.error };
  }
}

/**
 * Campos extras do payload do job por tipo de nó (Task 5.1) — o turno do
 * agent-engine precisa da orientação do PRÓPRIO nó pinado (prompt_hint da
 * action, classes/hint do ai_classify, guidance do wait smart) pra saber o que
 * fazer; sem isso o job só teria os 3 campos genéricos (enrollment/node/purpose).
 */
function interpolarVolta(texto: string, events: EnrollmentEventRef[]): string {
  const volta = latestRepeatIndex(events);
  if (!volta) return texto;
  return texto.replaceAll("{{volta}}", String(volta.index)).replaceAll("{{voltas}}", String(volta.total));
}

function turnPayloadExtras(
  node: FlowNode,
  smartWaits: EsperaAdaptativa[],
  events: EnrollmentEventRef[] = [],
): Partial<FollowupJobRequest["payload"]> {
  if (node.type === "action" && node.config.mode === "ai_message") {
    return { prompt_hint: interpolarVolta(node.config.prompt_hint, events) };
  }
  if (node.type === "action" && node.config.mode === "text") {
    return { fixed_body: interpolarVolta(node.config.body, events) };
  }
  if (node.type === "action" && node.config.mode === "template") {
    const volta = latestRepeatIndex(events);
    return {
      template_id: node.config.template_id,
      ...(volta ? { volta_index: volta.index, volta_total: volta.total } : {}),
    };
  }
  if (node.type === "ai_classify") {
    return { classes: node.config.classes, ...(node.config.hint !== undefined ? { hint: node.config.hint } : {}) };
  }
  if (node.type === "trigger") {
    // As esperas vêm do GRAFO PINADO, não do nó — o trigger não as conhece, e é
    // o grafo que manda (o payload do modelo nunca decide o intervalo).
    return { waits: smartWaits };
  }
  return {};
}

/**
 * Executa a ação INTERNA de um nó `action` (tarefa humana / mover etapa) e
 * devolve o evento do passo. Idempotente pela chave do passo (`idemKey`): a
 * tarefa usa `source_key` única; mover de novo cai em `ja_esta_la`.
 */
async function executarEfeitoInterno(
  db: AdminClient,
  enrollment: EnrollmentRow,
  node: Extract<FlowNode, { type: "action" }>,
  idemKey: string,
  clock: () => Date,
  nomeDoContato: string | null,
  events: EnrollmentEventRef[] = [],
): Promise<{ event_type: string; payload: Record<string, unknown> }> {
  const config = node.config;
  if (config.mode === "human_task") {
    if (!db.criarTarefaHumana) throw new Error("efeito_indisponivel");
    const r = await db.criarTarefaHumana({
      organizationId: enrollment.organization_id,
      sourceKey: `followup:${enrollment.id}:${idemKey}`,
      title: interpolarTarefa(config.title, nomeDoContato),
      description: config.description ? interpolarTarefa(config.description, nomeDoContato) : null,
      ...(config.priority ? { priority: config.priority } : {}),
      dueAt:
        config.due_in_minutes !== undefined
          ? new Date(clock().getTime() + config.due_in_minutes * 60_000)
          : null,
      contactId: enrollment.contact_id,
      conversationId: enrollment.conversation_id,
      tituloDoAviso: "Tarefa para a equipe criada pelo follow-up",
    });
    return {
      event_type: "human_task_created",
      payload: { task_id: r.taskId, assigned_to: r.assignedTo, origem: r.origem, criada: r.criada },
    };
  }
  if (config.mode === "move_stage") {
    if (!db.moverEtapa) throw new Error("efeito_indisponivel");
    const r = await db.moverEtapa({
      organizationId: enrollment.organization_id,
      contactId: enrollment.contact_id,
      stageId: config.stage_id ?? null,
      requestId: `followup:${enrollment.id}:${idemKey}`,
      flowPointerId: enrollment.pointer_id,
      origemLeadId: origemDoEnrollment(events),
    });
    return r.movido
      ? { event_type: "stage_move_done", payload: { lead_id: r.lead_id, to_stage_id: r.to_stage_id } }
      : {
          event_type: "stage_move_skipped",
          payload: { motivo: r.motivo, stage_id: config.stage_id ?? null, ...(r.lead_id ? { lead_id: r.lead_id } : {}) },
        };
  }
  throw new Error(`action mode "${config.mode}" is not internal`);
}

/**
 * O negócio que originou a inscrição: o `lead_id` do PRIMEIRO evento
 * `enrolled_by_*` (ex.: `enrolled_by_stage_change`). Só eventos de inscrição —
 * o `lead_id` de um `stage_move_*` posterior não é origem.
 */
export function origemDoEnrollment(events: EnrollmentEventRef[]): string | null {
  for (const e of events) {
    if (!e.event_type?.startsWith("enrolled_by")) continue;
    const id = e.payload?.lead_id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

async function markDead(
  db: AdminClient,
  clock: () => Date,
  enrollment: EnrollmentRow,
  reason: string,
  attempts?: number,
): Promise<void> {
  const sanitized = errorMessage(reason);

  // Ordem deliberada: inbox ANTES do status='dead'. Se cair no meio (crash /
  // DB soluço entre as duas escritas), o enrollment continua com status
  // active/waiting_reply — ainda claimable — então um tick futuro re-executa
  // markDead do zero. Pior caso é um item de inbox duplicado (visível, o
  // usuário só vê o aviso 2x); a ordem inversa arriscaria o pior caso real:
  // status='dead' gravado e o aviso NUNCA sair — enrollment morto em
  // silêncio. Duplicata visível > perda silenciosa.
  const flowName = (await db.loadFlowPointerName(enrollment.organization_id, enrollment.pointer_id)) ?? enrollment.pointer_id;
  await db.insertDeadInboxItem({
    organization_id: enrollment.organization_id,
    title: "Um fluxo de follow-up parou de tentar",
    body: `O fluxo "${flowName}" (enrollment ${enrollment.id}) foi marcado como "dead": ${sanitized}`,
    ref_id: enrollment.id,
  });

  await db.updateEnrollment(enrollment.id, enrollment.organization_id, {
    ...(attempts !== undefined ? { attempts } : {}),
    status: "dead",
    cancel_reason: sanitized,
    last_error: sanitized,
    next_eval_at: null,
    claimed_until: null,
    completed_at: clock().toISOString(),
    updated_at: clock().toISOString(),
  });
}

async function applyHandlerFailure(
  deps: Pick<TickDeps, "db" | "clock">,
  enrollment: EnrollmentRow,
  rawError: string,
  summary: TickSummary,
): Promise<void> {
  const { db, clock } = deps;
  summary.failed++;

  const attempts = enrollment.attempts + 1;
  if (attempts > enrollment.max_attempts) {
    await markDead(db, clock, enrollment, rawError, attempts);
    summary.dead++;
    return;
  }

  const backoffMs = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
  await db.updateEnrollment(enrollment.id, enrollment.organization_id, {
    attempts,
    last_error: errorMessage(rawError),
    next_eval_at: new Date(clock().getTime() + backoffMs).toISOString(),
    claimed_until: null,
    updated_at: clock().toISOString(),
  });
}

function tallyOutcome(result: NodeResult, summary: TickSummary): void {
  if (result.kind === "advance" || result.kind === "complete") {
    summary.advanced++;
  } else if (result.kind === "wait" || result.kind === "enqueue_turn" || result.kind === "recheck") {
    summary.scheduled++;
  }
}

async function applyResult(
  deps: TickDeps,
  enrollment: EnrollmentRow,
  node: FlowNode,
  result: NodeResult,
  summary: TickSummary,
  smartWaits: EsperaAdaptativa[] = [],
  events: EnrollmentEventRef[] = [],
  respostaParaGravar: string | null = null,
  nomeDoContato: string | null = null,
): Promise<void> {
  const { db, clock, enqueueJob } = deps;
  await db.assertServiceBoundary?.(enrollment);

  if (result.kind === "fail") {
    await applyHandlerFailure(deps, enrollment, result.error, summary);
    return;
  }

  if (result.kind === "dead") {
    // Action dead-man: turn never completed after MAX_ACTION_RECHECKS. Reuse the shared
    // markDead path (status='dead' + agent_inbox_items kind 'followup_dead') — same as
    // max_steps/exhausted-backoff — so the operator sees exactly one dead-letter notice.
    await markDead(db, clock, enrollment, result.reason);
    summary.dead++;
    return;
  }

  const idemKey = `${node.id}:${enrollment.steps_taken}`;
  let wantedType = eventTypeFor(result);
  let payload = eventPayload(result);
  if (result.kind === "advance" && result.efeito && node.type === "action") {
    // Passo já gravado (replay depois de update perdido): o efeito já rodou —
    // reusa o tipo do evento existente para o patch de avanço ser aplicado.
    const jaGravado = events.find((e) => e.idempotency_key === idemKey && e.node_id === node.id);
    if (jaGravado?.event_type) {
      wantedType = jaGravado.event_type;
    } else {
      const efeito = await executarEfeitoInterno(db, enrollment, node, idemKey, clock, nomeDoContato, events);
      wantedType = efeito.event_type;
      payload = { ...payload, ...efeito.payload };
    }
  }
  const { inserted } = await db.insertEnrollmentEvent({
    organization_id: enrollment.organization_id,
    enrollment_id: enrollment.id,
    node_id: node.id,
    event_type: wantedType,
    payload,
    idempotency_key: idemKey,
  });
  const isReplay = !inserted;

  // Corrida clássica: completeTurn grava `action_sent` com a chave N:steps e
  // avança; um tick/inbound paralelo tenta `action_recheck` com a MESMA chave,
  // perde o insert (replay) e AINDA assim reescrevia current_node_id pro action.
  // Se o evento que já existe é de OUTRO tipo, não aplicar o patch deste result.
  if (isReplay) {
    const frescos = await db.loadEnrollmentEvents(enrollment.id);
    const prior = frescos.find((e) => e.idempotency_key === idemKey);
    if (prior?.event_type && prior.event_type !== wantedType) {
      if (result.kind === "advance" && prior.event_type === "action_sent") {
        // action_sent gravado; o update do completeTurn pode ter se perdido —
        // aplica só o avanço sem inventar outro evento.
        await db.updateEnrollment(enrollment.id, enrollment.organization_id, {
          current_node_id: result.next_node_id,
          status: "active",
          next_eval_at: result.next_eval_at.toISOString(),
          steps_taken: enrollment.steps_taken + 1,
          claimed_until: null,
          updated_at: clock().toISOString(),
        });
        tallyOutcome(result, summary);
      }
      return;
    }
  }

  const patch: EnrollmentPatch = {
    steps_taken: enrollment.steps_taken + 1,
    claimed_until: null,
    updated_at: clock().toISOString(),
  };

  switch (result.kind) {
    case "advance":
      patch.current_node_id = result.next_node_id;
      patch.status = "active";
      patch.next_eval_at = result.next_eval_at.toISOString();
      break;
    case "wait":
      patch.current_node_id = enrollment.current_node_id;
      patch.status = result.wake_status ?? "active";
      patch.next_eval_at = result.next_eval_at.toISOString();
      break;
    case "recheck":
      // recheck = action turn in flight: stay on the node, stay active, look again after the
      // recheck delay. No enqueueJob (the whole point) — the in-flight turn owns the send.
      patch.current_node_id = enrollment.current_node_id;
      patch.status = "active";
      patch.next_eval_at = result.next_eval_at.toISOString();
      break;
    case "enqueue_turn": {
      patch.current_node_id = enrollment.current_node_id;
      patch.status = result.wake_status;
      // node.type narrado (union discriminada de FlowNode) — sem cast: dentro
      // do `if`, node.config já é o config do ai_classify de verdade.
      const graceMs =
        node.type === "ai_classify" || node.type === "match_reply"
          ? node.config.grace_timeout_ms
          : ACTION_RECHECK_MS;
      patch.next_eval_at = new Date(clock().getTime() + graceMs).toISOString();
      if (!isReplay) {
        await db.assertServiceBoundary?.(enrollment);
        await enqueueJob({
          organization_id: enrollment.organization_id,
          contact_id: enrollment.contact_id,
          payload: {
            service_boundary: enrollment.service_boundary ?? null,
            ...(enrollment.automatic_silence ? { automatic_silence: true } : {}),
            followup_enrollment_id: enrollment.id,
            node_id: node.id,
            source_step_key: idemKey,
            purpose: result.purpose,
            ...turnPayloadExtras(node, smartWaits, events),
            ...(result.fixed_body ? { fixed_body: result.fixed_body } : {}),
          },
        });
      }
      break;
    }
    case "complete":
      patch.current_node_id = enrollment.current_node_id;
      patch.status = "completed";
      patch.next_eval_at = null;
      patch.completed_at = clock().toISOString();
      patch.outcome = result.outcome;
      if (result.cancel_reason) patch.cancel_reason = result.cancel_reason;
      break;
  }

  // Aviso ANTES do `status='completed'`, mesma ordem (e mesma razão) de
  // `markDead`: se cair entre as duas escritas, o enrollment continua
  // claimable e um tick futuro re-executa `complete` → re-tenta o aviso (o
  // índice único da 0224 torna a repetição um no-op). A ordem inversa
  // arriscaria o aviso NUNCA sair.
  const avisoEsgotada = avisoDeRecuperacaoEsgotada(enrollment, result, isReplay);
  if (avisoEsgotada) {
    await db.abrirAvisoRecuperacaoEsgotada?.(avisoEsgotada);
  }

  await db.updateEnrollment(enrollment.id, enrollment.organization_id, patch);

  if (
    result.kind === "advance" &&
    !isReplay &&
    respostaParaGravar &&
    node.type === "match_reply" &&
    node.config.save_to &&
    (node.config.if_exists ?? "overwrite") !== "skip" &&
    !((node.config.if_exists ?? "overwrite") === "confirm" && ehConfirmacao(respostaParaGravar))
  ) {
    try {
      await db.assertServiceBoundary?.(enrollment);
      await db.persistirRespostaFollowup({
        organization_id: enrollment.organization_id,
        contact_id: enrollment.contact_id,
        save_to: interpolarDestino(node.config.save_to, events),
        value: respostaParaGravar,
      });
    } catch (err) {
      logger.warn("followup: gravar resposta falhou; o fluxo já avançou", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!isReplay) tallyOutcome(result, summary);
}

/**
 * Resposta do WhatsApp neste request — não espera claim/cron.
 * `inboundBody` é o texto desta mensagem (substitui nome já gravado na captação).
 */
export async function aplicarRespostaInbound(
  deps: TickDeps,
  enrollment: EnrollmentRow,
  inboundBody: string,
): Promise<void> {
  const summary: TickSummary = { claimed: 0, advanced: 0, scheduled: 0, failed: 0, dead: 0 };
  await processEnrollment(deps, enrollment, summary, inboundBody);
}

/** Um passo do grafo sem claim global — captação arranca o fluxo novo sem
 *  tratar `waiting_reply` de outro lead como timeout. */
export async function avancarEnrollmentAtivo(
  deps: TickDeps,
  enrollment: EnrollmentRow,
): Promise<void> {
  const summary: TickSummary = { claimed: 0, advanced: 0, scheduled: 0, failed: 0, dead: 0 };
  await processEnrollment(deps, enrollment, summary);
}

async function processEnrollment(
  deps: TickDeps,
  enrollment: EnrollmentRow,
  summary: TickSummary,
  inboundBodyOverride?: string,
): Promise<void> {
  const { db, clock } = deps;
  try { await db.assertServiceBoundary?.(enrollment); await db.assertAgenda?.(enrollment); }
  catch (error) {
    if(error instanceof AgendaDeferredError){
      if(error.protection.motivo === "leitura_indisponivel") throw error;
      await db.updateEnrollment(enrollment.id,enrollment.organization_id,{next_eval_at:error.protection.reavaliar_em,claimed_until:null,last_error:error.message});
      return;
    }
    if (!(error instanceof StaleServiceBoundaryError)) throw error;
    await db.updateEnrollment(enrollment.id, enrollment.organization_id, { status: "cancelled", cancel_reason: "Atendimento encerrado ou substituído", claimed_until: null, completed_at: clock().toISOString() });
    return;
  }


  if (enrollment.steps_taken > MAX_STEPS) {
    await markDead(db, clock, enrollment, "max_steps");
    summary.dead++;
    return;
  }

  const graph = await db.loadFlowGraph(enrollment.organization_id, enrollment.version_id);
  if (!graph) throw new Error("flow_version_not_found");

  const node = graph.nodes.find((n) => n.id === enrollment.current_node_id);
  if (!node) throw new Error("node_not_found");
  if (inboundBodyOverride !== undefined && node.type !== "match_reply" && node.type !== "wait") {
    return;
  }

  const leadRow = await db.loadLeadFacts(enrollment.organization_id, enrollment.contact_id);
  const lead: LeadFacts = {
    lead_stage: leadRow.lead_stage,
    tags: leadRow.tags,
    steps_taken: enrollment.steps_taken,
    last_outcome: null,
    contact_name: leadRow.contact_name ?? null,
    custom_fields: leadRow.custom_fields,
  };

  let waitElapsed: boolean | undefined;
  let wokeEarly: boolean | undefined;
  let actionEnqueued: boolean | undefined;
  let actionRecheckCount: number | undefined;
  let actionCompleted: boolean | undefined;
  let planEnqueued: boolean | undefined;
  let planRecheckCount: number | undefined;
  let repeatTaken: number | undefined;
  let repeatTotal: number | null | undefined;
  let events: EnrollmentEventRef[] = [];

  const smartWaits = node.type === "trigger" ? coletarEsperasAdaptativas(graph.nodes) : [];
  const vaiPlanejar = smartWaits.length > 0 && (enrollment.timing_plan ?? null) === null;
  const precisaEventos =
    vaiPlanejar ||
    node.type === "wait" ||
    node.type === "ai_classify" ||
    node.type === "match_reply" ||
    node.type === "action" ||
    node.type === "repeat";

  if (precisaEventos) {
    events = await db.loadEnrollmentEvents(enrollment.id);
  }

  if (vaiPlanejar) {
    planEnqueued = resolveWaitPhase(events, node.id, enrollment.steps_taken);
    planRecheckCount = events.filter((e) => e.node_id === node.id).length;
  }

  if (node.type === "wait" || node.type === "ai_classify" || node.type === "match_reply" || node.type === "action") {
    waitElapsed = resolveWaitPhase(events, node.id, enrollment.steps_taken);
    // match_reply de captação: a confirmação já enfileirou um evento neste nó.
    // O claim seguinte às vezes chega com steps_taken desalinhado da chave
    // `${node}:${steps-1}` — sem isto o motor trata como 1ª visita e MANDA A
    // PERGUNTA DE NOVO em vez de ler o SIM.
    if (node.type === "match_reply") {
      waitElapsed = waitElapsed || occupancyEventCount(events, node.id) > 0;
    }
    if (node.type === "ai_classify" || node.type === "match_reply" || node.type === "wait") {
      const wakeKey = `${node.id}:${enrollment.steps_taken}:wake`;
      wokeEarly = events.some((e) => e.node_id === node.id && e.idempotency_key === wakeKey);
    }
    if (node.type === "action") {
      actionEnqueued = waitElapsed;
      actionRecheckCount = occupancyEventCount(events.filter((event) => event.event_type !== "send_deferred"), node.id);
      actionCompleted = actionTurnCompleted(events, node.id);
      if (actionEnqueued && !actionCompleted) {
        const envio = events.findLast((event) => event.node_id === node.id
          && event.event_type === "turn_enqueued" && event.payload?.purpose === "send_message");
        const stepKey = envio?.idempotency_key;
        const reavaliarEm = stepKey
          ? await db.loadDeferredSend?.(enrollment, stepKey, clock())
          : null;
        if (stepKey && reavaliarEm) {
          // O job mantém a estadia no nó. Não consome passos nem rechecks durante o adiamento.
          const patch = { next_eval_at: reavaliarEm, claimed_until: null };
          // Sufixo não numérico: o evento não representa avanço do motor.
          const idempotencyKey = `${stepKey}:defer:${reavaliarEm}`;
          if (db.applyEnrollmentStep && !events.some((event) => event.idempotency_key === idempotencyKey)) {
            await db.applyEnrollmentStep(enrollment.id, enrollment.organization_id, patch, {
              node_id: node.id,
              event_type: "send_deferred",
              payload: { next_eval_at: reavaliarEm },
              idempotency_key: idempotencyKey,
            });
          } else {
            await db.updateEnrollment(enrollment.id, enrollment.organization_id, patch);
          }
          summary.scheduled++;
          return;
        }
      }
    }
  }
  const textoInbound = inboundBodyOverride?.trim() ?? "";
  if (textoInbound && (node.type === "match_reply" || node.type === "wait")) {
    wokeEarly = true;
  }

  if (node.type === "repeat") {
    repeatTaken = repeatTakenFromEvents(events, node.id);
    repeatTotal = repeatTotalFromEvents(events, node.id);
  }

  let lastInboundBody: string | undefined;
  if (textoInbound && node.type === "match_reply") {
    lastInboundBody = textoInbound;
  } else if (
    (node.type === "match_reply" && (wokeEarly || waitElapsed)) ||
    (node.type === "repeat" && repeatTotal == null)
  ) {
    // Sempre no contato inteiro: a captação e o WhatsApp podem ser conversas
    // diferentes, e filtrar pela conversation_id do enrollment esconde o SIM.
    lastInboundBody =
      (await db.loadLastInboundBody(
        enrollment.organization_id,
        enrollment.contact_id,
        null,
        enrollment.updated_at,
      )) ?? "";
    if (node.type === "match_reply" && lastInboundBody.trim()) {
      wokeEarly = true;
    }
  }

  const nextAlways = selectEdge(graph.edges, node.id, { type: "always" });
  const proximo = nextAlways ? (graph.nodes.find((n) => n.id === nextAlways.target) ?? null) : null;

  const sendWindow = node.type === "wait" && node.config.mode === "business_hours" && !waitElapsed && !wokeEarly
    ? await db.loadSendWindow?.(enrollment.organization_id, enrollment.pointer_id)
    : undefined;
  const result = processNode({
    node,
    sendWindow,
    edges: graph.edges,
    enrollment,
    lead,
    clock,
    waitElapsed,
    wokeEarly,
    lastInboundBody,
    actionEnqueued,
    actionRecheckCount,
    actionCompleted,
    smartWaits,
    planEnqueued,
    planRecheckCount,
    repeatTaken,
    repeatTotal,
    proximo,
  });
  await applyResult(
    deps,
    enrollment,
    node,
    result,
    summary,
    smartWaits,
    events,
    node.type === "match_reply" && wokeEarly ? (lastInboundBody ?? "").trim() || null : null,
    lead.contact_name ?? null,
  );
}

export async function runFollowupTick(deps: TickDeps, opts?: { limit?: number }): Promise<TickSummary> {
  const summary: TickSummary = { claimed: 0, advanced: 0, scheduled: 0, failed: 0, dead: 0 };

  let claimed: EnrollmentRow[];
  try {
    claimed = await deps.db.claimDueEnrollments(opts?.limit ?? DEFAULT_CLAIM_LIMIT, CLAIM_LEASE_SECONDS);
  } catch (err) {
    // Claim falhando é infra (DB fora do ar) — o tick seguinte tenta de novo, e
    // NUNCA lança: derrubar o worker por isso pararia todos os follow-ups.
    //
    // Mas silenciar é o defeito: `claimed: 0` aqui é indistinguível de "nada
    // vencido", que é o estado normal. Se o claim falhar SEMPRE, o follow-up
    // morre inteiro e o sintoma é a ausência de sintoma — ninguém descobre.
    // A doutrina já tem a regra escrita para o audit (`CLAUDE.md`: falha de
    // write gera alerta, não bloqueia); aqui ela vale igual.
    logger.error("followup: claim falhou — tick sem enrollments, NAO e 'nada vencido'", {
      erro: err instanceof Error ? err.message : String(err),
    });
    summary.claim_falhou = true;
    return summary;
  }
  summary.claimed = claimed.length;

  for (const enrollment of claimed) {
    try {
      await processEnrollment(deps, enrollment, summary);
    } catch (err) {
      try {
        // Nunca deixa uma falha de UM enrollment derrubar o tick inteiro.
        await applyHandlerFailure(deps, enrollment, errorMessage(err), summary);
      } catch {
        // Até a escrita de falha falhou (DB fora do ar no meio do tick) — o
        // enrollment fica com o claim até o lease expirar e um tick futuro
        // tenta de novo; nunca deixa isso derrubar os OUTROS enrollments do lote.
      }
    }
  }

  return summary;
}

/** Production adapter: `AdminClient` backed by the real Supabase service-role client. */
export function createSupabaseAdminClient(admin: SupabaseClient): AdminClient {
  const revisions=new Map<string,number>();
  return {
    async assertServiceBoundary(enrollment) { if(!revisions.has(enrollment.id) && enrollment.revision!==undefined) revisions.set(enrollment.id,enrollment.revision); await assertServiceBoundarySupabase(admin, enrollment.service_boundary ?? null); },
    async assertAgenda(enrollment){await assertAgendaEffectSupabase(admin,{organizationId:enrollment.organization_id,contactId:enrollment.contact_id,enrollmentId:enrollment.id,nodeId:enrollment.current_node_id});},
    async claimDueEnrollments(limit, leaseSeconds) {
      const { data, error } = await admin.rpc("fn_claim_due_followup_enrollments", {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(error.message);
      for(const row of data??[]) revisions.set(row.id,Number(row.revision));
      return (data ?? []) as EnrollmentRow[];
    },
    async loadFlowGraph(orgId, versionId) {
      const { data, error } = await admin
        .from("followup_flow_versions")
        .select("graph")
        .eq("organization_id", orgId)
        .eq("id", versionId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return flowGraphSchema.parse(data.graph);
    },
    async loadLeadFacts(orgId, contactId) {
      const [{ data: lead, error: leadErr }, { data: contact, error: contactErr }] = await Promise.all([
        admin
          .from("crm_leads")
          .select("stage_id, tags, custom_fields")
          .eq("organization_id", orgId)
          .eq("contact_id", contactId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from("contacts").select("name").eq("organization_id", orgId).eq("id", contactId).maybeSingle(),
      ]);
      if (leadErr) throw new Error(leadErr.message);
      if (contactErr) throw new Error(contactErr.message);
      const custom =
        lead?.custom_fields && typeof lead.custom_fields === "object" && !Array.isArray(lead.custom_fields)
          ? (lead.custom_fields as Record<string, unknown>)
          : {};
      return {
        lead_stage: lead?.stage_id ?? null,
        tags: lead?.tags ?? [],
        contact_name: contact?.name ?? null,
        custom_fields: custom,
      };
    },
    async loadLastInboundBody(orgId, contactId, conversationId, naoAntesDe) {
      const ids = await idsDoContatoEGemeos(admin, orgId, contactId);
      let q = admin
        .from("messages")
        .select("body")
        .eq("organization_id", orgId)
        .in("contact_id", ids)
        .eq("direction", "inbound");
      if (conversationId) q = q.eq("conversation_id", conversationId);
      if (naoAntesDe) q = q.gte("sent_at", naoAntesDe);
      const { data, error } = await q.order("sent_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      return typeof data?.body === "string" ? data.body : null;
    },
    async loadEnrollmentEvents(enrollmentId) {
      const { data, error } = await admin
        .from("followup_enrollment_events")
        .select("node_id, idempotency_key, event_type, payload")
        .eq("enrollment_id", enrollmentId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        node_id: row.node_id,
        idempotency_key: row.idempotency_key,
        event_type: row.event_type,
        payload:
          row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : null,
      }));
    },
    async insertEnrollmentEvent(event) {
      const { error } = await admin.from("followup_enrollment_events").insert(event);
      if (error) {
        if (error.code === "23505") return { inserted: false };
        throw new Error(error.message);
      }
      return { inserted: true };
    },
    async applyEnrollmentStep(id,orgId,patch,event){
      const revision=revisions.get(id);if(revision===undefined) throw new StaleServiceBoundaryError();
      const {data,error}=await admin.rpc("fn_followup_apply_step",{p_org:orgId,p_id:id,p_revision:revision,p_patch:patch,p_event:event});
      if(error?.code==="23505") return;
      if(error?.code==="40001") throw new StaleServiceBoundaryError();
      if(error) throw error;revisions.set(id,Number(data));
    },
    async updateEnrollment(id, orgId, patch) {
      const revision=revisions.get(id);
      if(revision===undefined) throw new StaleServiceBoundaryError();
      const {data,error}=await admin.rpc("fn_followup_patch",{p_org:orgId,p_id:id,p_revision:revision,p_patch:patch});
      if(error?.code==="40001") throw new StaleServiceBoundaryError();
      if(error) throw new Error(error.message);
      revisions.set(id,Number(data));
    },
    async loadSendWindow(orgId, pointerId) {
      const { data, error } = await admin.from("followup_flow_pointers")
        .select("trigger_config")
        .eq("organization_id", orgId)
        .eq("id", pointerId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return lerJanelaDoFluxo(data?.trigger_config);
    },
    async loadDeferredSend(enrollment, stepKey, now) {
      const { data, error } = await admin.from("job_queue")
        .select("run_after")
        .eq("organization_id", enrollment.organization_id)
        .eq("contact_id", enrollment.contact_id)
        .eq("kind", "followup_turn")
        .eq("status", "pending")
        .eq("payload->>followup_enrollment_id", enrollment.id)
        .eq("payload->>node_id", enrollment.current_node_id)
        .eq("payload->>purpose", "send_message")
        .eq("payload->>source_step_key", stepKey)
        .like("last_error", `${FOLLOWUP_DEFERRED}%`)
        .gt("run_after", now.toISOString())
        .order("run_after", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.run_after ?? null;
    },
    async loadFlowPointerName(orgId, pointerId) {
      const { data, error } = await admin
        .from("followup_flow_pointers")
        .select("name")
        .eq("organization_id", orgId)
        .eq("id", pointerId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.name ?? null;
    },
    async insertDeadInboxItem(item) {
      const { error } = await admin.from("agent_inbox_items").insert({
        organization_id: item.organization_id,
        kind: "followup_dead",
        severity: "warn",
        title: item.title,
        body: item.body,
        ref_kind: "followup_enrollment",
        ref_id: item.ref_id,
      });
      if (error) throw new Error(error.message);
    },
    async abrirAvisoRecuperacaoEsgotada(item) {
      const { error } = await admin.from("agent_inbox_items").insert({
        organization_id: item.organization_id,
        // Reusa o kind da 0224 (mesma família: "a recuperação desta falta
        // precisa de olhar humano") — evita migration só para um rótulo, e a
        // Central já sabe renderizar `ref_kind='appointment'`.
        kind: "appointment_recovery_review",
        severity: "warn",
        title: "Cliente faltou e não respondeu à recuperação",
        body:
          "As mensagens de reengajamento pós-falta foram enviadas e o cliente não respondeu. " +
          "Decida o próximo passo e mova o card no funil.",
        ref_kind: "appointment",
        ref_id: item.appointment_id,
        appointment_revision: item.appointment_revision,
      });
      // 23505 = já há aviso para esta (compromisso, revisão): o índice único
      // `inbox_appointment_revision_unique` (0224) garante um por revisão,
      // inclusive depois de resolvido. Repetição é no-op, não erro.
      if (error && error.code !== "23505") throw new Error(error.message);
    },
    async persistirRespostaFollowup(input) {
      await persistirRespostaFollowupSupabase(admin, input);
    },
    async criarTarefaHumana(input) {
      return criarTarefaHumana(admin, input);
    },
    async moverEtapa(input) {
      return moverEtapaDoFluxo(admin, input);
    },
  };
}
