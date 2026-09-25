import { redirect } from 'next/navigation';

import { requireAuth, resolveActiveOrg } from '@/lib/auth/server';
import { ROLE_RANK } from '@/lib/auth/types';
import { listSelectableChannels } from '@/lib/channels/selectable';
import { createClient } from '@/lib/supabase/server';
import { lerAmbiente } from '@/lib/instalacao/ambiente';
import { capacidadesPadraoDoOnboarding } from '@/lib/ai/agents/capacidades-padrao';

import { AtendimentoBuilder } from './AtendimentoBuilder';

export const dynamic = 'force-dynamic';

export default async function AtendimentoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect('/app');
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect('/403');

  const supabase = await createClient();
  const [channels, credentialsRes, modelsRes] = await Promise.all([
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

  return (
    <AtendimentoBuilder
      channels={channels}
      provider={selectedModel?.provider ?? null}
      model={selectedModel?.model_id ?? null}
      credentialId={selectedCredential?.id ?? null}
      defaultToolIds={capacidadesPadraoDoOnboarding()}
    />
  );
}
