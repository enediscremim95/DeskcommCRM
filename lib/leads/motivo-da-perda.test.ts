import { describe, expect, it } from "vitest";

import { entradaDePerda, motivoDaPerdaLegivel } from "./motivo-da-perda";

describe("motivo da perda", () => {
  it("mantém other como categoria e envia o texto no campo próprio", () => {
    expect(entradaDePerda("other", "  Cliente mudou de cidade  ")).toEqual({
      lost_reason: "other",
      lost_reason_detail: "Cliente mudou de cidade",
    });
  });

  it("salva outro motivo sem detalhe", () => {
    expect(entradaDePerda("other", "   ")).toEqual({
      lost_reason: "other",
      lost_reason_detail: null,
    });
  });

  it("salva motivo da lista e descarta detalhe antigo do campo Outro", () => {
    expect(entradaDePerda("price", "texto que ficou no formulário")).toEqual({
      lost_reason: "price",
      lost_reason_detail: null,
    });
  });

  it("mostra o detalhe junto do motivo e preserva motivos livres já salvos", () => {
    const t = (texto: string) => texto;
    expect(motivoDaPerdaLegivel("other", "Cliente pausou o projeto", t)).toBe(
      "Outro motivo: Cliente pausou o projeto",
    );
    expect(motivoDaPerdaLegivel("Motivo cadastrado hoje", null, t)).toBe(
      "Motivo cadastrado hoje",
    );
  });
});
