import { describe, expect, it } from "vitest";

import { montarLegendaDoProduto } from "@/lib/catalogo/mensagem-do-produto";

describe("legenda do produto enviada na conversa", () => {
  it("leva nome, preço e descrição curta", () => {
    expect(
      montarLegendaDoProduto({
        nome: "Caneca esmaltada",
        preco_cents: 12990,
        moeda: "BRL",
        descricao: "Personalização frente e verso. Prazo confirmado após aprovação da arte.",
      }),
    ).toBe(
      "Caneca esmaltada\nR$ 129,90\nPersonalização frente e verso. Prazo confirmado após aprovação da arte.",
    );
  });

  it("limita a descrição sem cortar o restante da mensagem", () => {
    const legenda = montarLegendaDoProduto({
      nome: "Produto",
      preco_cents: 1000,
      moeda: "BRL",
      descricao: "x".repeat(400),
    });
    expect(legenda.length).toBeLessThan(280);
    expect(legenda).toContain("…");
  });

  it("não inventa descrição quando ela não existe", () => {
    expect(
      montarLegendaDoProduto({
        nome: "Produto",
        preco_cents: 1000,
        moeda: "BRL",
        descricao: null,
      }),
    ).toBe("Produto\nR$ 10,00");
  });

  it("substitui a descrição pela legenda personalizada, preservando nome e preço", () => {
    expect(
      montarLegendaDoProduto({
        nome: "Produto",
        preco_cents: 1000,
        moeda: "BRL",
        descricao: "Descrição do painel",
        legenda_atendimento: "Prazo combinado após a aprovação da arte.",
      }),
    ).toBe("Produto\nR$ 10,00\nPrazo combinado após a aprovação da arte.");
  });

  it("corta somente a legenda personalizada para respeitar o teto", () => {
    const legenda = montarLegendaDoProduto({
      nome: "Produto",
      preco_cents: 1000,
      moeda: "BRL",
      descricao: null,
      legenda_atendimento: "x".repeat(2000),
    });
    expect(legenda).toHaveLength(1024);
    expect(legenda).toMatch(/^Produto\nR\$ 10,00\n/);
    expect(legenda.endsWith("…")).toBe(true);
  });
});
