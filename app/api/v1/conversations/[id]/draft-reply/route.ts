import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { generateReplyDraft } from "@/lib/agent-engine/agent/reply-drafts";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { carregarAssistenteDeResposta } from "@/lib/ai/assistente-de-resposta/runtime";
import { verificarLimitesDoAssistente } from "@/lib/ai/assistente-de-resposta/limites";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
type ConversationContext = {
  id: string;
  contact_id: string | null;
  channel_session_id: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  comando_da_conversa: string | null;
};
const generationInput = z
  .object({ trigger: z.enum(["manual", "auto"]).default("manual") })
  .strict();

function clienteAguardaResposta(conversation: ConversationContext): boolean {
  if (!conversation.last_inbound_at) return false;
  if (!conversation.last_outbound_at) return true;
  return Date.parse(conversation.last_inbound_at) > Date.parse(conversation.last_outbound_at);
}

async function context(ctx: Ctx, requestId: string) {
  const auth = await requireRole("agent", { requestId, resource: "conversations" });
  if (!auth.ok) return { response: auth.response } as const;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const { id } = await ctx.params;
  const db = await createClient();
  const { data: conversation } = await db
    .from("conversations")
    .select("id,contact_id,channel_session_id,last_inbound_at,last_outbound_at,comando_da_conversa")
    .eq("organization_id", auth.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conversation)
    return {
      response: fail("not_found", t("Conversa não encontrada."), 404, { requestId }),
    } as const;
  return { auth, conversation: conversation as unknown as ConversationContext, t } as const;
}
export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID(),
    c = await context(ctx, requestId);
  if ("response" in c) return c.response;
  const { rows } = await getRequestPool().query(
    `select id,revision::text,original_body,edited_body,approved_body,proposals,feedback,error_code,created_at,
 case when status in ('generating','pending','approved') and not fn_reply_context_current(organization_id,id) then 'stale' else status end as status
 from ai_reply_drafts where organization_id=$1 and conversation_id=$2 order by created_at desc limit 5`,
    [c.auth.org.orgId, c.conversation.id],
  );
  const assistant = await carregarAssistenteDeResposta(getRequestPool(), c.auth.org.orgId);
  return ok(
    {
      drafts: rows,
      assistant: {
        enabled: Boolean(assistant),
        auto_suggest: assistant?.settings.auto_suggest ?? false,
      },
    },
    { requestId },
  );
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID(),
    c = await context(ctx, requestId);
  if ("response" in c) return c.response;
  const parsed = generationInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", c.t("Pedido de sugestão inválido."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const {
    contact_id: contactId,
    channel_session_id: channelId,
    id: conversationId,
  } = c.conversation;
  if (!contactId || !channelId)
    return fail("unprocessable", c.t("Conversa sem contato/canal."), 422, { requestId });
  const pool = getRequestPool();
  const assistant = await carregarAssistenteDeResposta(pool, c.auth.org.orgId);
  if (!assistant) {
    return fail(
      "reply_assistant_disabled",
      c.t("O assistente de resposta está desligado. Ligue-o nas configurações de IA."),
      409,
      { requestId },
    );
  }
  if (
    parsed.data.trigger === "auto" &&
    (!assistant.settings.auto_suggest ||
      c.conversation.comando_da_conversa === "automatico" ||
      !clienteAguardaResposta(c.conversation))
  ) {
    return fail(
      "reply_auto_not_eligible",
      c.t("Esta conversa não precisa de sugestão automática agora."),
      409,
      { requestId },
    );
  }

  // O mesmo contexto devolve o mesmo rascunho antes de consumir cota. A função
  // do banco continua sendo a autoridade contra corrida, mas esta leitura evita
  // gastar os limites da organização para apenas reler uma sugestão pronta.
  const { rows: existing } = await pool.query<{
    id: string;
    revision: string;
    status: string;
    original_body: string | null;
  }>(
    `select id,revision::text,status,original_body
     from ai_reply_drafts
     where organization_id=$1 and conversation_id=$2
       and status in ('generating','pending')
       and fn_reply_context_current(organization_id,id)
     order by created_at desc limit 1`,
    [c.auth.org.orgId, conversationId],
  );
  const reusable = existing[0];
  if (reusable) {
    return ok(
      {
        draft: reusable.original_body ?? "",
        draft_id: reusable.id,
        revision: reusable.revision,
        status: reusable.status,
      },
      { requestId },
    );
  }
  const limit = await verificarLimitesDoAssistente(c.auth.org.orgId, assistant.settings);
  if (!limit.allowed) {
    return fail(limit.code, c.t(limit.message), 429, {
      requestId,
      details: limit.details,
    });
  }
  try {
    const draft = await generateReplyDraft(pool, requestTurnDeps(), {
      organizationId: c.auth.org.orgId,
      conversationId,
      contactId,
      channelId,
      agent: assistant.agent,
    });
    void audit({
      action: "ai_reply.generated",
      actorUserId: c.auth.user.id,
      organizationId: c.auth.org.orgId,
      resourceType: "conversation",
      resourceId: conversationId,
      requestId,
    });
    return ok(
      {
        draft: draft.original_body ?? "",
        draft_id: draft.id,
        revision: draft.revision,
        status: draft.status,
      },
      { requestId },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const reason = /401|403|credential|api.?key/i.test(message)
      ? "credential"
      : /429|rate|quota|credit|balance/i.test(message)
        ? "quota"
        : "generation";
    void audit({
      action: "ai_reply.failed",
      actorUserId: c.auth.user.id,
      organizationId: c.auth.org.orgId,
      resourceType: "conversation",
      resourceId: conversationId,
      requestId,
      metadata: { reason },
    });
    return fail(
      "reply_unavailable",
      c.t(
        reason === "credential"
          ? "A chave da IA foi recusada. Teste ou troque a chave nas configurações."
          : reason === "quota"
            ? "A conta da IA atingiu o limite ou está sem saldo. Confira a conta do provedor."
            : "Não foi possível gerar a sugestão. Teste a chave nas configurações de IA e tente novamente.",
      ),
      422,
      { requestId },
    );
  }
}
