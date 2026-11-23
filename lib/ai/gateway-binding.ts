/**
 * O PAINEL DE PROVEDORES ALCANÇA TAMBÉM A PILHA ANTIGA.
 *
 * O sistema resolvia modelo por três caminhos que não se falam. O seam do
 * agente (`run-model-call.ts`) já obedece ao painel. Faltavam os pontos que
 * ainda passam por `lib/ai/gateway.ts` — `sentiment_classify`, `bot_respond` e
 * o ensaio de agente.
 *
 * Enquanto faltavam, a tela cometia o pior erro que uma tela de configuração
 * pode cometer: oferecia esses três pontos, aceitava a escolha, dizia "salvo" —
 * e nenhuma chamada a respeitava. Botão que não controla nada é pior que botão
 * ausente, porque gasta a confiança de quem clicou. É a mesma classe de defeito
 * que `tests/unit/pontos-de-ia-completude.test.ts` proíbe no registro; ela só
 * não era pega aqui porque o teste olha a LISTA, não a execução.
 *
 * ## Por que este módulo existe em vez de o worker chamar o seam
 *
 * O seam do agente fala `pg.Pool`; estes workers falam Supabase. Migrá-los para
 * o seam é a mudança certa e é grande — mexe em transação, em credencial e no
 * caminho que hoje responde o cliente. Este módulo é a ponte mínima que faz o
 * painel valer JÁ nos três pontos, sem reescrever o runtime que está no ar.
 * A unificação segue registrada como dívida no handoff.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { CredencialPropriaObrigatoriaError } from "@/lib/ai/credenciais/sem-fallback";
import { env } from "@/lib/env";
import { decryptKey, byteaToBuffer } from "@/lib/crypto/aes_gcm";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { OPENROUTER_BASE_URL, resolveLanguageModel, type ModelId } from "./gateway";

export interface ModeloResolvido {
  model: LanguageModel;
  /** Para o log: qual modelo e de onde veio a decisão. */
  modelId: string;
  origem: "binding" | "credencial_da_organizacao" | "padrao";
}

/**
 * Resolve o modelo de um ponto, honrando o painel quando há binding.
 *
 * `organizationId` é obrigatório porque binding é por organização — e um
 * resolvedor que aceitasse organização opcional acabaria chamado sem ela no
 * caminho que mais importa, aplicando a configuração de ninguém.
 *
 * Sem binding, a ordem é a MESMA do resto do produto (`resolveOrgLlmConfig`):
 * a credencial ativa e validada do provider da organização e, só então, a chave
 * da instalação. Esta linha já disse "devolve exatamente o que
 * `resolveLanguageModel` devolvia"; era verdade até o degrau do meio entrar, e
 * deixá-la de pé faria a próxima pessoa concluir que a chave do `.env` ainda
 * vence a chave que a organização cadastrou na tela.
 */
export async function resolverModeloDoPonto(
  purpose: string,
  organizationId: string,
  padrao: ModelId,
): Promise<ModeloResolvido | null> {
  const llm = await lerConfigDaOrganizacao(organizationId, purpose);
  const estrito = llm?.sem_fallback_compartilhado === true;
  const binding = await lerBinding(purpose, organizationId, estrito);

  if (binding) {
    if (binding.credential_id) {
      const apiKey = await decifrarChave(organizationId, binding.provider, binding.credential_id, estrito);
      const model = apiKey && instanciar(binding.provider, apiKey, binding.model_id, binding.base_url);
      if (model) return { model, modelId: binding.model_id, origem: "binding" };
    }
    if (!estrito) {
      logger.warn("[gateway-binding] binding sem configuração utilizável — usando o padrão", {
        organization_id: organizationId, purpose,
      });
    }
  } else if (typeof llm?.provider === "string" && llm.provider) {
    const credentialId = typeof llm.credential_id === "string" ? llm.credential_id : null;
    const modelId = (credentialId || estrito) && typeof llm.default_model === "string"
      ? llm.default_model
      : String(padrao);
    const idNoProvider = idParaOProvider(llm.provider, modelId);
    if (idNoProvider !== null) {
      const apiKey = await decifrarChave(organizationId, llm.provider, credentialId, estrito);
      const model = apiKey && instanciar(llm.provider, apiKey, idNoProvider, null);
      if (model) return { model, modelId, origem: "credencial_da_organizacao" };
    }
  }

  if (estrito) {
    throw new CredencialPropriaObrigatoriaError(organizationId, "credential_unavailable", {
      purpose, provider: binding?.provider ?? (typeof llm?.provider === "string" ? llm.provider : undefined),
    });
  }
  const model = resolveLanguageModel(padrao);
  return model === null ? null : { model, modelId: String(padrao), origem: "padrao" };
}

interface LinhaBinding {
  provider: string;
  credential_id: string | null;
  model_id: string;
  base_url: string | null;
}

async function lerConfigDaOrganizacao(
  organizationId: string,
  purpose: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("organizations").select("settings").eq("id", organizationId).maybeSingle();
    if (error) throw error;
    return (data?.settings as { llm?: Record<string, unknown> } | null)?.llm ?? null;
  } catch {
    // Sem ler a política da org, o fallback pode violar uma proibição ativa.
    throw new CredencialPropriaObrigatoriaError(organizationId, "settings_unavailable", { purpose });
  }
}

async function lerBinding(
  purpose: string,
  organizationId: string,
  estrito: boolean,
): Promise<LinhaBinding | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("ai_purpose_bindings")
      .select("provider, credential_id, model_id, base_url")
      .eq("organization_id", organizationId)
      .eq("purpose", purpose)
      .eq("is_enabled", true)
      .maybeSingle();
    if (error) throw error;
    return (data as LinhaBinding | null) ?? null;
  } catch {
    if (estrito) throw new CredencialPropriaObrigatoriaError(organizationId, "binding_unavailable", { purpose });
    logger.warn("[gateway-binding] não consegui ler o binding — usando o padrão", {
      organization_id: organizationId, purpose,
    });
    return null;
  }
}

/**
 * O id canônico traduzido para o que o provider da organização entende — ou
 * `null` quando ele não sabe executar aquele modelo.
 *
 * O prefixo de um id canônico (`anthropic/claude-haiku-4-5`) é ROTA, não nome
 * de modelo: quem já está dentro do provedor recebe só o nome, e é o que
 * `resolveLanguageModel` faz ao rotear pelo prefixo. A OpenRouter é a exceção
 * porque é agregadora — lá o prefixo é parte do endereço e vai inteiro.
 *
 * O `null` é o freio do PR #151: id de outro provedor não vira chamada com a
 * chave da organização, vira queda para `resolveLanguageModel`, que sabe achar
 * a chave certa para aquele prefixo.
 */
function idParaOProvider(provider: string, id: string): string | null {
  if (provider === "openrouter") return id;
  if (!id.includes("/")) return id;
  if (id.startsWith(`${provider}/`)) return id.slice(provider.length + 1);
  return null;
}

/** Decifra uma credencial da organização. Plaintext só existe em memória. */
async function decifrarChave(
  organizationId: string,
  provider: string,
  credentialId: string | null,
  estrito: boolean,
): Promise<string | null> {
  try {
    let query = createAdminClient().from("ai_provider_credentials")
      .select("api_key_encrypted, api_key_iv, api_key_tag")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .not("validated_at", "is", null);
    if (credentialId) query = query.eq("id", credentialId);
    if (estrito || !credentialId) query = query.eq("provider", provider);
    if (estrito) query = query.eq("origem", "propria").is("validation_error", null);
    if (!credentialId) query = query.eq("selecao_explicita", false).order("created_at", { ascending: false }).limit(1);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const apiKey = decryptKey({
      ciphertext: byteaToBuffer(data.api_key_encrypted),
      iv: byteaToBuffer(data.api_key_iv),
      tag: byteaToBuffer(data.api_key_tag),
    });
    if (estrito && [env.OPENAI_API_KEY, env.ANTHROPIC_API_KEY, env.OPENROUTER_API_KEY,
      env.AI_GATEWAY_API_KEY].includes(apiKey)) return null;
    return apiKey;
  } catch {
    if (!estrito) {
      logger.warn("[gateway-binding] credencial da organização indisponível", {
        organization_id: organizationId, provider,
      });
    }
    return null;
  }
}

/**
 * Instancia o provider. Espelha `createDefaultRegistry` do agent-engine — e a
 * duplicação é consciente e temporária: unificar exige que estes workers falem
 * `pg.Pool`, que é a dívida registrada no handoff. Provider desconhecido
 * devolve `null` para o chamador cair no padrão com aviso, nunca um fallback
 * silencioso para outro provedor.
 */
function instanciar(
  provider: string,
  apiKey: string,
  modelId: string,
  baseUrl: string | null,
): LanguageModel | null {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case "openrouter":
      return createOpenAI({ apiKey, baseURL: baseUrl ?? OPENROUTER_BASE_URL })(modelId);
    default:
      return null;
  }
}
