import type { SupabaseClient } from "@supabase/supabase-js";

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/register-all";
import { buildContext } from "@/lib/automation/engine";
import {
  CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
  EVENTO_FILA_PRIMEIRA_MENSAGEM,
  idDaBolhaFilaPrimeiraMensagem,
  pausaEntreBolhasSegundos,
  semMarcadorDaFila,
  type ItemFilaPrimeiraMensagem,
} from "@/lib/automation/fila-primeira-mensagem";
import { adiarAteAJanelaAbrir, knobsDoCanal } from "@/lib/automation/janela-do-canal";
import { renderTemplate } from "@/lib/automation/template";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { proximaAberturaDaJanela } from "@/lib/agent-engine/pacing/engine";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { comandoDaConversa, silencioVigente } from "@/lib/inbox/comando-da-conversa";
import { houveRespostaHumanaDepoisDoEvento } from "@/lib/messaging/resposta-humana";
import { ehPedidoDeOptOut } from "@/lib/opt-out/deteccao";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

const LIMITE_JANELA_LIVRE_MS = 23 * 60 * 60 * 1_000;
const RETENTATIVA_CURTA_MS = 60_000;

export type MotivoDescarteFila =
  | "tag_nao_contatar"
  | "tag_sem_followup"
  | "pedido_opt_out"
  | "janela_24h_expirada"
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

export function motivoParaDescartarFila(
  snapshot: SnapshotGuardaFila,
  now: Date = new Date(),
): MotivoDescarteFila | null {
  if (!snapshot.ruleActive) return "regra_indisponivel";
  if (snapshot.tags.includes("nao_contatar")) return "tag_nao_contatar";
  if (snapshot.tags.includes("sem_followup")) return "tag_sem_followup";
  if (snapshot.isBlocked || ehPedidoDeOptOut(snapshot.latestInboundBody)) {
    return "pedido_opt_out";
  }

  const latestInboundMs = Date.parse(snapshot.latestInboundAt ?? "");
  if (!Number.isFinite(latestInboundMs)) return "janela_24h_desconhecida";
  if (now.getTime() - latestInboundMs > LIMITE_JANELA_LIVRE_MS) {
    return "janela_24h_expirada";
  }
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
  snapshot(item: ItemFilaPrimeiraMensagem): Promise<SnapshotGuardaFila>;
  descartar(item: ItemFilaPrimeiraMensagem, reason: MotivoDescarteFila): Promise<void>;
  prepararPartes(item: ItemFilaPrimeiraMensagem): Promise<ItemFilaPrimeiraMensagem>;
  enviarBolha(
    item: ItemFilaPrimeiraMensagem,
    body: string,
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

function partesDoItem(item: ItemFilaPrimeiraMensagem): string[] {
  if (
    Array.isArray(item.message_parts) &&
    item.message_parts.length >= 2 &&
    item.message_parts.length <= 4 &&
    item.message_parts.every((part) => typeof part === "string" && part.trim().length > 0)
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
    const descarte = motivoParaDescartarFila(
      await runtime.snapshot(item),
      runtime.now(),
    );
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
        await runtime.pausarEntreBolhas(pausaEntreBolhasSegundos(item) * 1_000);
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
      detail: partial ? terminal.error ?? "parcial_interrompido" : terminal.status,
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

function retry(
  retryAt: string,
  detail: string,
): HandlerResult {
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

  const descarte = motivoParaDescartarFila(
    await runtime.snapshot(item),
    runtime.now(),
  );
  if (descarte) {
    await runtime.descartar(item, descarte);
    await runtime.acordarOrigem(item);
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: descarte,
    };
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
    ...restante
  } = actionConfig;
  return { ...restante, template: body };
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
    typeof result.detail?.reason === "string"
      ? result.detail.reason
      : (result.error ?? null);
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
  return {
    now,
    foraDaJanela: (item) =>
      adiarAteAJanelaAbrir(
        admin,
        item.organization_id,
        item.channel_session_id,
        now(),
      ),
    async turno(item, claim) {
      const { data, error } = await admin.rpc(
        "fn_try_claim_automation_first_message",
        {
          p_organization_id: item.organization_id,
          p_queue_id: item.id,
          p_now: now().toISOString(),
          p_claim: claim,
        },
      );
      if (error) throw new Error(`first_message_queue_claim_failed: ${error.message}`);
      const row = primeiraLinha<TurnoFila>(data);
      if (!row) throw new Error("first_message_queue_claim_empty");
      return row;
    },
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
      const origem = await carregarOrigemDaFila(admin, item);
      if (!origem) return item;
      const knobs = await knobsDoCanal(
        admin,
        item.organization_id,
        item.channel_session_id,
      );
      const renderedAt = now();
      const messageParts = templates.map((template) =>
        renderTemplate(String(template), origem.context, {
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
    async enviarBolha(item, body, index) {
      const origem = await carregarOrigemDaFila(admin, item);
      if (!origem?.rule.is_active) {
        return {
          type: "send_whatsapp_message",
          status: "skipped",
          detail: { reason: "regra_indisponivel" },
        };
      }
      const executor = getAction("send_whatsapp_message");
      if (!executor) {
        return {
          type: "send_whatsapp_message",
          status: "failed",
          error: "send_whatsapp_action_unavailable",
        };
      }
      const internalMessageId = idDaBolhaFilaPrimeiraMensagem(item.id, index);
      const ctx: ActionCtx = {
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
      return executor.execute(ctx, configDaBolha(semMarcadorDaFila(item.action_config), body));
    },
    async registrarBolha(item, index, result) {
      const messageId =
        typeof result.detail?.message_id === "string"
          ? result.detail.message_id
          : null;
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
      const knobs = await knobsDoCanal(
        admin,
        item.organization_id,
        item.channel_session_id,
      );
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
