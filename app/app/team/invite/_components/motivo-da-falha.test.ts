import { describe, expect, it } from "vitest";
import { descreverMotivoDaFalha } from "./motivo-da-falha";

describe("descreverMotivoDaFalha", () => {
  it("already_member vira frase, não código cru", () => {
    expect(descreverMotivoDaFalha("already_member")).toBe(
      "Essa pessoa já entrou; use Esqueci a senha.",
    );
  });

  it("código desconhecido não some: devolve o próprio código", () => {
    expect(descreverMotivoDaFalha("um_codigo_futuro")).toBe("um_codigo_futuro");
  });
});
