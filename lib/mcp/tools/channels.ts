import { z } from "zod";

import { definirAtendimentoAutomatico } from "@/lib/channels/atendimento-automatico";
import type { McpToolDefinition } from "../types";

const inputShape = {
  channel_session_id: z.string().uuid(),
  enabled: z.boolean(),
};

export const crmSetChannelAutomaticAttendance: McpToolDefinition<typeof inputShape> = {
  name: "crm_set_channel_automatic_attendance",
  description:
    "Liga ou desliga a autorização mestra de respostas automáticas de UM canal. " +
    "Com enabled=false, mensagens, contatos, conversas, leads e avisos continuam entrando normalmente, " +
    "mas nenhuma resposta automática é enviada. Com enabled=true, o agente publicado pode responder, " +
    "ainda respeitando modo de teste, bloqueios e atendimento humano. Canais novos começam desligados. " +
    "Esta escrita muda o que o cliente final pode receber e fica registrada na auditoria.",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const actor = ctx.actor.type === "user"
      ? { actorUserId: ctx.actor.id, actorApiTokenId: ctx.apiTokenId }
      : {
          actorUserId: null,
          actorApiTokenId: ctx.apiTokenId,
          metadata: { actor_type: ctx.actor.type, actor_id: ctx.actor.id, via: "mcp" },
        };
    const result = await definirAtendimentoAutomatico(ctx.supabase, {
      organizationId: ctx.organizationId,
      channelSessionId: input.channel_session_id,
      enabled: input.enabled,
      actor: { ...actor, requestId: ctx.requestId },
    });
    if (!result.ok) throw new Error(
      result.reason === "not_found" ? "channel_not_found" : "channel_update_failed",
    );
    return {
      channel_session_id: input.channel_session_id,
      automatic_attendance_enabled: result.enabled,
      changed: result.changed,
    };
  },
};
