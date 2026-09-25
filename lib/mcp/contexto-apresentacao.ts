import type { SupabaseClient } from "@supabase/supabase-js";

import { marcaDaSaida } from "@/lib/branding/saida";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import type { PipelineVocabulary } from "@/lib/kanban/types";
import { businessProfileSchema } from "@/lib/schemas/business-profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BaseApresentacaoMcp } from "./apresentacao";

function descricaoDoNegocio(settings: unknown): string {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return "";
  const profile = businessProfileSchema.safeParse(
    (settings as Record<string, unknown>).business_profile,
  );
  return profile.success ? profile.data.description : "";
}

export async function carregarBaseApresentacaoMcp(
  organizationId: string,
  supabase: SupabaseClient = createAdminClient(),
): Promise<BaseApresentacaoMcp> {
  const [organizationResult, pipelineResult, brand] = await Promise.all([
    supabase
      .from("organizations")
      .select("display_name, currency, timezone, locale, settings")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("crm_pipelines")
      .select("vocabulary")
      .eq("organization_id", organizationId)
      .eq("is_archived", false)
      .order("is_default", { ascending: false })
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle(),
    marcaDaSaida(organizationId),
  ]);

  if (organizationResult.error || !organizationResult.data) {
    throw new Error(
      `Não foi possível carregar o contexto MCP da organização: ${organizationResult.error?.message ?? "organização não encontrada"}`,
    );
  }
  if (pipelineResult.error) {
    throw new Error(`Não foi possível carregar o vocabulário do CRM: ${pipelineResult.error.message}`);
  }

  const organization = organizationResult.data;
  return {
    productName: brand.nome,
    organizationName: organization.display_name,
    businessDescription: descricaoDoNegocio(organization.settings),
    currency: organization.currency,
    timezone: organization.timezone,
    locale: normalizarIdioma(organization.locale),
    vocabulary: (pipelineResult.data?.vocabulary ?? null) as PipelineVocabulary | null,
  };
}
