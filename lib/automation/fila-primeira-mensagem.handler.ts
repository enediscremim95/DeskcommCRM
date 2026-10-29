import type { SupabaseClient } from "@supabase/supabase-js";

import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/register-all";
import { buildContext } from "@/lib/automation/engine";
import {
  CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
  EVENTO_FILA_PRIMEIRA_MENSAGEM,
  semMarcadorDaFila,
  type ItemFilaPrimeiraMensagem,
} from "@/lib/automation/fila-primeira-mensagem";
import { adiarAteAJanelaAbrir, knobsDoCanal } from "@/lib/automation/janela-do-canal";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { proximaAberturaDaJanela } from "@/lib/agent-engine/pacing/engine";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { comandoDaConversa, silencioVigente } from "@/lib/inbox/comando-da-conversa";
import { houveRespostaHumanaDepoisDoEvento } from "@/lib/messaging/resposta-humana";
import { ehPedidoDeOptOut } from "@/lib/opt-out/deteccao";
import { createAdminClient } from "@/lib/supabase/admin";

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
  enviar(item: ItemFilaPrimeiraMensagem): Promise<ActionResultDetail>;
  acompanharMensagem(item: ItemFilaPrimeiraMensagem): Promise<ActionResultDetail | null>;
  finalizar(item: ItemFilaPrimeiraMensagem, result: ActionResultDetail): Promise<void>;
  reagendar(item: ItemFilaPrimeiraMensagem, retryAt: string): Promise<void>;
  proximaAberturaDoDiaSeguinte(item: ItemFilaPrimeiraMensagem, anchor: string): Promise<string>;
  acordarOrigem(item: ItemFilaPrimeiraMensagem): Promise<void>;
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

  if (item.status === "processing") {
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

  // O snapshot anterior protege o claim. Este segundo fecha a corrida curta
  // entre obter o lock e iniciar o efeito externo, quando uma pessoa pode ter
  // respondido ou pausado a conversa.
  const descarteDepoisDoClaim = motivoParaDescartarFila(
    await runtime.snapshot(item),
    runtime.now(),
  );
  if (descarteDepoisDoClaim) {
    await runtime.finalizar(item, {
      type: "send_whatsapp_message",
      status: "skipped",
      detail: { reason: descarteDepoisDoClaim },
    });
    await runtime.acordarOrigem(item);
    return {
      consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
      status: "ok",
      detail: descarteDepoisDoClaim,
    };
  }

  const result = await runtime.enviar(item);
  await runtime.finalizar(item, result);
  if (result.status === "postponed") {
    const at = new Date(runtime.now().getTime() + RETENTATIVA_CURTA_MS).toISOString();
    await runtime.reagendar(item, at);
    return retry(at, "mensagem_da_fila_aguardando_canal");
  }
  await runtime.acordarOrigem(item);
  return {
    consumer_key: CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM,
    status: "ok",
    detail: result.status,
  };
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
  const [contactResult, conversationResult, inboundResult, humanReplied] =
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
      houveRespostaHumanaDepoisDoEvento(admin, {
        organizationId: item.organization_id,
        conversationId: item.conversation_id,
        eventCreatedAt: item.enqueued_at,
      }),
    ]);

  const readError =
    contactResult.error ?? conversationResult.error ?? inboundResult.error;
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
    async enviar(item) {
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
            .select("id, name, is_active")
            .eq("id", item.rule_id)
            .eq("organization_id", item.organization_id)
            .maybeSingle(),
        ]);
      if (eventError || ruleError) {
        throw new Error(
          `first_message_queue_origin_read_failed: ${eventError?.message ?? ruleError?.message}`,
        );
      }
      const rule = ruleData as { id: string; name: string; is_active: boolean } | null;
      if (!eventData || !rule?.is_active) {
        return {
          type: "send_whatsapp_message",
          status: "skipped",
          detail: { reason: "regra_indisponivel" },
        };
      }
      const event = eventData as unknown as EventRow;
      const context = await buildContext(admin, event);
      const executor = getAction("send_whatsapp_message");
      if (!executor) {
        return {
          type: "send_whatsapp_message",
          status: "failed",
          error: "send_whatsapp_action_unavailable",
        };
      }
      const ctx: ActionCtx = {
        admin,
        organizationId: item.organization_id,
        ruleId: item.rule_id,
        ruleName: rule.name,
        event,
        context,
        requestId: item.queue_event_id ?? item.id,
        actionIndex: item.action_index,
        humanPacingManaged: true,
        serviceBoundaries: new Map(),
      };
      return executor.execute(ctx, semMarcadorDaFila(item.action_config));
    },
    async acompanharMensagem(item) {
      if (!item.outbound_message_id) return null;
      const { data, error } = await admin
        .from("messages")
        .select("id, status, error_code, error_message, metadata")
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
