import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { computeCost } from "./cost";

function preco(provider: string, model_id: string, entrada: number | null, saida: number | null) {
  return {
    provider,
    model_id,
    input_price_per_million_cents: entrada,
    output_price_per_million_cents: saida,
  };
}

function catalogo(...rows: ReturnType<typeof preco>[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { db: { query } as unknown as Pool, query };
}

describe("custo pelo catálogo de modelos", () => {
  it("separa por provedor, prefere o snapshot exato e aceita o sufixo de data", async () => {
    const { db, query } = catalogo(
      preco("openrouter", "openai/gpt-5.4-mini", 90, 600),
      preco("openai", "gpt-5.4-mini", 75, 450),
      preco("openai", "gpt-5.4-mini-2026-03-17", 50, 350),
    );
    const custo = (model: string) => computeCost({
      provider: "openai", model, inputTokens: 1000, outputTokens: 1000,
    }, db);
    await expect(Promise.all([
      custo("gpt-5.4-mini-2026-03-17"),
      custo("gpt-5.4-mini-2026-03-18"),
    ])).resolves.toEqual([0.4, 0.525]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("aceita o id OpenRouter com ou sem família, sem pegar preço de outro provedor", async () => {
    const { db } = catalogo(
      preco("openrouter", "deepseek/deepseek-v4-flash", 9, 18),
      preco("deepseek", "deepseek-v4-flash", 25, 60),
      preco("openrouter", "modelo-sem-familia", 30, 40),
    );
    const custo = (model: string) => computeCost({
      provider: "openrouter", model, inputTokens: 1000, outputTokens: 1000,
    }, db);
    await expect(custo("deepseek/deepseek-v4-flash")).resolves.toBe(0.027);
    await expect(custo("deepseek-v4-flash")).resolves.toBe(0.027);
    await expect(custo("familia/modelo-sem-familia")).resolves.toBe(0.07);
  });

  it("mantém nulos o preço desconhecido, incompleto e a família ambígua", async () => {
    const { db } = catalogo(
      preco("openai", "incompleto", 25, null),
      preco("openrouter", "familia/modelo", 10, 20),
      preco("openrouter", "outra/modelo", 30, 40),
    );
    await expect(computeCost({ provider: "openai", model: "incompleto" }, db)).resolves.toBeNull();
    await expect(computeCost({ provider: "openai", model: "desconhecido" }, db)).resolves.toBeNull();
    await expect(computeCost({ provider: "openrouter", model: "modelo" }, db)).resolves.toBeNull();
  });

  it("preserva as tarifas de cache do Claude e a contingência de entrada e saída", async () => {
    const { db } = catalogo(preco("anthropic", "claude-sonnet-4", 200, 1000));
    const chamada = {
      provider: "anthropic", model: "claude-sonnet-4", inputTokens: 1000,
      outputTokens: 500, cacheReadTokens: 300, cacheWriteTokens: 200,
    };
    await expect(computeCost(chamada, db)).resolves.toBe(0.729);
    await expect(computeCost(chamada, catalogo().db)).resolves.toBe(1.029);
  });

  it("recarrega após o TTL e conserva o último catálogo se a leitura falhar", async () => {
    vi.useFakeTimers();
    try {
      const { db, query } = catalogo(preco("openai", "modelo", 25, 200));
      const chamada = { provider: "openai", model: "modelo", inputTokens: 1000 };
      await expect(computeCost(chamada, db)).resolves.toBe(0.025);
      vi.advanceTimersByTime(60_001);
      query.mockRejectedValueOnce(new Error("falha fictícia"));
      await expect(computeCost(chamada, db)).resolves.toBe(0.025);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
