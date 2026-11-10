import { describe, expect, it } from "vitest";

import {
  CHAVE_REENVIO_CANAL_INBOUND,
  chaveDaJanelaDaFonte,
  escolherNegocioAberto,
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

describe("escolha do negócio aberto que recebe a entrada", () => {
  it("não escolhe quando não há candidato", () => {
    expect(escolherNegocioAberto([])).toBeNull();
  });

  it("prefere o mais recentemente ativo, mesmo que seja o mais antigo", () => {
    expect(
      escolherNegocioAberto([
        {
          id: "formulario",
          last_activity_at: "2026-11-09T18:00:00.000Z",
          created_at: "2026-11-09T12:00:00.000Z",
        },
        {
          id: "whatsapp",
          last_activity_at: "2026-11-09T15:00:00.000Z",
          created_at: "2026-11-09T15:00:00.000Z",
        },
      ]),
    ).toBe("formulario");
  });

  it("no empate de atividade, fica com o criado por último", () => {
    expect(
      escolherNegocioAberto([
        { id: "primeiro", last_activity_at: null, created_at: "2026-11-09T12:00:00.000Z" },
        { id: "segundo", last_activity_at: null, created_at: "2026-11-09T15:00:00.000Z" },
      ]),
    ).toBe("segundo");
  });

  it("aceita data vinda do driver e desempatado pelo id", () => {
    expect(
      escolherNegocioAberto([
        {
          id: "aaa",
          last_activity_at: new Date("2026-11-09T12:00:00.000Z"),
          created_at: new Date("2026-11-09T12:00:00.000Z"),
        },
        {
          id: "bbb",
          last_activity_at: new Date("2026-11-09T12:00:00.000Z"),
          created_at: new Date("2026-11-09T12:00:00.000Z"),
        },
      ]),
    ).toBe("bbb");
  });
});
