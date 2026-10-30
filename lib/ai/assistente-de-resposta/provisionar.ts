import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { publishAgentVersion } from "@/lib/ai/agents/publish";
import {
  lerConfiguracaoDoAssistente,
  montarPromptDoAssistente,
  patchSeguroDoAgenteInterno,
  type ConfiguracaoDoAssistente,
} from "./config";

interface AgenteInterno {
  id: string;
  config: unknown;
  published_version_id: string | null;
  operation_mode: string;
  paused_at: string | null;
}

export interface EstadoDoAssistente {
  agent_id: string | null;
  enabled: boolean;
  state: "off" | "ready" | "credential_error" | "setup_error";
  provider: "anthropic" | "openai";
  credential_id: string | null;
  credential_last4: string | null;
  validation_error: string | null;
  team_style: string;
  history_message_window: number;
  history_token_window: number;
  hourly_limit: number;
  daily_limit: number;
  auto_suggest: boolean;
}

export const ESTADO_PADRAO_DO_ASSISTENTE: EstadoDoAssistente = {
  agent_id: null,
  enabled: false,
  state: "off",
  provider: "anthropic",
  credential_id: null,
  credential_last4: null,
  validation_error: null,
  team_style: "Responda de forma direta, cordial e humana, como a nossa equipe responderia.",
  history_message_window: 20,
  history_token_window: 4_000,
  hourly_limit: 20,
  daily_limit: 100,
  auto_suggest: true,
};

function objeto(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function encontrarAgente(
  admin: SupabaseClient,
  organizationId: string,
): Promise<AgenteInterno | null> {
  const { data, error } = await admin
    .from("ai_agents")
    .select("id,config,published_version_id,operation_mode,paused_at")
    .eq("organization_id", organizationId)
    .eq("kind", "mcp_agent")
    .is("archived_at", null);
  if (error) throw new Error(`reply_assistant_read_failed:${error.message}`);
  return (
    ((data ?? []) as unknown as AgenteInterno[]).find(
      (agent) => objeto(objeto(agent.config).reply_assistant).managed === true,
    ) ?? null
  );
}

export async function lerEstadoDoAssistente(
  admin: SupabaseClient,
  organizationId: string,
): Promise<EstadoDoAssistente> {
  const agent = await encontrarAgente(admin, organizationId);
  const settings = lerConfiguracaoDoAssistente(agent?.config);
  if (!agent || !settings) return { ...ESTADO_PADRAO_DO_ASSISTENTE };

  const { data: credential } = await admin
    .from("ai_provider_credentials_safe")
    .select("id,organization_id,provider,api_key_last4,is_active,validated_at,validation_error")
    .eq("organization_id", organizationId)
    .eq("id", settings.credential_id)
    .maybeSingle();
  const credentialReady = Boolean(
    credential &&
    credential.organization_id === organizationId &&
    credential.provider === settings.provider &&
    credential.is_active &&
    credential.validated_at,
  );
  const operationalShape = Boolean(
    agent.published_version_id && agent.operation_mode === "assisted" && agent.paused_at,
  );
  const state = !settings.enabled
    ? "off"
    : !credentialReady
      ? "credential_error"
      : operationalShape
        ? "ready"
        : "setup_error";

  return {
    agent_id: agent.id,
    enabled: settings.enabled,
    state,
    provider: settings.provider,
    credential_id: settings.credential_id,
    credential_last4: credential?.api_key_last4 ?? null,
    validation_error: credential?.validation_error ?? null,
    team_style: settings.team_style,
    history_message_window: settings.history_message_window,
    history_token_window: settings.history_token_window,
    hourly_limit: settings.hourly_limit,
    daily_limit: settings.daily_limit,
    auto_suggest: settings.auto_suggest,
  };
}

export interface PedidoDeProvisionamento extends ConfiguracaoDoAssistente {
  organizationId: string;
  userId: string;
  channelSessionId: string;
}

export type ResultadoDeProvisionamento =
  { ok: true; agentId: string; versionId: string } | { ok: false; code: string };

export async function provisionarAssistenteDeResposta(
  admin: SupabaseClient,
  input: PedidoDeProvisionamento,
): Promise<ResultadoDeProvisionamento> {
  const prompt = montarPromptDoAssistente(input.team_style);
  let agent = await encontrarAgente(admin, input.organizationId);
  if (!agent) {
    const now = new Date().toISOString();
    const initialConfig = {
      reply_assistant: {
        managed: true,
        enabled: false,
        provider: input.provider,
        model: input.model,
        credential_id: input.credential_id,
        team_style: input.team_style,
        history_message_window: input.history_message_window,
        history_token_window: input.history_token_window,
        hourly_limit: input.hourly_limit,
        daily_limit: input.daily_limit,
        auto_suggest: input.auto_suggest,
      },
    };
    const { data, error } = await admin
      .from("ai_agents")
      .insert({
        organization_id: input.organizationId,
        name: `Assistente de resposta interno ${randomUUID().slice(0, 8)}`,
        description: "Gera somente rascunhos para revisão humana.",
        kind: "mcp_agent",
        system_prompt: prompt,
        is_default: false,
        created_by: input.userId,
        config: initialConfig,
        ...patchSeguroDoAgenteInterno(now),
      })
      .select("id,config,published_version_id,operation_mode,paused_at")
      .single();
    if (error || !data) return { ok: false, code: "agent_create_failed" };
    agent = data as unknown as AgenteInterno;
  }

  const { data: published } = agent.published_version_id
    ? await admin
        .from("ai_agent_versions")
        .select(
          "id,system_prompt,provider,model,credential_id,history_message_window,history_token_window",
        )
        .eq("organization_id", input.organizationId)
        .eq("agent_id", agent.id)
        .eq("id", agent.published_version_id)
        .maybeSingle()
    : { data: null };

  const sameVersion = Boolean(
    published &&
    published.system_prompt === prompt &&
    published.provider === input.provider &&
    published.model === input.model &&
    published.credential_id === input.credential_id &&
    published.history_message_window === input.history_message_window &&
    published.history_token_window === input.history_token_window,
  );
  let versionId = published?.id ?? null;

  if (!sameVersion) {
    const { data: latest } = await admin
      .from("ai_agent_versions")
      .select("version_number")
      .eq("organization_id", input.organizationId)
      .eq("agent_id", agent.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: version, error } = await admin
      .from("ai_agent_versions")
      .insert({
        organization_id: input.organizationId,
        agent_id: agent.id,
        version_number: (latest?.version_number ?? 0) + 1,
        system_prompt: prompt,
        provider: input.provider,
        model: input.model,
        credential_id: input.credential_id,
        channel_session_id: input.channelSessionId,
        status: "draft",
        tool_ids: [],
        max_steps: 1,
        token_budget: input.history_token_window + 2_000,
        cost_budget_cents: 50,
        history_message_window: input.history_message_window,
        history_token_window: input.history_token_window,
        handoff_keywords: [],
        handoff_tool_enabled: false,
        cases_enabled: false,
        split_messages: false,
        operator_enabled: false,
        operator_tool_ids: [],
        pipeline_ids: [],
        knowledge_source_ids: [],
        skill_names: [],
        trigger_config: {
          events: ["message"],
          filters: {
            ignore_groups: true,
            ignore_self: true,
            keyword_regex: null,
            business_hours: null,
          },
          concurrency: "one_per_conversation",
        },
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error || !version) return { ok: false, code: "version_create_failed" };
    versionId = version.id;
    const publication = await publishAgentVersion(admin, {
      orgId: input.organizationId,
      agentId: agent.id,
      versionId,
    });
    if (!publication.ok) return { ok: false, code: publication.code };
  }

  if (!versionId) return { ok: false, code: "version_missing" };
  const currentConfig = objeto(agent.config);
  const nextSettings: ConfiguracaoDoAssistente = {
    managed: true,
    enabled: input.enabled,
    provider: input.provider,
    model: input.model,
    credential_id: input.credential_id,
    team_style: input.team_style,
    history_message_window: input.history_message_window,
    history_token_window: input.history_token_window,
    hourly_limit: input.hourly_limit,
    daily_limit: input.daily_limit,
    auto_suggest: input.auto_suggest,
  };
  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("ai_agents")
    .update({
      ...patchSeguroDoAgenteInterno(agent.paused_at ?? now),
      system_prompt: prompt,
      config: { ...currentConfig, reply_assistant: nextSettings },
    })
    .eq("organization_id", input.organizationId)
    .eq("id", agent.id);
  return updateError
    ? { ok: false, code: "agent_update_failed" }
    : { ok: true, agentId: agent.id, versionId };
}

export async function desligarAssistenteDeResposta(
  admin: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const agent = await encontrarAgente(admin, organizationId);
  const settings = lerConfiguracaoDoAssistente(agent?.config);
  if (!agent || !settings) return null;
  const now = new Date().toISOString();
  const { error } = await admin
    .from("ai_agents")
    .update({
      ...patchSeguroDoAgenteInterno(agent.paused_at ?? now),
      config: {
        ...objeto(agent.config),
        reply_assistant: { ...settings, enabled: false },
      },
    })
    .eq("organization_id", organizationId)
    .eq("id", agent.id);
  if (error) throw new Error(`reply_assistant_disable_failed:${error.message}`);
  return agent.id;
}
