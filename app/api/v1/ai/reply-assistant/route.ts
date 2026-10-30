import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  escolherModeloDoAssistente,
  pedidoDoAssistenteSchema,
} from "@/lib/ai/assistente-de-resposta/config";
import {
  desligarAssistenteDeResposta,
  lerEstadoDoAssistente,
  provisionarAssistenteDeResposta,
} from "@/lib/ai/assistente-de-resposta/provisionar";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("manager", {
    requestId,
    resource: "ai_reply_assistant",
  });
  if (!auth.ok) return auth.response;
  try {
    return ok(await lerEstadoDoAssistente(createAdminClient(), auth.org.orgId), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler o assistente de resposta.", 500, {
      requestId,
    });
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", {
    requestId,
    resource: "ai_reply_assistant",
  });
  if (!auth.ok) return auth.response;
  const t = (text: string) => traduzir(text, auth.user.idioma);
  const parsed = pedidoDoAssistenteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Confira os campos do assistente."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const admin = createAdminClient();

  if (!parsed.data.enabled) {
    try {
      const agentId = await desligarAssistenteDeResposta(admin, auth.org.orgId);
      await audit({
        action: "ai_reply_assistant.disabled",
        actorUserId: auth.user.id,
        organizationId: auth.org.orgId,
        resourceType: "ai_reply_assistant",
        resourceId: agentId ?? auth.org.orgId,
        requestId,
      });
      return ok(await lerEstadoDoAssistente(admin, auth.org.orgId), { requestId });
    } catch {
      return fail("internal_error", t("Não foi possível desligar o assistente."), 500, {
        requestId,
      });
    }
  }

  const input = parsed.data as typeof parsed.data & {
    provider: "anthropic" | "openai";
    credential_id: string;
    team_style: string;
    history_message_window: number;
    history_token_window: number;
    hourly_limit: number;
    daily_limit: number;
    auto_suggest?: boolean;
  };
  const { data: credential } = await admin
    .from("ai_provider_credentials_safe")
    .select(
      "id,organization_id,provider,is_active,validated_at,validation_error,models_available",
    )
    .eq("organization_id", auth.org.orgId)
    .eq("id", input.credential_id)
    .maybeSingle();
  if (
    !credential ||
    credential.organization_id !== auth.org.orgId ||
    credential.provider !== input.provider
  ) {
    return fail("credential_not_found", t("A chave escolhida não pertence a esta organização."), 404, {
      requestId,
    });
  }
  if (!credential.is_active || !credential.validated_at) {
    return fail(
      "credential_not_validated",
      t("A chave ainda não foi validada. Teste a chave e tente novamente."),
      422,
      { requestId, details: { validation_error: credential.validation_error } },
    );
  }

  const { data: catalog } = await admin
    .from("ai_models")
    .select("model_id,is_default_for_provider")
    .eq("provider", input.provider)
    .is("deprecated_at", null)
    .order("is_default_for_provider", { ascending: false });
  const availableModels = Array.isArray(credential.models_available)
    ? credential.models_available.filter((value): value is string => typeof value === "string")
    : null;
  const model = escolherModeloDoAssistente(catalog ?? [], availableModels);
  if (!model) {
    return fail(
      "model_not_available",
      t("Nenhum modelo compatível está disponível para esta chave."),
      422,
      { requestId },
    );
  }

  const { data: channel } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", auth.org.orgId)
    .eq("status", "WORKING")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!channel) {
    return fail(
      "channel_not_ready",
      t("Conecte um canal antes de ligar o assistente de resposta."),
      422,
      { requestId },
    );
  }

  const before = await lerEstadoDoAssistente(admin, auth.org.orgId);
  const result = await provisionarAssistenteDeResposta(admin, {
    managed: true,
    enabled: true,
    organizationId: auth.org.orgId,
    userId: auth.user.id,
    channelSessionId: channel.id,
    provider: input.provider,
    model,
    credential_id: input.credential_id,
    team_style: input.team_style,
    history_message_window: input.history_message_window,
    history_token_window: input.history_token_window,
    hourly_limit: input.hourly_limit,
    daily_limit: input.daily_limit,
    auto_suggest: input.auto_suggest ?? true,
  });
  if (!result.ok) {
    return fail(
      "reply_assistant_setup_failed",
      t("Não foi possível preparar o assistente. Confira a chave e o canal."),
      422,
      { requestId, details: { reason: result.code } },
    );
  }
  const state = await lerEstadoDoAssistente(admin, auth.org.orgId);
  await audit({
    action: before.enabled ? "ai_reply_assistant.updated" : "ai_reply_assistant.enabled",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "ai_reply_assistant",
    resourceId: result.agentId,
    requestId,
    metadata: {
      provider: input.provider,
      model,
      credential_changed: before.credential_id !== input.credential_id,
      hourly_limit: input.hourly_limit,
      daily_limit: input.daily_limit,
      auto_suggest: input.auto_suggest ?? true,
    },
  });
  return ok(state, { requestId });
}
