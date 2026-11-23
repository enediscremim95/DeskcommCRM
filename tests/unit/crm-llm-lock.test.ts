import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const fonte = readFileSync("deploy/crm-llm-lock.cjs", "utf8");
const modelo = "deepseek/deepseek-v4-flash";
const endpoint = "https://openrouter.ai/api/v1";
const compartilhada = "ficticia-compartilhada-teste";
const plataforma = "ficticia-plataforma-teste";
const propria = "ficticia-propria-somente-teste";

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
const chat = (body: Record<string, unknown>, chave = propria): RequestInit => ({
  method: "POST",
  headers: { authorization: `Bearer ${chave}`, "content-length": "123" },
  body: JSON.stringify(body),
});

function carregar(env: Record<string, string> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ model: modelo }));
  const esperar = vi.fn();
  const stderr = vi.fn();
  const contexto = {
    fetch, URL, Request, Headers, Buffer, AbortSignal, TypeError,
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    require: () => ({ setTimeout: esperar }),
    process: {
      env: {
        CRM_LLM_LOCK_MODEL: modelo, OPENROUTER_BASE_URL: endpoint,
        OPENROUTER_API_KEY: compartilhada, OPENAI_API_KEY: plataforma,
        ANTHROPIC_API_KEY: plataforma, GOOGLE_GENERATIVE_AI_API_KEY: plataforma, ...env,
      },
      stderr: { write: stderr },
    },
  };
  runInNewContext(fonte, contexto);
  return { chamar: contexto.fetch, fetch, esperar, stderr };
}

describe("trava legada", () => {
  it("exige modelo e endpoint na inicialização", () => {
    expect(() => carregar({ CRM_LLM_LOCK_MODEL: "" })).toThrow(/configuração obrigatória/);
    expect(() => carregar({ OPENROUTER_BASE_URL: "" })).toThrow(/configuração obrigatória/);
  });

  it.each(["embeddings", "audio/transcriptions", "audio/translations"])(
    "preserva %s", async (path) => {
      const { chamar, fetch } = carregar();
      const init = chat({ model: "outro" });
      const url = `https://api.openai.com/v1/${path}`;
      await chamar(url, init);
      expect(fetch).toHaveBeenCalledWith(url, init);
    },
  );

  it("preserva GET e POST fora dos endpoints de chat", async () => {
    const { chamar, fetch } = carregar();
    await chamar(`${endpoint}/models`);
    await chamar("https://example.invalid/receber", chat({ model: "outro" }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [`${endpoint}/chat/completions`, { model: "outro" }],
    [`${endpoint}/chat/completions`, { model: modelo, models: [] }],
    ["https://api.anthropic.com/v1/messages", { model: modelo }],
    ["https://example.invalid/v1/chat/completions", { model: modelo }],
  ])("bloqueia destino, modelo ou fallback não autorizado (%s)", async (url, body) => {
    const { chamar, fetch } = carregar();
    await expect(chamar(url, chat(body))).rejects.toThrow(/somente OpenRouter/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("injeta a chave compartilhada e conserva apenas o roteamento por provedor FP8 ou superior", async () => {
    const { chamar, fetch } = carregar();
    await chamar(new Request(`${endpoint}/chat/completions`, chat({
      model: modelo, route: "fallback", provider: { only: ["outro"], sort: "price" },
      reasoning: { enabled: true },
    })));
    const req = fetch.mock.calls[0]![0] as Request;
    expect(req.headers.get("authorization")).toBe(`Bearer ${compartilhada}`);
    expect(req.headers.has("content-length")).toBe(false);
    expect(await req.json()).toEqual({
      model: modelo, reasoning: { enabled: false },
      provider: {
        order: ["deepinfra", "gmicloud", "baidu", "streamlake", "siliconflow", "parasail"],
        allow_fallbacks: true, quantizations: ["fp8", "fp16", "bf16", "fp32"],
        ignore: ["atlas-cloud", "relace", "wafer"],
      },
    });
  });

  it("repete em falha de rede e em 429, respeitando Retry-After e mantendo o corpo", async () => {
    const { chamar, fetch, esperar } = carregar();
    fetch.mockRejectedValueOnce(new TypeError())
      .mockResolvedValueOnce(json({}, { status: 429, headers: { "retry-after": "5" } }));
    await expect(chamar(`${endpoint}/chat/completions`, chat({ model: modelo })))
      .resolves.toMatchObject({ status: 200 });
    expect(esperar.mock.calls.map(([ms]) => ms)).toEqual([1000, 5000]);
    const corpos = await Promise.all(fetch.mock.calls.map(([req]) => (req as Request).text()));
    expect(corpos).toHaveLength(3);
    expect(new Set(corpos).size).toBe(1);
  });

  it.each([[500, 3], [503, 3], [401, 1]])("limita o HTTP %i a %i chamadas", async (status, vezes) => {
    const { chamar, fetch } = carregar();
    fetch.mockImplementation(async () => json({}, { status }));
    await expect(chamar(`${endpoint}/chat/completions`, chat({ model: modelo })))
      .resolves.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(vezes);
  });

  it("respeita cancelamento do chamador e não repete erro permanente", async () => {
    const { chamar, fetch, esperar } = carregar();
    await expect(chamar(`${endpoint}/chat/completions`, {
      ...chat({ model: modelo }), signal: AbortSignal.abort(),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error("permanente"));
    await expect(chamar(`${endpoint}/chat/completions`, chat({ model: modelo })))
      .rejects.toThrow("permanente");
    expect(esperar).not.toHaveBeenCalled();
  });

  it("recusa divergência do modelo efetivo e preserva streaming", async () => {
    const { chamar, fetch } = carregar();
    fetch.mockImplementation(async () => json({ model: "outro" }));
    await expect(chamar(`${endpoint}/chat/completions`, chat({ model: modelo })))
      .rejects.toThrow(/modelo efetivo divergente/);
    await expect(chamar(`${endpoint}/chat/completions`, chat({ model: modelo, stream: true })))
      .resolves.toMatchObject({ status: 200 });
  });

  it.each(["gpt-5.4-mini", "gpt-5-mini"])("preserva a exceção BYOK %s e valida o modelo efetivo", async (id) => {
    const { chamar, fetch } = carregar();
    const url = "https://api.openai.com/v1/responses";
    const init = chat({ model: id });
    fetch.mockResolvedValueOnce(json({ model: `${id}-snapshot` }));
    await chamar(url, init);
    expect(fetch).toHaveBeenCalledWith(url, init);
    await expect(chamar(url, init)).rejects.toThrow(/modelo efetivo divergente/);
  });

  it.each([
    ["responses", "gpt-5-mini", plataforma, {}],
    ["responses", "gpt-5-mini", compartilhada, {}],
    ["responses", "gpt-5-mini", "", {}],
    ["responses", "gpt-5-mini", propria, { models: [] }],
    ["responses", "gpt-5", propria, {}],
    ["completions", "gpt-5-mini", propria, {}],
  ] as const)("restringe a exceção OpenAI (%s, %s)", async (path, id, chave, extra) => {
    const { chamar, fetch } = carregar();
    await expect(chamar(`https://api.openai.com/v1/${path}`, chat({ model: id, ...extra }, chave)))
      .rejects.toThrow(/OpenAI só com chave própria/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

const modoLista = {
  CRM_LLM_LOCK_MODO: "lista",
  CRM_LLM_LOCK_LISTA_JSON: JSON.stringify({
    openai: ["gpt-5"], anthropic: ["claude-chat"], google: ["gemini-chat"],
    openrouter: ["familia/modelo"],
  }),
};

describe("trava por lista", () => {
  it.each([
    ["https://api.openai.com/v1/responses", "authorization", { model: "gpt-5" }],
    ["https://api.anthropic.com/v1/messages", "x-api-key", { model: "claude-chat" }],
    ["https://generativelanguage.googleapis.com/v1beta/models/gemini-chat:streamGenerateContent", "x-goog-api-key", { contents: [] }],
    [`${endpoint}/chat/completions`, "authorization", { model: "familia/modelo" }],
  ] as const)("preserva a chave e a requisição autorizada em %s", async (url, header, body) => {
    const { chamar, fetch, stderr } = carregar(modoLista);
    const init = { ...chat(body), headers: { [header]: header === "authorization" ? `Bearer ${propria}` : propria } };
    await chamar(url, init);
    expect(fetch).toHaveBeenCalledWith(url, { ...init, redirect: "error" });
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(propria);
  });

  it.each([
    ["https://api.openai.com/v1/responses", chat({ model: "gpt-5" }, plataforma)],
    ["https://api.openai.com/v1/responses", chat({ model: "gpt-5" }, compartilhada)],
    ["https://api.openai.com/v1/responses", chat({ model: "gpt-5" }, "")],
    ["https://api.openai.com/v1/responses", chat({ model: "gpt-5-mini" })],
    ["https://api.openai.com/v1/responses", chat({ model: "gpt-5", models: ["outro"] })],
    ["https://proxy.openai.com/v1/responses", chat({ model: "gpt-5" })],
    ["https://generativelanguage.googleapis.com/v1beta/models/outro:generateContent", {
      ...chat({ contents: [] }), headers: { "x-goog-api-key": propria },
    }],
  ])("recusa modelo, chave ou host fora da política (%s)", async (url, init) => {
    const { chamar, fetch } = carregar(modoLista);
    await expect(chamar(url, init)).rejects.toThrow(/fora da política/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserva a trava compartilhada em modo lista, inclusive o retry", async () => {
    const { chamar, fetch, esperar } = carregar(modoLista);
    const url = `${endpoint}/chat/completions`;
    await expect(chamar(url, chat({ model: "familia/modelo" }, compartilhada)))
      .rejects.toThrow(/somente OpenRouter/);
    fetch.mockResolvedValueOnce(json({}, { status: 503 }));
    await chamar(url, chat({ model: modelo }, compartilhada));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(esperar).toHaveBeenCalledTimes(1);
    const req = fetch.mock.calls[1]![0] as Request;
    expect(req.headers.get("authorization")).toBe(`Bearer ${compartilhada}`);
    expect(await req.json()).toMatchObject({ model: modelo, provider: { quantizations: ["fp8", "fp16", "bf16", "fp32"] } });
  });

  it.each(["", "{", "[]", '{"outro":[]}', '{"openai":[42]}'])("recusa JSON ausente ou inválido", (valor) => {
    expect(() => carregar({ ...modoLista, CRM_LLM_LOCK_LISTA_JSON: valor })).toThrow(/lista de modelos inválida/);
  });
});
