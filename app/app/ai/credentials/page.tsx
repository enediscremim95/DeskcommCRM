import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { userHasPermission } from "@/lib/auth/permissions";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { contarUsoPublicado, type VersaoVinculada } from "@/lib/ai/credenciais/uso";
import { CredentialsList } from "./_components/CredentialsList";
import { ReplyAssistantSettings } from "./_components/ReplyAssistantSettings";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at, origem, selecao_explicita";

export default async function CredentialsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const [{ data }, { data: org }] = await Promise.all([
    supabase.from("ai_provider_credentials").select(SAFE_COLUMNS)
      .eq("organization_id", activeOrg.orgId).order("created_at", { ascending: false }),
    supabase.from("organizations").select("settings").eq("id", activeOrg.orgId).maybeSingle(),
  ]);

  const credentials = (data ?? []) as unknown as (CredentialRow & { selecao_explicita: boolean })[];
  const llm = (org?.settings as { llm?: { provider?: string; credential_id?: string; sem_fallback_compartilhado?: boolean } } | null)?.llm;
  const padrao = llm?.credential_id
    ? credentials.find((c) => c.id === llm.credential_id && c.provider === llm.provider)
    : credentials.find((c) => c.provider === llm?.provider && c.is_active && c.validated_at && !c.selecao_explicita);
  const compartilhada = padrao?.origem === "compartilhada" ||
    (llm?.provider === "openrouter" && padrao === undefined);
  const canWrite = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
  const canDelete = userHasPermission(user, activeOrg, "ai.credentials.delete");

  // Mesma regra do DELETE: só conta a versão PUBLICADA de agente não arquivado.
  let usageMap: Record<string, number> = {};
  if (credentials.length > 0) {
    const { data: linked } = await supabase
      .from("ai_agent_versions")
      .select(
        "id, credential_id, ai_agents!ai_agent_versions_agent_id_fkey!inner(archived_at, published_version_id)",
      )
      .eq("organization_id", activeOrg.orgId)
      .in("credential_id", credentials.map((c) => c.id));
    usageMap = contarUsoPublicado((linked ?? []) as unknown as VersaoVinculada[]);
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Chaves de acesso à IA", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "A conta de inteligência artificial é sua: você contrata direto na Anthropic, OpenAI ou Google e cola a chave aqui. Ela é guardada criptografada e nunca mais aparece na tela depois de salva — nem para você.",
            idioma,
          )}
        </p>
        <div className="mt-3 max-w-3xl rounded-lg border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
          <p>
            {traduzir(
              "Ainda não tem uma chave de IA? A OpenRouter oferece uma única chave para dezenas de modelos. Depois de cadastrá-la aqui, os modelos aparecem automaticamente.",
              idioma,
            )}{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              {traduzir("Criar chave na OpenRouter", idioma)}
            </a>
          </p>
        </div>
      </header>
      {compartilhada && llm?.sem_fallback_compartilhado !== true && (
        <p role="status" className="rounded-md border bg-muted/35 px-3 py-2 text-sm">
          {traduzir("Sem chave própria no padrão da organização. A IA usa a chave compartilhada da OpenRouter.", idioma)}
        </p>
      )}
      <ReplyAssistantSettings canWrite={canWrite} />
      <CredentialsList
        initialData={credentials}
        canWrite={canWrite}
        canDelete={canDelete}
        usageMap={usageMap}
        defaultCredentialId={llm?.credential_id}
      />
    </div>
  );
}
