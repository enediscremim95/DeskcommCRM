import { redirect } from 'next/navigation';

import { requireAuth, resolveActiveOrg } from '@/lib/auth/server';
import { ROLE_RANK } from '@/lib/auth/types';
import { listSelectableChannels } from '@/lib/channels/selectable';
import { createClient } from '@/lib/supabase/server';
import { lerAmbiente } from '@/lib/instalacao/ambiente';
import { capacidadesPadraoDoOnboarding } from '@/lib/ai/agents/capacidades-padrao';
import type { AgentVersionRow } from '@/hooks/ai/useAgentVersions';

import { AtendimentoBuilder } from './AtendimentoBuilder';

export const dynamic = 'force-dynamic';

export default async function AtendimentoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect('/app');
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect('/403');

  const supabase = await createClient();
  const [channels, credentialsRes, modelsRes, agentsRes, followupsRes] = await Promise.all([
    listSelectableChannels(supabase, activeOrg.orgId),
    supabase
      .from('ai_provider_credentials_safe')
      .select('id, provider, validated_at, is_active, models_available')
      .eq('organization_id', activeOrg.orgId),
    supabase
      .from('ai_models')
      .select('provider, model_id, supports_tools, deprecated_at')
      .is('deprecated_at', null)
      .eq('supports_tools', true),
    supabase
      .from('ai_agents')
      .select('id, name, description, published_version_id, priority, created_at')
      .eq('organization_id', activeOrg.orgId)
      .eq('kind', 'mcp_agent')
      .is('archived_at', null)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('followup_flow_pointers')
      .select('id, name')
      .eq('organization_id', activeOrg.orgId)
      .eq('status', 'published')
      .order('name'),
  ]);

  const credentials = (credentialsRes.data ?? []) as Array<{
    id: string;
    provider: string;
    validated_at: string | null;
    is_active: boolean;
    models_available: string[] | null;
  }>;
  const models = (modelsRes.data ?? []) as Array<{ provider: string; model_id: string }>;
  const envProviders = lerAmbiente().chavesDeProvedor;
  const availableProviders = new Set([
    ...Object.entries(envProviders).filter(([, ready]) => ready).map(([provider]) => provider),
    ...credentials.filter((c) => c.is_active && c.validated_at).map((c) => c.provider),
  ]);
  const selectedModel = models.find((m) => availableProviders.has(m.provider)) ?? null;
  const selectedCredential = selectedModel
    ? credentials.find(
        (c) =>
          c.provider === selectedModel.provider &&
          c.is_active &&
          c.validated_at &&
          (!c.models_available?.length || c.models_available.includes(selectedModel.model_id)),
      )
    : null;

  const agents = (agentsRes.data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    published_version_id: string | null;
  }>;
  const agentIds = agents.map((agent) => agent.id);
  const versionsRes = agentIds.length === 0
    ? { data: [], error: null }
    : await supabase
        .from('ai_agent_versions')
        .select('id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents, history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, cases_enabled, split_messages, split_max_chars, followup, operator_enabled, operator_model, operator_tool_ids, status, published_at, superseded_at, created_at, created_by, pipeline_ids, knowledge_source_ids, skill_names, channel_config, provisioning_origin, mcp_api_token_id, mcp_change_summary')
        .eq('organization_id', activeOrg.orgId)
        .in('agent_id', agentIds)
        .order('created_at', { ascending: false });
  const allVersions = (versionsRes.data ?? []) as unknown as AgentVersionRow[];
  const latestMcpDraft = allVersions.find(
    (version) => version.status === 'draft' && version.provisioning_origin === 'mcp',
  );
  const selectedAgent = latestMcpDraft
    ? agents.find((agent) => agent.id === latestMcpDraft.agent_id) ?? null
    : agents[0] ?? null;
  const versions = selectedAgent
    ? allVersions.filter((version) => version.agent_id === selectedAgent.id)
    : [];
  const selectedVersion = versions.find((version) => version.status === 'draft')
    ?? versions.find((version) => version.id === selectedAgent?.published_version_id)
    ?? versions[0]
    ?? null;
  const selectedChannel = channels.find((channel) => channel.status === 'WORKING') ?? channels[0] ?? null;
  const dailyLimitRes = selectedChannel
    ? await supabase
        .from('channel_sessions')
        .select('daily_message_limit')
        .eq('organization_id', activeOrg.orgId)
        .eq('id', selectedChannel.id)
        .maybeSingle()
    : { data: null };

  return (
    <AtendimentoBuilder
      key={`${selectedAgent?.id ?? 'novo'}:${selectedVersion?.id ?? 'sem-versao'}:${selectedAgent?.published_version_id ?? 'sem-publicada'}`}
      channels={channels}
      provider={selectedModel?.provider ?? null}
      model={selectedModel?.model_id ?? null}
      credentialId={selectedCredential?.id ?? null}
      defaultToolIds={capacidadesPadraoDoOnboarding()}
      agent={selectedAgent}
      versions={versions}
      dailyMessageLimit={dailyLimitRes.data?.daily_message_limit ?? null}
      followupFlows={(followupsRes.data ?? []) as Array<{ id: string; name: string }>}
    />
  );
}
