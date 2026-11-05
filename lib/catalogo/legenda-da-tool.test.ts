import descricoesReais from "@/tests/fixtures/catalogo-legendas-reais.json";
import { describe, expect, it } from "vitest";

import { montarLegendaDaTool } from "./legenda-da-tool";

function linha(item: (typeof descricoesReais)[number]) {
  return {
    codigo: item.sku,
    nome: item.nome,
    descricao: item.descricao,
    opcao_preco: null,
    preco_cents: 12990,
    moeda: "BRL",
  };
}

describe("legenda determinística do catálogo", () => {
  it("usa o preço da linha selecionada, texto simples e uma lista curta de opções", () => {
    const base = {
      codigo: "A",
      nome: "Kit *Especial*",
      descricao: "Primeira linha. Segunda linha.",
      opcao_preco: "Versão: A",
      preco_cents: 12990,
      moeda: "BRL",
    };
    const legenda = montarLegendaDaTool(base, [
      base,
      ...["B", "C", "D", "E"].map((codigo, indice) => ({
        ...base,
        codigo,
        opcao_preco: `Versão: ${codigo}`,
        preco_cents: 13990 + indice * 1000,
      })),
    ]);

    expect(legenda).toMatch(/R\$\s129,90/);
    expect(legenda).toMatch(/Versão: B: R\$\s139,90/);
    expect(legenda).toContain("e mais 1 opção");
    expect(legenda).not.toContain("Versão: E:");
    expect(legenda).not.toMatch(/[*_~`#>—–]/);
  });

  it.each(descricoesReais)("limpa a descrição real $sku", (item) => {
    const legenda = montarLegendaDaTool(linha(item), [linha(item)]);
    const partes = legenda.split("\n");
    const nome = partes[0] ?? "";
    const resumo = partes.at(-1) ?? "";

    expect(nome.length).toBeLessThanOrEqual(90);
    expect(item.nome.startsWith(nome)).toBe(true);
    expect(resumo.length).toBeLessThanOrEqual(220);
    expect(resumo).toMatch(/[.!?]$/);
    expect(resumo).not.toMatch(/SOBRE O PRODUTO|DETALHES|PRAZOS E ENVIO/);
    expect(legenda).not.toMatch(/[*_~`#>—–]/);
  });

  it("não atravessa uma seção proibida mesmo quando ela aparece logo após o cabeçalho", () => {
    const selecionada = linha(descricoesReais[0]!);
    selecionada.descricao = "SOBRE O PRODUTO\nDETALHES\nTexto que não pode entrar.\n\nPRAZOS E ENVIO\nPrazo que não pode entrar.";

    const legenda = montarLegendaDaTool(selecionada, [selecionada]);
    expect(legenda).not.toContain("Texto que não pode entrar");
    expect(legenda).not.toContain("Prazo que não pode entrar");
  });

  it("usa o título fixo sem cortar a parte que diferencia os produtos", () => {
    const selecionada = {
      codigo: "A",
      nome: "Nome longo que não deve aparecer",
      descricao: null,
      opcao_preco: "Versão: Casal",
      preco_cents: 12990,
      moeda: "BRL",
    };
    const legenda = montarLegendaDaTool(selecionada, [selecionada], {
      tituloFixo: "Kit Afeto com caixa pinus e tampa acrílica",
    });
    expect(legenda.split("\n")[0]).toBe("Kit Afeto com caixa pinus e tampa acrílica");
    expect(legenda).toContain("Versão: Casal");
    expect(legenda).toMatch(/R\$\s129,90/);
  });

  it("sem tituloFixo preserva exatamente a legenda anterior", () => {
    const selecionada = {
      codigo: "A",
      nome: "Kit Especial",
      descricao: "Primeira linha. Segunda linha.",
      opcao_preco: "Versão: A",
      preco_cents: 12990,
      moeda: "BRL",
    };
    expect(montarLegendaDaTool(selecionada, [selecionada])).toBe(
      "Kit Especial\nVersão: A\nR$\u00a0129,90\nPrimeira linha. Segunda linha.",
    );
  });
});
