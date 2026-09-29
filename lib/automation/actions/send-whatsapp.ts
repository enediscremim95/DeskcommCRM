import { assertAgendaEffectSupabase } from "@/lib/agenda/efeito";
import { protecaoAgendaSupabase } from "@/lib/agenda/protecao-followup";
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { renderTemplate } from "@/lib/automation/template";
import { serviceForAutomation } from "@/lib/atendimento/origem-automacao";
import { checkDailyLimit, espacarEnvio } from "@/lib/automation/throttle";
import { adiarAteAJanelaAbrir, knobsDoCanal } from "@/lib/automation/janela-do-canal";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { reportarEnvio, type MensagemEnviada } from "@/lib/automation/desfecho-do-envio";
import { checarGuardasDeContato } from "@/lib/automation/guarda-do-contato";
import { sinalizarDigitando } from "@/lib/messaging/presenca";

async function postponeUntil(ctx: ActionCtx, config: Record<string, unknown>): Promise<string | null> {
  const contato = checarGuardasDeContato(ctx);
  if (contato.ok) {
    const protection = (await protecaoAgendaSupabase(ctx.admin, ctx.organizationId, [contato.contact.id])).get(contato.contact.id)!;
    if (protection.motivo === "leitura_indisponivel") throw new Error("agenda_read_failed");
    if (protection.adiar) return protection.reavaliar_em;
  }
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  if (!sessionId) return null; // config inválida falha no execute, não adia

  // A janela vem dos knobs DO NÚMERO (fuso do tenant, domingo configurável) —
  // a mesma régua da tela de Conexões e do agente. Ver janela-do-canal.ts.
  const foraDaJanela = await adiarAteAJanelaAbrir(ctx.admin, ctx.organizationId, sessionId);
  if (foraDaJanela) return foraDaJanela;

  const daily = await checkDailyLimit(ctx.admin, ctx.organizationId, sessionId);
  return daily.allowed ? null : (daily.retry_at ?? null);
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  const template = typeof config.template === "string" ? config.template : null;
  if (!sessionId || !template) {
    return { type: "send_whatsapp_message", status: "failed", error: "missing_config" };
  }
  // Guardas compartilhadas com send_ai_message — ver guarda-do-contato.ts
  // (existe/bloqueado/telefone/consentimento, este último um gate FIXO).
  const guarda = checarGuardasDeContato(ctx);
  if (!guarda.ok) return { type: "send_whatsapp_message", status: "skipped", detail: { reason: guarda.reason } };
  const contact = guarda.contact;

  // O espaçamento é COMPARTILHADO com a ação de IA (mesmo número, mesmo
  // contador) — ver lib/automation/throttle.ts.
  try {
    await assertAgendaEffectSupabase(ctx.admin, { organizationId: ctx.organizationId, contactId: contact.id });
    const boundary = await serviceForAutomation(ctx, contact.id, sessionId);
    const conversationId = boundary.conversation_id;
    // No motor novo, a espera é um estado durável no `event_log`. O fallback
    // mantém o throttle antigo para chamadas diretas do executor e fixtures
    // que não passaram pelo orquestrador de ritmo.
    if (!ctx.humanPacingManaged) await espacarEnvio(sessionId);
    const knobs = await knobsDoCanal(ctx.admin, ctx.organizationId, sessionId);
    const body = renderTemplate(template, ctx.context, { timezone: knobs.timezone });
    const message = await sendMessageHandler(
      ctx.admin,
      {
        organization_id: ctx.organizationId,
        serviceBoundary: boundary,
        proactiveContext: { organizationId: ctx.organizationId, contactId: contact.id },
        actor: { type: "webhook_source", id: ctx.ruleId },
        requestId: `rule:${ctx.ruleId}`,
      },
      { conversation_id: conversationId, type: "text", body } as Parameters<typeof sendMessageHandler>[2],
    );
    // O desfecho vem do ESTADO DA MENSAGEM, nunca da ausência de exceção:
    // `sendMessageHandler` marca `failed`/`queued` e devolve normalmente (ver
    // lib/automation/desfecho-do-envio.ts para o defeito medido).
    return await reportarEnvio(ctx, "send_whatsapp_message", message as unknown as MensagemEnviada, conversationId);
  } catch (err) {
    return {
      type: "send_whatsapp_message",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function textLength(ctx: ActionCtx, config: Record<string, unknown>): Promise<number | null> {
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  const template = typeof config.template === "string" ? config.template : null;
  if (!sessionId || !template) return null;
  const guarda = checarGuardasDeContato(ctx);
  if (!guarda.ok) return null;

  const knobs = await knobsDoCanal(ctx.admin, ctx.organizationId, sessionId);
  return renderTemplate(template, ctx.context, { timezone: knobs.timezone }).length;
}

async function signalTyping(ctx: ActionCtx, config: Record<string, unknown>): Promise<void> {
  const sessionId = typeof config.channel_session_id === "string" ? config.channel_session_id : null;
  if (!sessionId) return;
  const guarda = checarGuardasDeContato(ctx);
  if (!guarda.ok) return;
  const boundary = await serviceForAutomation(ctx, guarda.contact.id, sessionId);
  await sinalizarDigitando(ctx.admin, {
    organizationId: ctx.organizationId,
    conversationId: boundary.conversation_id,
  });
}

registerAction({
  type: "send_whatsapp_message",
  postponeUntil,
  humanPacing: { textLength, signalTyping },
  execute,
});
