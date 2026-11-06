import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  normalizarRetratoDoPainel,
  origemCanonicaDaFoto,
  planejarGaleria,
  retratoDoPainelSchema,
} from "./importar-painel";

const retrato = {
  produtos: [
    {
      sku: "PAI-1",
      nome: "Kit de teste",
      grupo: "Presentes",
      tipo: "kit",
      situacao: "A",
      descricao: "Linha um. Linha dois.",
      acompanha: ["1 caixa"],
      precos: [10.1, 20.29],
      opcoes: { Versão: ["Básica", "Completa"], Cor: ["Azul", "Rosa"] },
      opcoes_precos: {
        Versão: { muda_preco: true, valores: [] },
        Cor: { muda_preco: false, valores: [] },
      },
      variacoes: [
        { codigo: "BAS-AZ", atributos: { Versão: "Básica", Cor: "Azul" }, preco: 10.1 },
        { codigo: "BAS-RO", atributos: { Versão: "Básica", Cor: "Rosa" }, preco: 10.1 },
        { codigo: "COM-AZ", atributos: { Versão: "Completa", Cor: "Azul" }, preco: 20.29 },
      ],
      fotos: [
        { url: "https://orgbling.s3.amazonaws.com/tenant/a?X-Amz-Signature=segredo", h: "hash-a" },
      ],
    },
  ],
};

describe("normalização do retrato do painel", () => {
  it("gera somente uma linha por opção que muda preço e converte reais sem deriva", () => {
    const normalizados = normalizarRetratoDoPainel(retratoDoPainelSchema.parse(retrato));
    expect(normalizados[0]?.linhas).toEqual([
      expect.objectContaining({ codigo: "BAS-AZ", preco_cents: 1010, opcao_preco: "Versão: Básica" }),
      expect.objectContaining({ codigo: "COM-AZ", preco_cents: 2029, opcao_preco: "Versão: Completa" }),
    ]);
  });

  it("desativa Recuperados e rejeita a décima foto", () => {
    const recuperado = structuredClone(retrato);
    recuperado.produtos[0]!.grupo = "Recuperados";
    expect(normalizarRetratoDoPainel(retratoDoPainelSchema.parse(recuperado))[0]?.ativo).toBe(false);
    recuperado.produtos[0]!.fotos = Array.from({ length: 10 }, (_, i) => ({
      url: `https://orgbling.s3.amazonaws.com/x/${i}`,
      h: `h${i}`,
    }));
    expect(retratoDoPainelSchema.safeParse(recuperado).success).toBe(false);
  });

  it("reimporta por hash, detecta ordem e remoção sem duplicar", () => {
    const antigas = [
      { source_hash: "a", posicao: 1 },
      { source_hash: "b", posicao: 2 },
    ];
    expect(planejarGaleria([{ h: "a" }, { h: "b" }], antigas)).toEqual({
      novas: [],
      removidas: [],
      reordenadas: [],
    });
    expect(planejarGaleria([{ h: "b" }, { h: "c" }], antigas)).toEqual({
      novas: ["c"],
      removidas: ["a"],
      reordenadas: ["b", "c"],
    });
  });

  it("descarta a query assinada e persiste somente host, path e h", () => {
    const origem = origemCanonicaDaFoto(
      "https://orgbling.s3.amazonaws.com/tenant/a?X-Amz-Signature=nao-pode-vazar&x=1",
      "hash-a",
    );
    expect(origem).toBe("https://orgbling.s3.amazonaws.com/tenant/a?h=hash-a");
    expect(origem).not.toContain("Signature");
  });

  it("casa peso e medidas pelo SKU e usa a caixa mais pesada da mesma linha de preço", () => {
    const fixture: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), "tests/fixtures/painel-retrato-fixture.json"), "utf8"),
    );
    const [produto] = normalizarRetratoDoPainel(retratoDoPainelSchema.parse(fixture));

    expect(produto?.linhas).toEqual([
      expect.objectContaining({
        codigo: "KIT-COMPLETO-AZUL",
        peso_kg: 1.8,
        altura_cm: 12,
        largura_cm: 22,
        comprimento_cm: 32,
        embalagem_estimada: true,
      }),
    ]);
  });
});
