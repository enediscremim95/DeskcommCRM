import { describe, expect, it } from "vitest";

import { montarEmbalagemUnica, type ItemComEmbalagem } from "./montar-embalagem";

const item = (overrides: Partial<ItemComEmbalagem> = {}): ItemComEmbalagem => ({
  codigo: "KIT-A",
  quantidade: 1,
  preco_cents: 10_000,
  peso_kg: 2,
  altura_cm: 10,
  largura_cm: 20,
  comprimento_cm: 30,
  embalagem_estimada: false,
  ...overrides,
});

describe("montagem da embalagem única", () => {
  it("soma peso e alturas por caixa, conserva maior largura e comprimento", () => {
    expect(
      montarEmbalagemUnica([
        item({ quantidade: 2 }),
        item({
          codigo: "KIT-B",
          peso_kg: 1.5,
          altura_cm: 5,
          largura_cm: 25,
          comprimento_cm: 28,
        }),
      ]),
    ).toMatchObject({
      weight: 5.5,
      height: 25,
      width: 25,
      length: 30,
      subtotal_cents: 30_000,
      precisa_pessoa: false,
    });
  });

  it("propaga embalagem estimada se qualquer item ainda for estimado", () => {
    expect(
      montarEmbalagemUnica([item(), item({ embalagem_estimada: true })]).embalagem_estimada,
    ).toBe(true);
  });

  it("manda para uma pessoa acima de 30 kg ou de 200 cm somados", () => {
    expect(montarEmbalagemUnica([item({ peso_kg: 30.001 })]).precisa_pessoa).toBe(true);
    expect(
      montarEmbalagemUnica([item({ altura_cm: 151, largura_cm: 20, comprimento_cm: 30 })])
        .precisa_pessoa,
    ).toBe(true);
    expect(montarEmbalagemUnica([item({ peso_kg: 30, altura_cm: 150 })]).precisa_pessoa).toBe(
      false,
    );
  });
});
