import { describe, expect, it } from "vitest";

import {
  JANELA_REENVIO_PADRAO_MINUTOS,
  minutosDaJanelaDeReenvio,
  reutilizaLeadAbertoNaReentrada,
} from "./janela-de-reenvio-config";

describe("configuração da janela de reenvio", () => {
  it("usa 60 minutos quando a organização ainda não escolheu", () => {
    expect(minutosDaJanelaDeReenvio({})).toBe(JANELA_REENVIO_PADRAO_MINUTOS);
  });

  it("respeita o knob da organização e limita valores legados fora da faixa", () => {
    expect(minutosDaJanelaDeReenvio({ lead_reentry_window_minutes: 17 })).toBe(17);
    expect(minutosDaJanelaDeReenvio({ lead_reentry_window_minutes: 0 })).toBe(1);
    expect(minutosDaJanelaDeReenvio({ lead_reentry_window_minutes: 999_999 })).toBe(10_080);
  });

  it("degrada configuração inválida para o padrão", () => {
    expect(minutosDaJanelaDeReenvio({ lead_reentry_window_minutes: "qualquer" })).toBe(60);
  });
});

describe("reutilização do lead aberto na reentrada", () => {
  it("vem ligada quando a configuração está ausente", () => {
    expect(reutilizaLeadAbertoNaReentrada(undefined)).toBe(true);
    expect(reutilizaLeadAbertoNaReentrada({})).toBe(true);
  });

  it("só desliga com false booleano explícito", () => {
    expect(reutilizaLeadAbertoNaReentrada({ lead_reentry_reuse_open: false })).toBe(false);
    expect(reutilizaLeadAbertoNaReentrada({ lead_reentry_reuse_open: true })).toBe(true);
    expect(reutilizaLeadAbertoNaReentrada({ lead_reentry_reuse_open: "false" })).toBe(true);
  });
});
