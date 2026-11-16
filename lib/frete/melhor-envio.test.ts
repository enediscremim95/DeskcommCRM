import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cotarNoMelhorEnvio, ErroMelhorEnvio } from "./melhor-envio";

const TOKEN = "TOKEN-SENTINELA-NAO-PODE-VAZAR";
const fixture: unknown = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/melhor-envio-cotacao.json"), "utf8"),
);
const entrada = {
  baseUrl: "https://melhorenvio.com.br/api/v2",
  userAgent: "Loja Exemplo contato@example.test",
  token: TOKEN,
  fromPostalCode: "83320590",
  toPostalCode: "80010000",
  package: { height: 25, width: 30, length: 35, weight: 3 },
  insuranceValue: 169.9,
  serviceAllowlist: [1, 2, 17],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("cliente do Melhor Envio", () => {
  it("usa somente calculate, os cabeçalhos obrigatórios e a origem recebida", async () => {
    let urlRecebida: RequestInfo | URL | undefined;
    let initRecebido: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      urlRecebida = url;
      initRecebido = init;
      return Response.json(fixture);
    });
    const opcoes = await cotarNoMelhorEnvio(entrada, { fetchImpl: fetchImpl as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(urlRecebida)).toBe("https://melhorenvio.com.br/api/v2/me/shipment/calculate");
    expect(String(urlRecebida)).not.toMatch(/cart|checkout/u);
    expect(initRecebido?.method).toBe("POST");
    expect(initRecebido?.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": entrada.userAgent,
    });
    expect(JSON.parse(String(initRecebido?.body))).toEqual({
      from: { postal_code: "83320590" },
      to: { postal_code: "80010000" },
      package: entrada.package,
      options: { receipt: false, own_hand: false, insurance_value: 169.9 },
    });
    expect(opcoes).toEqual([
      expect.objectContaining({ id: 1, valor_cents: 3069, empresa: "Correios" }),
      expect.objectContaining({ id: 2, valor_cents: 3388, prazo_transporte_dias_uteis: 2 }),
    ]);
  });

  it("descarta serviço com error e respeita a allowlist", async () => {
    const fetchImpl = vi.fn(async () => Response.json(fixture));
    const opcoes = await cotarNoMelhorEnvio(
      { ...entrada, serviceAllowlist: [1, 17] },
      { fetchImpl },
    );
    expect(opcoes.map((opcao) => opcao.id)).toEqual([1]);
  });

  it.each([401, 403, 429])("não repete HTTP %s e não lê o corpo", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(`segredo ${TOKEN}`, { status }));
    const falha = await cotarNoMelhorEnvio(entrada, { fetchImpl }).catch(
      (erro: unknown) => erro,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(falha).toBeInstanceOf(ErroMelhorEnvio);
    expect((falha as Error).message).toContain("passe para uma pessoa");
    expect(`${(falha as Error).name}|${(falha as Error).message}|${(falha as Error).stack}`).not.toContain(
      TOKEN,
    );
  });

  it("faz uma única tentativa extra para erro de rede", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("rede caiu"))
      .mockResolvedValueOnce(Response.json(fixture));
    await expect(cotarNoMelhorEnvio(entrada, { fetchImpl })).resolves.toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborta em 8 s por tentativa e devolve erro sanitizado", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("abortado", "AbortError")),
          );
        }),
    );
    const pendente = cotarNoMelhorEnvio(entrada, { fetchImpl, timeoutMs: 8_000 });
    const assercao = expect(pendente).rejects.toMatchObject({ code: "frete_rede_indisponivel" });
    await vi.runAllTimersAsync();
    await assercao;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("remove o token sentinela mesmo quando a falha original o contém", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`falha contendo ${TOKEN}`);
    });
    const falha = await cotarNoMelhorEnvio(entrada, { fetchImpl }).catch(
      (erro: unknown) => erro,
    );
    const superficie = JSON.stringify({
      nome: (falha as Error).name,
      mensagem: (falha as Error).message,
      codigo: (falha as ErroMelhorEnvio).code,
      stack: (falha as Error).stack,
    });
    expect(superficie).not.toContain(TOKEN);
  });
});
