import { describe, expect, it } from "vitest";

import {
  JANELA_REENVIO_PADRAO_MINUTOS,
  minutosDaJanelaDeReenvio,
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
