import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/register-all";
import {
  bolhaDeMensagemSchema,
  caminhoDeAtivoDeImagemValido,
  ehBolhaDeImagem,
  erroDaListaDeBolhas,
  MAX_BOLHAS_PRIMEIRA_MENSAGEM,
  type BolhaDeImagem,
  type BolhaDeMensagem,
} from "@/lib/automation/bolha-de-mensagem";
import { reportarEnvio, type MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import { buildContext } from "@/lib/automation/engine";
import {
  CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
  EVENTO_FILA_PRIMEIRA_MENSAGEM,
  FILA_PRIMEIRA_MENSAGEM_DEFAULTS,
  idDaBolhaFilaPrimeiraMensagem,
  pausaEntrePartesSegundos,
  semMarcadorDaFila,
  type ItemFilaPrimeiraMensagem,
} from "@/lib/automation/fila-primeira-mensagem";
import { adiarAteAJanelaAbrir, knobsDoCanal } from "@/lib/automation/janela-do-canal";
import { renderTemplate, type RenderTemplateOptions } from "@/lib/automation/template";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { proximaAberturaDaJanela } from "@/lib/agent-engine/pacing/engine";
import { serviceForAutomation } from "@/lib/atendimento/origem-automacao";
import { capabilitiesOf, type ChannelProvider } from "@/lib/channels";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { comandoDaConversa, silencioVigente } from "@/lib/inbox/comando-da-conversa";
import {
  ORIGENS_DE_RESPOSTA_HUMANA,
  houveRespostaHumanaDepoisDoEvento,
} from "@/lib/messaging/resposta-humana";
import { ehPedidoDeOptOut } from "@/lib/opt-out/deteccao";
import { checarGuardasDeContato } from "@/lib/automation/guarda-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

const LIMITE_JANELA_OFICIAL_MS = 23 * 60 * 60 * 1_000;
const RETENTATIVA_CURTA_MS = 60_000;
const RETENTATIVA_CONVERSA_OCUPADA_MS = 25_000;

export type MotivoDescarteFila =
  | "tag_nao_contatar"
  | "tag_sem_followup"
  | "pedido_opt_out"
  | "janela_24h_expirada"
  | "espera_maxima_excedida"
  | "janela_24h_desconhecida"
  | "humano_respondeu"
  | "conversa_atribuida"
  | "ia_pausada"
  | "contato_forca_humano"
  | "regra_indisponivel";

export interface SnapshotGuardaFila {
  ruleActive: boolean;
  tags: string[];
  isBlocked: boolean;
  forceHuman: boolean;
  latestInboundBody: string | null;
  latestInboundAt: string | null;
  humanRepliedAfterQueue: boolean;
  conversation: {
    status: string;
    assignedToUserId: string | null;
    assigneeKind: string | null;
    botSilencedUntil: string | null;
  };
}

export interface PoliticaEsperaFila {
  limiteMs: number;
  motivoExcedido: "janela_24h_expirada" | "espera_maxima_excedida";
}

const POLITICA_JANELA_OFICIAL: PoliticaEsperaFila = {
  limiteMs: LIMITE_JANELA_OFICIAL_MS,
  motivoExcedido: "janela_24h_expirada",
};

export function politicaEsperaFilaPorCanal(
  provider: ChannelProvider,
  maxWaitHours: number | null | undefined,
): PoliticaEsperaFila {
  if (!capabilitiesOf(provider).freeformOutsideWindow) {
    return POLITICA_JANELA_OFICIAL;
  }
  const configuradoValido =
    typeof maxWaitHours === "number" &&
    Number.isInteger(maxWaitHours) &&
    maxWaitHours >= 1 &&
    maxWaitHours <= 168;
  const horas = configuradoValido ? maxWaitHours : FILA_PRIMEIRA_MENSAGEM_DEFAULTS.maxWaitHours;
  return {
    limiteMs: horas * 60 * 60 * 1_000,
    motivoExcedido: "espera_maxima_excedida",
  };
}

export function motivoParaDescartarFila(
  snapshot: SnapshotGuardaFila,
  now: Date = new Date(),
  politica: PoliticaEsperaFila = POLITICA_JANELA_OFICIAL,
): MotivoDescarteFila | null {
  if (!snapshot.ruleActive) return "regra_indisponivel";
  if (snapshot.tags.includes("nao_contatar")) return "tag_nao_contatar";
  if (snapshot.tags.includes("sem_followup")) return "tag_sem_followup";
  if (snapshot.isBlocked || ehPedidoDeOptOut(snapshot.latestInboundBody)) {
    return "pedido_opt_out";
  }

  const motivoTemporal = motivoTemporalParaDescartarFila(snapshot.latestInboundAt, now, politica);
  if (motivoTemporal) return motivoTemporal;
  if (snapshot.humanRepliedAfterQueue) return "humano_respondeu";
  if (
    snapshot.conversation.assignedToUserId !== null ||
    snapshot.conversation.assigneeKind === "user"
  ) {
    return "conversa_atribuida";
  }
  if (snapshot.forceHuman) return "contato_forca_humano";
  if (
    silencioVigente(snapshot.conversation.botSilencedUntil, now).vigente ||
    !comandoDaConversa(
      {
        status: snapshot.conversation.status,
        assigned_to_user_id: snapshot.conversation.assignedToUserId,
        assignee_kind: snapshot.conversation.assigneeKind,
        bot_silenced_until: snapshot.conversation.botSilencedUntil,
        force_human: snapshot.forceHuman,
        is_blocked: snapshot.isBlocked,
      },
      now,
    ).automaticoAtivo
  ) {
    return "ia_pausada";
  }
  return null;
}

function motivoTemporalParaDescartarFila(
  latestInboundAt: string | null,
  now: Date,
  politica: PoliticaEsperaFila,
): "janela_24h_desconhecida" | PoliticaEsperaFila["motivoExcedido"] | null {
  const latestInboundMs = Date.parse(latestInboundAt ?? "");
  if (!Number.isFinite(latestInboundMs)) return "janela_24h_desconhecida";
  if (now.getTime() - latestInboundMs > politica.limiteMs) {
    return politica.motivoExcedido;
  }
  return null;
}

export interface TurnoFila {
  decision:
    | "ready"
    | "claimed"
    | "paused"
    | "not_head"
    | "interval"
    | "daily_limit"
    | "processing"
    | "terminal"
    | "stale";
  retry_at: string | null;
  next_day_start: string | null;
}

export interface RuntimeFilaPrimeiraMensagem {
  now(): Date;
  foraDaJanela(item: ItemFilaPrimeiraMensagem): Promise<string | null>;
  turno(item: ItemFilaPrimeiraMensagem, claim: boolean): Promise<TurnoFila>;
  politicaEspera(item: ItemFilaPrimeiraMensagem): Promise<PoliticaEsperaFila>;
  ultimaEntradaEm(item: ItemFilaPrimeiraMensagem): Promise<string | null>;
  conversaEmAndamento(item: ItemFilaPrimeiraMensagem): Promise<boolean>;
  snapshot(item: ItemFilaPrimeiraMensagem): Promise<SnapshotGuardaFila>;
  descartar(item: ItemFilaPrimeiraMensagem, reason: MotivoDescarteFila): Promise<void>;
  prepararPartes(item: ItemFilaPrimeiraMensagem): Promise<ItemFilaPrimeiraMensagem>;
  enviarBolha(
    item: ItemFilaPrimeiraMensagem,
    bolha: BolhaDeMensagem,
    index: number,
  ): Promise<ActionResultDetail>;
  registrarBolha(
    item: ItemFilaPrimeiraMensagem,
    index: number,
    result: ActionResultDetail,
  ): Promise<void>;
  acompanharMensagem(item: ItemFilaPrimeiraMensagem): Promise<ActionResultDetail | null>;
  depoisDaPrimeiraBolha(item: ItemFilaPrimeiraMensagem): Promise<void>;
  pausarEntreBolhas(milliseconds: number): Promise<void>;
  finalizar(item: ItemFilaPrimeiraMensagem, result: ActionResultDetail): Promise<void>;
  reagendar(item: ItemFilaPrimeiraMensagem, retryAt: string): Promise<void>;
  proximaAberturaDoDiaSeguinte(item: ItemFilaPrimeiraMensagem, anchor: string): Promise<string>;
  acordarOrigem(item: ItemFilaPrimeiraMensagem): Promise<void>;
}

async function motivoAtualParaDescartarFila(
  runtime: RuntimeFilaPrimeiraMensagem,
  item: ItemFilaPrimeiraMensagem,
): Promise<MotivoDescarteFila | null> {
  const [snapshot, politica] = await Promise.all([
    runtime.snapshot(item),
    runtime.politicaEspera(item),
  ]);
  return motivoParaDescartarFila(snapshot, runtime.now(), politica);
}

async function esperaMaximaExcedidaAntesDosAdiamentos(
  runtime: RuntimeFilaPrimeiraMensagem,
  item: ItemFilaPrimeiraMensagem,
): Promise<"espera_maxima_excedida" | null> {
  const politica = await runtime.politicaEspera(item);
  if (politica.motivoExcedido !== "espera_maxima_excedida") return null;
  const motivo = motivoTemporalParaDescartarFila(
    await runtime.ultimaEntradaEm(item),
    runtime.now(),
    politica,
  );
  return motivo === "espera_maxima_excedida" ? motivo : null;
}

function partesDoItem(item: ItemFilaPrimeiraMensagem): BolhaDeMensagem[] {
  if (
    Array.isArray(item.message_parts) &&
    item.message_parts.length >= 2 &&
    item.message_parts.length <= MAX_BOLHAS_PRIMEIRA_MENSAGEM &&
    item.message_parts.every((part) => bolhaDeMensagemSchema.safeParse(part).success)
  ) {
    return item.message_parts;
  }
  const template = item.action_config.template;
  return typeof template === "string" && template.length > 0 ? [template] : [];
}

function resultadoInterrompido(
  item: ItemFilaPrimeiraMensagem,
  total: number,
  reason: MotivoDescarteFila,
): ActionResultDetail {
  if (item.sent_part_count === 0) {
    return {
      type: "send_whatsapp_message",
      status: "skipped",
      detail: { reason },
    };
  }
  return {
    type: "send_whatsapp_message",
    status: "success",
    detail: {
      partial: true,
      reason,
      sent_parts: item.sent_part_count,
      total_parts: total,
      message_ids: item.outbound_message_ids,
    },
  };
}

async function processarBolhas(
  runtime: RuntimeFilaPrimeiraMensagem,
  original: ItemFilaPrimeiraMensagem,
): Promise<HandlerResult> {
  const partesBrutas = original.message_parts ?? original.action_config.templates;
  if (partesBrutas !== undefined && partesBrutas !== null) {
    const erroDasPartes = erroDaListaDeBolhas(partesBrutas);
    if (erroDasPartes) {
      const result: ActionResultDetail = {
        type: "send_whatsapp_message",
        status: "failed",
        error: erroDasPartes,
      };
      await runtime.finalizar(original, result);
      await runtime.acordarOrigem(original);
      return {
        consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
        status: "ok",
        detail: erroDasPartes,
      };
    }
  }
  const item = await runtime.prepararPartes(original);
  const parts = partesDoItem(item);
  if (parts.length === 0) {
    const result: ActionResultDetail = {
      type: "send_whatsapp_message",
      status: "failed",
      error: "first_message_queue_missing_template",
    };
    await runtime.finalizar(item, result);
    await runtime.acordarOrigem(item);
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: result.error,
    };
  }

  // Se o worker caiu depois de persistir a primeira bolha, a aplicação da tag
  // é repetida com segurança: add_tag faz merge idempotente e não reemite evento.
  if (item.sent_part_count > 0) await runtime.depoisDaPrimeiraBolha(item);

  for (let index = item.sent_part_count; index < parts.length; index += 1) {
    const descarte = await motivoAtualParaDescartarFila(runtime, item);
    if (descarte) {
      const result = resultadoInterrompido(item, parts.length, descarte);
      await runtime.finalizar(item, result);
      await runtime.acordarOrigem(item);
      return {
        consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
        status: "ok",
        detail: item.sent_part_count > 0 ? `parcial:${descarte}` : descarte,
      };
    }

    const result = await runtime.enviarBolha(item, parts[index]!, index);
    await runtime.registrarBolha(item, index, result);

    if (result.status === "success") {
      if (index === 0) await runtime.depoisDaPrimeiraBolha(item);
      if (index < parts.length - 1) {
        await runtime.pausarEntreBolhas(
          pausaEntrePartesSegundos(item, parts[index]!, parts[index + 1]!) * 1_000,
        );
      }
      continue;
    }

    if (result.status === "postponed") {
      await runtime.finalizar(item, result);
      const at = new Date(runtime.now().getTime() + RETENTATIVA_CURTA_MS).toISOString();
      await runtime.reagendar(item, at);
      return retry(at, `bolha_${index + 1}_aguardando_canal`);
    }

    const partial = item.sent_part_count > 0;
    const partialError =
      partial && result.status === "failed"
        ? `partial_send_failed:${result.error ?? "message_failed"}`
        : null;
    const terminal: ActionResultDetail = partial
      ? {
          type: "send_whatsapp_message",
          status: result.status === "skipped" ? "success" : "failed",
          ...(partialError ? { error: partialError } : {}),
          detail: {
            partial: true,
            reason: partialError ?? result.detail?.reason ?? result.error ?? "message_not_sent",
            failed_part_index: index,
            sent_parts: item.sent_part_count,
            total_parts: parts.length,
            message_ids: item.outbound_message_ids,
          },
        }
      : result;
    await runtime.finalizar(item, terminal);
    await runtime.acordarOrigem(item);
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: partial ? (terminal.error ?? "parcial_interrompido") : terminal.status,
    };
  }

  const result: ActionResultDetail = {
    type: "send_whatsapp_message",
    status: "success",
    detail: {
      sent_parts: parts.length,
      total_parts: parts.length,
      message_ids: item.outbound_message_ids,
    },
  };
  await runtime.finalizar(item, result);
  await runtime.acordarOrigem(item);
  return {
    consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
    status: "ok",
    detail: "success",
  };
}

function retry(retryAt: string, detail: string): HandlerResult {
  return {
    consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
    status: "retry",
    retry_at: retryAt,
    detail,
  };
}

export async function processarItemFilaPrimeiraMensagem(
  runtime: RuntimeFilaPrimeiraMensagem,
  item: ItemFilaPrimeiraMensagem,
): Promise<HandlerResult> {
  if (["sent", "discarded", "failed"].includes(item.status)) {
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: item.status,
    };
  }

  if (
    item.status === "processing" &&
    item.message_parts === null &&
    item.sent_part_count === 0 &&
    item.outbound_message_id
  ) {
    const acompanhado = await runtime.acompanharMensagem(item);
    if (acompanhado) {
      await runtime.finalizar(item, acompanhado);
      if (acompanhado.status !== "postponed") await runtime.acordarOrigem(item);
      if (acompanhado.status === "postponed") {
        const at = new Date(runtime.now().getTime() + RETENTATIVA_CURTA_MS).toISOString();
        await runtime.reagendar(item, at);
        return retry(at, "mensagem_da_fila_ainda_pendente");
      }
      return {
        consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
        status: "ok",
        detail: acompanhado.status,
      };
    }
  }
  if (item.status === "processing") return processarBolhas(runtime, item);

  const esperaExcedida = await esperaMaximaExcedidaAntesDosAdiamentos(runtime, item);
  if (esperaExcedida) {
    await runtime.descartar(item, esperaExcedida);
    await runtime.acordarOrigem(item);
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: esperaExcedida,
    };
  }

  const janela = await runtime.foraDaJanela(item);
  if (janela) {
    await runtime.reagendar(item, janela);
    return retry(janela, "fora_da_janela_do_canal");
  }

  const vista = await runtime.turno(item, false);
  if (vista.decision === "terminal" || vista.decision === "stale") {
    await runtime.acordarOrigem(item);
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: vista.decision,
    };
  }
  if (vista.decision !== "ready") {
    const at =
      vista.decision === "daily_limit" && vista.next_day_start
        ? await runtime.proximaAberturaDoDiaSeguinte(item, vista.next_day_start)
        : (vista.retry_at ??
          new Date(runtime.now().getTime() + RETENTATIVA_CURTA_MS).toISOString());
    await runtime.reagendar(item, at);
    return retry(at, vista.decision);
  }

  const descarte = await motivoAtualParaDescartarFila(runtime, item);
  if (descarte) {
    await runtime.descartar(item, descarte);
    await runtime.acordarOrigem(item);
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: descarte,
    };
  }

  if (await runtime.conversaEmAndamento(item)) {
    const at = new Date(runtime.now().getTime() + RETENTATIVA_CONVERSA_OCUPADA_MS).toISOString();
    await runtime.reagendar(item, at);
    return retry(at, "aguardando_conversa_em_andamento");
  }

  const claim = await runtime.turno(item, true);
  if (claim.decision !== "claimed") {
    const at =
      claim.decision === "daily_limit" && claim.next_day_start
        ? await runtime.proximaAberturaDoDiaSeguinte(item, claim.next_day_start)
        : (claim.retry_at ??
          new Date(runtime.now().getTime() + RETENTATIVA_CURTA_MS).toISOString());
    await runtime.reagendar(item, at);
    return retry(at, claim.decision);
  }

  return processarBolhas(runtime, { ...item, status: "processing" });
}

interface LinhaKnobConversaEmAndamento {
  first_message_queue_busy_minutes: number | null;
}

/**
 * A fila só espera por uma saída humana recente em OUTRA conversa do mesmo
 * número. A autoria vem da fonte canônica de `resposta-humana`; automação, IA,
 * modelo e a própria fila ficam fora sem manter uma segunda lista divergente.
 */
export async function haConversaHumanaEmAndamentoNoCanal(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
  now: Date = new Date(),
): Promise<boolean> {
  const { data: rawKnob, error: knobError } = await admin
    .from("channel_knobs")
    .select("first_message_queue_busy_minutes")
    .eq("organization_id", item.organization_id)
    .eq("channel_session_id", item.channel_session_id)
    .maybeSingle();
  if (knobError) {
    throw new Error(`first_message_queue_busy_knob_read_failed: ${knobError.message}`);
  }

  const knob = rawKnob as LinhaKnobConversaEmAndamento | null;
  const busyMinutes = knob?.first_message_queue_busy_minutes ?? 0;
  if (!Number.isInteger(busyMinutes) || busyMinutes <= 0) return false;

  const since = new Date(now.getTime() - busyMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", item.organization_id)
    .eq("channel_session_id", item.channel_session_id)
    .eq("direction", "outbound")
    .in("sent_via", [...ORIGENS_DE_RESPOSTA_HUMANA])
    .in("status", ["sent", "delivered", "read"])
    .neq("type", "template")
    .neq("conversation_id", item.conversation_id)
    .gte("sent_at", since)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`first_message_queue_busy_check_failed: ${error.message}`);
  }
  return Boolean(data);
}

interface LinhaSessaoDaPoliticaDeEspera {
  provider: ChannelProvider;
}

interface LinhaKnobDaPoliticaDeEspera {
  first_message_queue_max_wait_hours: number | null;
}

export async function carregarPoliticaEsperaFila(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
): Promise<PoliticaEsperaFila> {
  const [sessionResult, knobResult] = await Promise.all([
    admin
      .from("channel_sessions")
      .select("provider")
      .eq("organization_id", item.organization_id)
      .eq("id", item.channel_session_id)
      .maybeSingle(),
    admin
      .from("channel_knobs")
      .select("first_message_queue_max_wait_hours")
      .eq("organization_id", item.organization_id)
      .eq("channel_session_id", item.channel_session_id)
      .maybeSingle(),
  ]);
  const readError = sessionResult.error ?? knobResult.error;
  if (readError) {
    throw new Error(`first_message_queue_wait_policy_read_failed: ${readError.message}`);
  }
  if (!sessionResult.data) {
    throw new Error("first_message_queue_wait_policy_channel_missing");
  }
  const session = sessionResult.data as LinhaSessaoDaPoliticaDeEspera;
  const knob = knobResult.data as LinhaKnobDaPoliticaDeEspera | null;
  return politicaEsperaFilaPorCanal(session.provider, knob?.first_message_queue_max_wait_hours);
}

async function carregarUltimaEntradaEm(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
): Promise<string | null> {
  const { data, error } = await admin
    .from("messages")
    .select("sent_at")
    .eq("organization_id", item.organization_id)
    .eq("conversation_id", item.conversation_id)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`first_message_queue_latest_inbound_read_failed: ${error.message}`);
  }
  return (data as { sent_at: string | null } | null)?.sent_at ?? null;
}

function primeiraLinha<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === "object") return data as T;
  return null;
}

async function carregarItem(
  admin: SupabaseClient,
  organizationId: string,
  queueId: string,
): Promise<ItemFilaPrimeiraMensagem | null> {
  const { data, error } = await admin
    .from("automation_first_message_queue")
    .select("*")
    .eq("id", queueId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`first_message_queue_read_failed: ${error.message}`);
  return (data as ItemFilaPrimeiraMensagem | null) ?? null;
}

async function carregarSnapshot(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
  now: Date,
): Promise<SnapshotGuardaFila> {
  const [contactResult, conversationResult, inboundResult, ruleResult, humanReplied] =
    await Promise.all([
      admin
        .from("contacts")
        .select("tags, is_blocked, force_human")
        .eq("id", item.contact_id)
        .eq("organization_id", item.organization_id)
        .maybeSingle(),
      admin
        .from("conversations")
        .select("status, assigned_to_user_id, assignee_kind, bot_silenced_until")
        .eq("id", item.conversation_id)
        .eq("organization_id", item.organization_id)
        .maybeSingle(),
      admin
        .from("messages")
        .select("body, sent_at")
        .eq("organization_id", item.organization_id)
        .eq("conversation_id", item.conversation_id)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("automation_rules")
        .select("is_active")
        .eq("id", item.rule_id)
        .eq("organization_id", item.organization_id)
        .maybeSingle(),
      houveRespostaHumanaDepoisDoEvento(admin, {
        organizationId: item.organization_id,
        conversationId: item.conversation_id,
        eventCreatedAt: item.enqueued_at,
      }),
    ]);

  const readError =
    contactResult.error ?? conversationResult.error ?? inboundResult.error ?? ruleResult.error;
  if (readError) throw new Error(`first_message_queue_guard_read_failed: ${readError.message}`);
  if (!contactResult.data || !conversationResult.data) {
    throw new Error("first_message_queue_guard_target_missing");
  }
  const contact = contactResult.data as {
    tags: string[] | null;
    is_blocked: boolean | null;
    force_human: boolean | null;
  };
  const conversation = conversationResult.data as {
    status: string | null;
    assigned_to_user_id: string | null;
    assignee_kind: string | null;
    bot_silenced_until: string | null;
  };
  const inbound = inboundResult.data as { body: string | null; sent_at: string | null } | null;
  void now;
  return {
    ruleActive: ruleResult.data?.is_active === true,
    tags: contact.tags ?? [],
    isBlocked: contact.is_blocked === true,
    forceHuman: contact.force_human === true,
    latestInboundBody: inbound?.body ?? null,
    latestInboundAt: inbound?.sent_at ?? null,
    humanRepliedAfterQueue: humanReplied,
    conversation: {
      status: conversation.status ?? "open",
      assignedToUserId: conversation.assigned_to_user_id,
      assigneeKind: conversation.assignee_kind,
      botSilencedUntil: conversation.bot_silenced_until,
    },
  };
}

interface OrigemDaFila {
  event: EventRow;
  rule: {
    id: string;
    name: string;
    is_active: boolean;
    actions: Array<{ type: string; config?: Record<string, unknown> }>;
  };
  context: Record<string, unknown>;
}

export function renderizarBolhaDaFila(
  bolha: BolhaDeMensagem,
  context: Record<string, unknown>,
  options: RenderTemplateOptions,
): BolhaDeMensagem {
  if (typeof bolha === "string") return renderTemplate(bolha, context, options);
  return {
    ...bolha,
    ...(bolha.legenda !== undefined
      ? { legenda: renderTemplate(bolha.legenda, context, options) }
      : {}),
  };
}

async function carregarOrigemDaFila(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
): Promise<OrigemDaFila | null> {
  const [{ data: eventData, error: eventError }, { data: ruleData, error: ruleError }] =
    await Promise.all([
      admin
        .from("event_log")
        .select("*")
        .eq("id", item.original_event_id)
        .eq("organization_id", item.organization_id)
        .maybeSingle(),
      admin
        .from("automation_rules")
        .select("id, name, is_active, actions")
        .eq("id", item.rule_id)
        .eq("organization_id", item.organization_id)
        .maybeSingle(),
    ]);
  if (eventError || ruleError) {
    throw new Error(
      `first_message_queue_origin_read_failed: ${eventError?.message ?? ruleError?.message}`,
    );
  }
  const rule = ruleData as OrigemDaFila["rule"] | null;
  if (!eventData || !rule) return null;
  const event = eventData as unknown as EventRow;
  return { event, rule, context: await buildContext(admin, event) };
}

function configDaBolha(
  actionConfig: Record<string, unknown>,
  body: string,
): Record<string, unknown> {
  const {
    fila: _fila,
    templates: _templates,
    pausa_entre_bolhas_segundos: _pausa,
    pausa_entre_imagens_segundos: _pausaImagens,
    ...restante
  } = actionConfig;
  return { ...restante, template: body };
}

function contextoDaBolha(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
  origem: OrigemDaFila,
  index: number,
): ActionCtx {
  const internalMessageId = idDaBolhaFilaPrimeiraMensagem(item.id, index);
  return {
    admin,
    organizationId: item.organization_id,
    ruleId: item.rule_id,
    ruleName: origem.rule.name,
    event: origem.event,
    context: origem.context,
    requestId: `first-message:${item.id}:${index}`,
    actionIndex: item.action_index,
    humanPacingManaged: true,
    internalMessageId,
    messageMetadata: {
      idempotency_key: `first-message:${item.id}:${index}`,
      first_message_queue_part_index: index,
    },
    serviceBoundaries: new Map(),
  };
}

function erroEhDestinoDeStorageExistente(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { statusCode?: string | number; message?: string; error?: string };
  const status = String(candidate.statusCode ?? "");
  const texto = `${candidate.error ?? ""} ${candidate.message ?? ""}`.toLocaleLowerCase();
  return status === "409" || texto.includes("already exists") || texto.includes("duplicate");
}

function mimeDaImagem(arquivo: string): "image/jpeg" | "image/png" | "image/webp" {
  if (arquivo.endsWith(".png")) return "image/png";
  if (arquivo.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function copiarAtivoDaFilaParaConversa(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
  imagem: BolhaDeImagem,
  index: number,
): Promise<{ storagePath: string; mime: "image/jpeg" | "image/png" | "image/webp" }> {
  if (!caminhoDeAtivoDeImagemValido(imagem.arquivo)) {
    throw new Error(`first_message_queue_invalid_image_path:${imagem.arquivo}`);
  }
  const extension = imagem.arquivo.split(".").at(-1)!;
  const sourcePath = `${item.organization_id}/ativos/${imagem.arquivo}`;
  const storagePath = `${item.organization_id}/${item.conversation_id}/first-message-${idDaBolhaFilaPrimeiraMensagem(item.id, index)}.${extension}`;
  const { error } = await admin.storage
    .from("whatsapp-media")
    .copy(sourcePath, storagePath);
  if (error && !erroEhDestinoDeStorageExistente(error)) {
    throw new Error(`first_message_queue_image_copy_failed:${error.message}`);
  }
  return { storagePath, mime: mimeDaImagem(imagem.arquivo) };
}

async function enviarImagemDaFila(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
  origem: OrigemDaFila,
  imagem: BolhaDeImagem,
  index: number,
): Promise<ActionResultDetail> {
  const ctx = contextoDaBolha(admin, item, origem, index);
  const guarda = checarGuardasDeContato(ctx);
  if (!guarda.ok) {
    return {
      type: "send_whatsapp_message",
      status: "skipped",
      detail: { reason: guarda.reason },
    };
  }
  if (guarda.contact.id !== item.contact_id) {
    return {
      type: "send_whatsapp_message",
      status: "failed",
      error: "first_message_queue_contact_mismatch",
    };
  }
  try {
    const boundary = await serviceForAutomation(ctx, guarda.contact.id, item.channel_session_id);
    if (boundary.conversation_id !== item.conversation_id) {
      return {
        type: "send_whatsapp_message",
        status: "failed",
        error: "first_message_queue_conversation_mismatch",
      };
    }
    const media = await copiarAtivoDaFilaParaConversa(admin, item, imagem, index);
    const message = await sendMessageHandler(
      admin,
      {
        organization_id: item.organization_id,
        serviceBoundary: boundary,
        proactiveContext: {
          organizationId: item.organization_id,
          contactId: item.contact_id,
        },
        actor: { type: "webhook_source", id: item.rule_id },
        requestId: ctx.requestId,
        internalMessageId: ctx.internalMessageId,
      },
      {
        conversation_id: item.conversation_id,
        type: "image",
        ...(imagem.legenda ? { body: imagem.legenda } : {}),
        media_storage_path: media.storagePath,
        media_mime: media.mime,
        metadata: {
          ...ctx.messageMetadata,
          first_message_queue_asset: imagem.arquivo,
        },
      } as Parameters<typeof sendMessageHandler>[2],
    );
    return await reportarEnvio(
      ctx,
      "send_whatsapp_message",
      message as unknown as MensagemEnviada,
      item.conversation_id,
    );
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(`first_message_queue_image_send_failed:${String(error)}`);
  }
}

async function finalizarNoBanco(
  admin: SupabaseClient,
  item: ItemFilaPrimeiraMensagem,
  result: ActionResultDetail,
  now: Date,
): Promise<void> {
  const messageId =
    typeof result.detail?.message_id === "string"
      ? result.detail.message_id
      : item.outbound_message_id;
  const status =
    result.status === "success"
      ? "sent"
      : result.status === "skipped"
        ? "discarded"
        : result.status === "postponed"
          ? "processing"
          : "failed";
  const reason =
    typeof result.detail?.reason === "string" ? result.detail.reason : (result.error ?? null);
  const terminal = status !== "processing";
  const { error } = await admin
    .from("automation_first_message_queue")
    .update({
      status,
      outbound_message_id: messageId ?? null,
      discard_reason: reason,
      result,
      ...(terminal ? { finished_at: now.toISOString() } : {}),
    })
    .eq("id", item.id)
    .eq("organization_id", item.organization_id);
  if (error) throw new Error(`first_message_queue_finalize_failed: ${error.message}`);
}

function runtimeReal(
  admin: SupabaseClient,
  now: () => Date = () => new Date(),
): RuntimeFilaPrimeiraMensagem {
  const politicasDeEspera = new Map<string, Promise<PoliticaEsperaFila>>();
  return {
    now,
    foraDaJanela: (item) =>
      adiarAteAJanelaAbrir(admin, item.organization_id, item.channel_session_id, now()),
    async turno(item, claim) {
      const { data, error } = await admin.rpc("fn_try_claim_automation_first_message", {
        p_organization_id: item.organization_id,
        p_queue_id: item.id,
        p_now: now().toISOString(),
        p_claim: claim,
      });
      if (error) throw new Error(`first_message_queue_claim_failed: ${error.message}`);
      const row = primeiraLinha<TurnoFila>(data);
      if (!row) throw new Error("first_message_queue_claim_empty");
      return row;
    },
    politicaEspera(item) {
      const key = `${item.organization_id}:${item.channel_session_id}`;
      const existente = politicasDeEspera.get(key);
      if (existente) return existente;
      const carregando = carregarPoliticaEsperaFila(admin, item);
      politicasDeEspera.set(key, carregando);
      return carregando;
    },
    ultimaEntradaEm: (item) => carregarUltimaEntradaEm(admin, item),
    conversaEmAndamento: (item) => haConversaHumanaEmAndamentoNoCanal(admin, item, now()),
    snapshot: (item) => carregarSnapshot(admin, item, now()),
    async descartar(item, reason) {
      const { error } = await admin
        .from("automation_first_message_queue")
        .update({
          status: "discarded",
          discard_reason: reason,
          finished_at: now().toISOString(),
        })
        .eq("id", item.id)
        .eq("organization_id", item.organization_id)
        .eq("status", "queued");
      if (error) throw new Error(`first_message_queue_discard_failed: ${error.message}`);
    },
    async prepararPartes(item) {
      if (Array.isArray(item.message_parts)) return item;
      const templates = item.action_config.templates;
      if (!Array.isArray(templates)) return item;
      const parsedTemplates = templates.map((template) => bolhaDeMensagemSchema.parse(template));
      const origem = await carregarOrigemDaFila(admin, item);
      if (!origem) return item;
      const knobs = await knobsDoCanal(admin, item.organization_id, item.channel_session_id);
      const renderedAt = now();
      const messageParts = parsedTemplates.map((template) =>
        renderizarBolhaDaFila(template, origem.context, {
          now: renderedAt,
          timezone: knobs.timezone,
        }),
      );
      const { error } = await admin
        .from("automation_first_message_queue")
        .update({ message_parts: messageParts })
        .eq("id", item.id)
        .eq("organization_id", item.organization_id)
        .is("message_parts", null);
      if (error) throw new Error(`first_message_queue_parts_snapshot_failed: ${error.message}`);
      item.message_parts = messageParts;
      return item;
    },
    async enviarBolha(item, bolha, index) {
      const origem = await carregarOrigemDaFila(admin, item);
      if (!origem?.rule.is_active) {
        return {
          type: "send_whatsapp_message",
          status: "skipped",
          detail: { reason: "regra_indisponivel" },
        };
      }
      if (ehBolhaDeImagem(bolha)) {
        return enviarImagemDaFila(admin, item, origem, bolha, index);
      }
      const executor = getAction("send_whatsapp_message");
      if (!executor) {
        return {
          type: "send_whatsapp_message",
          status: "failed",
          error: "send_whatsapp_action_unavailable",
        };
      }
      const ctx = contextoDaBolha(admin, item, origem, index);
      return executor.execute(
        ctx,
        configDaBolha(semMarcadorDaFila(item.action_config), bolha),
      );
    },
    async registrarBolha(item, index, result) {
      const messageId =
        typeof result.detail?.message_id === "string" ? result.detail.message_id : null;
      const ids = [...(item.outbound_message_ids ?? [])];
      if (messageId) ids[index] = messageId;
      const sentPartCount =
        result.status === "success"
          ? Math.max(item.sent_part_count, index + 1)
          : item.sent_part_count;
      const { error } = await admin
        .from("automation_first_message_queue")
        .update({
          sent_part_count: sentPartCount,
          outbound_message_ids: ids,
          ...(messageId ? { outbound_message_id: messageId } : {}),
          result: {
            status: "processing",
            sent_parts: sentPartCount,
            current_part_index: index,
            last_part_result: result,
          },
          updated_at: now().toISOString(),
        })
        .eq("id", item.id)
        .eq("organization_id", item.organization_id)
        .eq("status", "processing");
      if (error) throw new Error(`first_message_queue_part_progress_failed: ${error.message}`);
      item.sent_part_count = sentPartCount;
      item.outbound_message_ids = ids;
      if (messageId) item.outbound_message_id = messageId;
    },
    async acompanharMensagem(item) {
      if (!item.outbound_message_id) return null;
      const { data, error } = await admin
        .from("messages")
        .select("id, status, error_code, error_message")
        .eq("id", item.outbound_message_id)
        .eq("organization_id", item.organization_id)
        .maybeSingle();
      if (error) throw new Error(`first_message_queue_message_read_failed: ${error.message}`);
      if (!data) return null;
      const status = String(data.status);
      if (["sent", "delivered", "read"].includes(status)) {
        return {
          type: "send_whatsapp_message",
          status: "success",
          detail: { message_id: data.id },
        };
      }
      if (status === "failed") {
        return {
          type: "send_whatsapp_message",
          status: "failed",
          error: data.error_message ?? data.error_code ?? "message_failed",
          detail: { message_id: data.id, error_code: data.error_code },
        };
      }
      return {
        type: "send_whatsapp_message",
        status: "postponed",
        detail: { message_id: data.id, reason: "aguardando_o_canal" },
      };
    },
    async depoisDaPrimeiraBolha(item) {
      const origem = await carregarOrigemDaFila(admin, item);
      if (!origem?.rule.is_active) return;
      const nextAction = origem.rule.actions[item.action_index + 1];
      if (nextAction?.type !== "add_tag") return;
      const executor = getAction("add_tag");
      if (!executor) return;
      const result = await executor.execute(
        {
          admin,
          organizationId: item.organization_id,
          ruleId: item.rule_id,
          ruleName: origem.rule.name,
          event: origem.event,
          context: origem.context,
          requestId: `first-message:${item.id}:after-first-part`,
          actionIndex: item.action_index + 1,
          serviceBoundaries: new Map(),
        },
        nextAction.config ?? {},
      );
      if (result.status === "failed") {
        logger.warn("[automation.first-message-queue] add_tag após a primeira bolha falhou", {
          organization_id: item.organization_id,
          queue_id: item.id,
          rule_id: item.rule_id,
          error: result.error ?? "unknown",
        });
      }
    },
    pausarEntreBolhas: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    finalizar: (item, result) => finalizarNoBanco(admin, item, result, now()),
    async reagendar(item, retryAt) {
      const { error } = await admin
        .from("automation_first_message_queue")
        .update({ next_attempt_at: retryAt })
        .eq("id", item.id)
        .eq("organization_id", item.organization_id);
      if (error) throw new Error(`first_message_queue_reschedule_failed: ${error.message}`);
    },
    async proximaAberturaDoDiaSeguinte(item, anchor) {
      const knobs = await knobsDoCanal(admin, item.organization_id, item.channel_session_id);
      return proximaAberturaDaJanela(new Date(anchor), knobs).toISOString();
    },
    async acordarOrigem(item) {
      const { error } = await admin
        .from("event_log")
        .update({ next_attempt_at: now().toISOString() })
        .eq("id", item.original_event_id)
        .eq("organization_id", item.organization_id)
        .eq("status", "pending");
      if (error) throw new Error(`first_message_queue_wake_origin_failed: ${error.message}`);
    },
  };
}

export const filaPrimeiraMensagemHandler: EventHandler = {
  key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
  events: [EVENTO_FILA_PRIMEIRA_MENSAGEM],
  async handle(row) {
    const queueId =
      typeof row.entity_id === "string"
        ? row.entity_id
        : typeof row.payload?.queue_id === "string"
          ? row.payload.queue_id
          : null;
    if (!queueId) {
      return {
        consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
        status: "skipped",
        detail: "queue_id_missing",
      };
    }
    const admin = createAdminClient();
    const item = await carregarItem(admin, row.organization_id, queueId);
    if (!item) {
      return {
        consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
        status: "skipped",
        detail: "queue_item_missing",
      };
    }
    return processarItemFilaPrimeiraMensagem(runtimeReal(admin), item);
  },
};
