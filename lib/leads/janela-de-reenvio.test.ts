import { describe, expect, it } from "vitest";

import {
  CHAVE_REENVIO_CANAL_INBOUND,
  chaveDaJanelaDaFonte,
} from "./janela-de-reenvio";

describe("escopo da janela curta de reenvio", () => {
  it("fonte existente mantém um card por evento por padrão", () => {
    expect(chaveDaJanelaDaFonte("fonte-1", false)).toBeNull();
  });

  it("fonte marcada recebe uma chave própria e não compartilha a trava com outra", () => {
    expect(chaveDaJanelaDaFonte("fonte-1", true)).toBe("fonte:fonte-1");
    expect(chaveDaJanelaDaFonte("fonte-2", true)).toBe("fonte:fonte-2");
  });

  it("canal inbound permanece protegido sem depender de fonte de webhook", () => {
    expect(CHAVE_REENVIO_CANAL_INBOUND).toBe("canal:inbound");
  });
});
