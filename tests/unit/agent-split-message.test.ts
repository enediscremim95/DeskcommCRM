// tests/unit/agent-split-message.test.ts
import { describe, expect, it } from "vitest";

import { splitIntoBubbles } from "@/lib/agent-engine/agent/split-message";

describe("splitIntoBubbles", () => {
  it("texto curto vira uma bolha só (trim)", () => {
    expect(splitIntoBubbles("  Olá, tudo bem?  ", 600)).toEqual(["Olá, tudo bem?"]);
  });
  it("vazio/whitespace → []", () => {
    expect(splitIntoBubbles("", 600)).toEqual([]);
    expect(splitIntoBubbles("   \n  ", 600)).toEqual([]);
  });
  it("quebra por parágrafo quando cabe", () => {
    const out = splitIntoBubbles("Primeiro parágrafo.\n\nSegundo parágrafo.", 30);
    expect(out).toEqual(["Primeiro parágrafo.", "Segundo parágrafo."]);
  });
  it("nenhuma bolha excede maxChars (quebra por sentença)", () => {
    const text = "Oi! Como você está hoje? Queria falar do seu pedido. Ele já saiu para entrega.";
    const out = splitIntoBubbles(text, 30);
    expect(out.every((b) => b.length <= 30)).toBe(true);
    expect(out.join(" ")).toContain("pedido");
  });
  it("junta sentenças curtas adjacentes até o teto", () => {
    const out = splitIntoBubbles("Oi. Tudo bem? Beleza.", 100);
    expect(out).toHaveLength(1); // tudo cabe em 100
  });
  it("palavra única maior que o teto vai sozinha (não corta no meio)", () => {
    const big = "a".repeat(50);
    const out = splitIntoBubbles(`curto ${big} fim`, 20);
    expect(out).toContain(big);
    expect(out.every((b) => b.length > 0)).toBe(true);
  });
  it("não perde texto quando o ponto não é seguido de espaço (preço decimal)", () => {
    const out = splitIntoBubbles(
      "Seu pedido de R$149.90 já saiu para entrega hoje as 14h no bairro central.",
      30,
    );
    expect(out.join(" ")).toContain("Seu pedido");
    expect(out.join(" ")).toContain("149");
    expect(out.join(" ")).toContain("central");
  });

  it("nunca parte um valor em reais no separador de milhar (R$ 10.990) entre bolhas", () => {
    // Bug real (YADEA, 2026-09-04): "R$ 10.990" virava bolha "R$ 10." + bolha
    // "990 no cartão…" — o cliente que via só a primeira lia "R$ 10" como o
    // preço de uma moto de R$ 10.990.
    const out = splitIntoBubbles(
      "Temos a DT3 por R$ 9.990 à vista no Pix ou R$ 10.990 no cartão em até 12x sem juros.",
      40,
    );
    for (const bubble of out) {
      expect(bubble).not.toMatch(/\d\.\s*$/); // nenhuma bolha termina em "dígito."
    }
    expect(out.join(" ")).toContain("10.990");
    expect(out.join(" ")).toContain("9.990");
  });

  it("não insere espaço espúrio dentro de um valor em reais (R$ 7. 990)", () => {
    const out = splitIntoBubbles("O valor é R$ 7.990 à vista no Pix.", 30);
    expect(out.join(" ")).not.toContain("7. 990");
    expect(out.join(" ")).toContain("7.990");
  });

  describe("split_por_paragrafo", () => {
    const optIn = { splitPorParagrafo: true } as const;

    it("mantém o caso real da Natalina em uma bolha no legado e duas no opt-in", () => {
      const texto = "Natalina de xícara com pires, tampa e colher\n\nComo posso te chamar?";
      const tetoQueForcaOFluxoLegado = texto.length - 1;

      expect(splitIntoBubbles(texto, tetoQueForcaOFluxoLegado)).toEqual([
        "Natalina de xícara com pires, tampa e colher Como posso te chamar?",
      ]);
      expect(splitIntoBubbles(texto, tetoQueForcaOFluxoLegado, optIn)).toEqual([
        "Natalina de xícara com pires, tampa e colher",
        "Como posso te chamar?",
      ]);
    });

    it("não cola a pergunta sobre menina ou menino ao parágrafo anterior", () => {
      const texto =
        "Fazemos sim o convite para padrinhos de bebê\n\nPor gentileza, é menina ou menino? 💖🩵";
      const tetoQueForcaOFluxoLegado = texto.length - 1;

      expect(splitIntoBubbles(texto, tetoQueForcaOFluxoLegado)).toEqual([
        "Fazemos sim o convite para padrinhos de bebê Por gentileza, é menina ou menino? 💖🩵",
      ]);
      expect(splitIntoBubbles(texto, tetoQueForcaOFluxoLegado, optIn)).toEqual([
        "Fazemos sim o convite para padrinhos de bebê",
        "Por gentileza, é menina ou menino? 💖🩵",
      ]);
    });

    it("prefere a vírgula a separar o nome Kit Natalina", () => {
      const texto =
        "Temos também algumas opções personalizadas para presentear, como o Kit Natalina de xícara com pires, tampa e colher.";

      expect(splitIntoBubbles(texto, 70)).toEqual([
        "Temos também algumas opções personalizadas para presentear, como o Kit",
        "Natalina de xícara com pires, tampa e colher.",
      ]);
      expect(splitIntoBubbles(texto, 70, optIn)).toEqual([
        "Temos também algumas opções personalizadas para presentear,",
        "como o Kit Natalina de xícara com pires, tampa e colher.",
      ]);
    });

    it("quebra parágrafo longo por frase e depois por vírgula, sem perder texto", () => {
      const texto =
        "Primeira frase fecha aqui. Segunda ideia longa, com detalhes do pedido e do prazo de entrega. Terceira frase encerra.";
      const out = splitIntoBubbles(texto, 48, optIn);

      expect(out).toEqual([
        "Primeira frase fecha aqui.",
        "Segunda ideia longa,",
        "com detalhes do pedido e do prazo de entrega.",
        "Terceira frase encerra.",
      ]);
      expect(out.join(" ")).toBe(texto);
      expect(out.every((bolha) => bolha.length <= 48)).toBe(true);
    });

    it("preserva preço com ponto ao cortar um parágrafo longo", () => {
      const texto =
        "O Kit Natalina custa R$ 10.990 à vista no Pix, com personalização e embalagem para presente.";
      const out = splitIntoBubbles(texto, 50, optIn);

      expect(out.join(" ")).toContain("R$ 10.990");
      expect(out.join(" ")).not.toContain("10. 990");
      expect(out.every((bolha) => !/\d\.\s*$/.test(bolha))).toBe(true);
    });

    it("reconhece emoji final como parte do parágrafo e mantém a próxima ideia separada", () => {
      expect(
        splitIntoBubbles(
          "Tudo certo por aqui 😊\n\nPosso ajudar em mais alguma coisa?",
          100,
          optIn,
        ),
      ).toEqual(["Tudo certo por aqui 😊", "Posso ajudar em mais alguma coisa?"]);
    });

    it("mantém parágrafo único curto em uma bolha", () => {
      expect(splitIntoBubbles("Como posso ajudar?", 100, optIn)).toEqual(["Como posso ajudar?"]);
    });

    it("transforma cinco parágrafos em cinco bolhas, sem vazias", () => {
      const paragrafos = ["Um.", "Dois.", "Três.", "Quatro.", "Cinco."];
      expect(splitIntoBubbles(paragrafos.join("\n\n"), 100, optIn)).toEqual(paragrafos);
    });

    it("preserva palavra atômica enorme sem criar bolha vazia", () => {
      const atomica = "x".repeat(80);
      const out = splitIntoBubbles(`${atomica} depois`, 20, optIn);
      expect(out).toEqual([atomica, "depois"]);
      expect(out).not.toContain("");
    });
  });
});
