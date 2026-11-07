import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS, type PacingKnobs } from "@/lib/agent-engine/pacing/defaults";
import {
  janelaDeEnvioAberta,
  proximaAberturaDaJanela,
} from "@/lib/agent-engine/pacing/engine";

const KNOBS: PacingKnobs = {
  ...PACING_DEFAULTS,
  windowStartHour: 9,
  windowEndHour: 19,
  windowSaturdayEndHour: 14,
  allowSunday: false,
  timezone: "America/Sao_Paulo",
  jitterMaxMs: 0,
};

const data = (iso: string) => new Date(iso);
const aberta = (iso: string, knobs: PacingKnobs = KNOBS) =>
  janelaDeEnvioAberta(data(iso), knobs);
const proxima = (iso: string, knobs: PacingKnobs = KNOBS) =>
  proximaAberturaDaJanela(data(iso), knobs, () => 0).toISOString();

describe("janela com fim diferente no sábado", () => {
  it("sexta fecha às 19h e reabre sábado às 9h", () => {
    expect(aberta("2026-11-06T21:59:00.000Z")).toBe(true); // 18h59 BRT
    expect(aberta("2026-11-06T22:00:00.000Z")).toBe(false); // 19h BRT
    expect(proxima("2026-11-06T22:00:00.000Z")).toBe("2026-11-07T12:00:00.000Z");
  });

  it("sábado fecha às 14h e pula o domingo desligado", () => {
    expect(aberta("2026-11-07T16:59:00.000Z")).toBe(true); // 13h59 BRT
    expect(aberta("2026-11-07T17:00:00.000Z")).toBe(false); // 14h BRT
    expect(proxima("2026-11-07T17:00:00.000Z")).toBe("2026-11-09T12:00:00.000Z");
  });

  it("sábado antes da abertura reabre no próprio sábado", () => {
    expect(aberta("2026-11-07T11:59:00.000Z")).toBe(false); // 8h59 BRT
    expect(proxima("2026-11-07T11:59:00.000Z")).toBe("2026-11-07T12:00:00.000Z");
  });

  it("domingo permanece fechado e reabre segunda", () => {
    expect(aberta("2026-11-08T15:00:00.000Z")).toBe(false); // 12h BRT
    expect(proxima("2026-11-08T15:00:00.000Z")).toBe("2026-11-09T12:00:00.000Z");
  });

  it("fim de sábado nulo herda o fim normal", () => {
    const knobs = { ...KNOBS, windowSaturdayEndHour: null };
    expect(aberta("2026-11-07T21:59:00.000Z", knobs)).toBe(true); // 18h59 BRT
    expect(aberta("2026-11-07T22:00:00.000Z", knobs)).toBe(false); // 19h BRT
  });

  it("fim de sábado menor ou igual à abertura fecha o dia sem laço infinito", () => {
    for (const endHour of [8, 9]) {
      const knobs = { ...KNOBS, windowSaturdayEndHour: endHour };
      expect(aberta("2026-11-07T15:00:00.000Z", knobs)).toBe(false);
      expect(proxima("2026-11-07T15:00:00.000Z", knobs)).toBe(
        "2026-11-09T12:00:00.000Z",
      );
    }
  });

  it("atravessa a virada de horário de verão usando o fuso da janela", () => {
    const novaYork = { ...KNOBS, timezone: "America/New_York" };
    // Sábado 14h EST. O domingo salta de EST para EDT; segunda 9h já é 13h UTC.
    expect(proxima("2026-03-07T19:00:00.000Z", novaYork)).toBe(
      "2026-03-09T13:00:00.000Z",
    );
  });
});
