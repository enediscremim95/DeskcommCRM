import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/crypto/aes_gcm", () => ({
  byteaToBuffer: () => Buffer.from(""),
  decryptKey: () => "chave-byok-da-org",
}));

import {
  llmEdgeConfigFromEnv,
  resolveOrgLlmConfig,
  resolveOrgLlmConfigParaTranscricao,
  LlmNotConfiguredError,
  type LlmEdgeConfig,
} from "./credentials";

/** Pool falso: 1ª query devolve settings->'llm', 2ª devolve credenciais BYOK. */
function poolFake(settingsLlm: unknown, credenciais: unknown[]) {
  let n = 0;
  return {
    query: async () => {
      n += 1;
      return n === 1 ? { rows: [{ llm: settingsLlm }] } : { rows: credenciais };
    },
  } as never;
}

const SEM_BYOK: unknown[] = [];

describe("resolveOrgLlmConfig — chave de plataforma por provider", () => {
  it("usa a chave OpenAI do ambiente quando a org não tem BYOK", async () => {
    // O defeito de origem: existia fallback de env só para a Anthropic. A
    // transcrição de áudio chama o Whisper (OpenAI), e numa org que usa
    // Anthropic no chat isso lançava LlmNotConfiguredError — ou, pior, o
    // chamador mandava a chave da Anthropic para a OpenAI e levava 401. A
    // OPENAI_API_KEY que o instalador coleta não chegava a lugar nenhum.
    const cfg: LlmEdgeConfig = { anthropicApiKey: "sk-ant-plataforma", openaiApiKey: "sk-proj-plataforma" };
    const out = await resolveOrgLlmConfig(
      poolFake({ provider: "anthropic", default_model: "claude-sonnet-4-6" }, SEM_BYOK),
      cfg,
      "org-1",
      { provider: "openai" },
    );
    expect(out.provider).toBe("openai");
    expect(out.apiKey).toBe("sk-proj-plataforma");
  });

  it("mantém a chave Anthropic do ambiente (comportamento que já existia)", async () => {
    const out = await resolveOrgLlmConfig(
      poolFake({ provider: "anthropic", default_model: "claude-sonnet-4-6" }, SEM_BYOK),
      { anthropicApiKey: "sk-ant-plataforma" },
      "org-1",
    );
    expect(out.apiKey).toBe("sk-ant-plataforma");
  });

  it("a credencial BYOK da org vence a do ambiente", async () => {
    const out = await resolveOrgLlmConfig(
      poolFake({ provider: "openai", default_model: "gpt-4o" }, [
        { api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" },
      ]),
      { openaiApiKey: "sk-proj-plataforma" },
      "org-1",
    );
    expect(out.apiKey).toBe("chave-byok-da-org");
  });

  it("sem BYOK e sem chave de plataforma, falha em vez de inventar", async () => {
    await expect(
      resolveOrgLlmConfig(poolFake({ provider: "openai" }, SEM_BYOK), {}, "org-1"),
    ).rejects.toBeInstanceOf(LlmNotConfiguredError);
  });
});

/**
 * A ponte que faltava. Os testes acima provam que `resolveOrgLlmConfig` USA
 * `openaiApiKey` — e passavam. Só que nenhum caminho do agente PREENCHIA o campo:
 * `llmEdgeConfigFromEnv` montava apenas a chave da Anthropic, e o único lugar que
 * preenchia a da OpenAI era o worker de transcrição, na mão.
 *
 * Guardar a função de consumo não guarda o call site: a instalação tinha a chave
 * no `.env`, o teste do consumidor estava verde, e o agente OpenAI morria com
 * "org sem credencial LLM utilizável".
 */
describe("llmEdgeConfigFromEnv — o que sai do .env chega ao turno", () => {
  it("leva a chave da OpenAI, não só a da Anthropic", () => {
    const cfg = llmEdgeConfigFromEnv({
      ANTHROPIC_API_KEY: "sk-ant-x",
      OPENAI_API_KEY: "sk-proj-y",
    });
    expect(cfg.anthropicApiKey).toBe("sk-ant-x");
    expect(cfg.openaiApiKey).toBe("sk-proj-y");
  });

  it("chave ausente continua ausente — string vazia não vira credencial", () => {
    const cfg = llmEdgeConfigFromEnv({ ANTHROPIC_API_KEY: "sk-ant-x", OPENAI_API_KEY: "" });
    expect(cfg).not.toHaveProperty("openaiApiKey");
  });

  it("só OpenAI configurada: a config sai utilizável mesmo sem a Anthropic", () => {
    const cfg = llmEdgeConfigFromEnv({ OPENAI_API_KEY: "sk-proj-y" });
    expect(cfg).not.toHaveProperty("anthropicApiKey");
    expect(cfg.openaiApiKey).toBe("sk-proj-y");
  });

  it("o caminho inteiro: chave do .env resolve um modelo OpenAI numa org sem BYOK", async () => {
    const cfg = llmEdgeConfigFromEnv({ OPENAI_API_KEY: "sk-proj-do-env" });
    const out = await resolveOrgLlmConfig(
      poolFake({ provider: "openai", default_model: "gpt-5-mini" }, SEM_BYOK),
      cfg,
      "org1",
    );
    expect(out.apiKey).toBe("sk-proj-do-env");
  });
});

describe("credencial própria obrigatória", () => {
  const cfg = { openrouterApiKey: "ficticia-chave-compartilhada" };
  const settings = { provider: "openrouter", sem_fallback_compartilhado: true };
  const id = "22222222-2222-4222-8222-222222222222";
  const linhaCifrada = { api_key_encrypted: "x", api_key_iv: "y", api_key_tag: "z" };

  it("proíbe o ambiente inclusive quando a chave explícita sumiu", async () => {
    await expect(resolveOrgLlmConfig(poolFake(settings, []), cfg, "org-1", {
      provider: "openrouter", credentialId: id,
    })).rejects.toMatchObject({ name: "llm_own_credential_required" });
  });

  it("exige origem própria e consulta exatamente o ponteiro aprovado e o fornecedor", async () => {
    const consultas: unknown[][] = [];
    const pool = {
      query: async (...args: unknown[]) => {
        consultas.push(args);
        return consultas.length === 1
          ? { rows: [{ llm: { ...settings, credential_id: id } }] }
          : { rows: [linhaCifrada] };
      },
    } as never;

    await expect(resolveOrgLlmConfig(pool, cfg, "org-1")).resolves.toMatchObject({
      provider: "openrouter", apiKey: "chave-byok-da-org",
    });
    expect(consultas[1]).toEqual([
      expect.stringContaining("origem = 'propria'"),
      ["org-1", id, "openrouter"],
    ]);
  });

  it("recusa o mesmo valor da chave de plataforma mesmo se marcado como próprio", async () => {
    await expect(resolveOrgLlmConfig(
      poolFake(settings, [linhaCifrada]), { openrouterApiKey: "chave-byok-da-org" }, "org-1",
    )).rejects.toMatchObject({ name: "llm_own_credential_required" });
  });

  it("preserva a política de credenciais para transcrição", async () => {
    await expect(resolveOrgLlmConfigParaTranscricao(
      poolFake(settings, []), cfg, "org-1",
    )).resolves.toMatchObject({ apiKey: cfg.openrouterApiKey });
  });
});
