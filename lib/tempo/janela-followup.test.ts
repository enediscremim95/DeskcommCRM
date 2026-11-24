import { describe, expect, it } from "vitest";
import { alinharJanela, lerJanelaDoFluxo, sendWindowSchema, somarHorasUteis } from "./janela-followup";

const janela = sendWindowSchema.parse({
  timezone: "America/Sao_Paulo", start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5, 6],
});

describe("janela do fluxo", () => {
  it.each([
    ["2026-11-29T15:00:00Z", "2026-11-30T12:00:00Z"], // domingo
    ["2026-11-28T21:00:00Z", "2026-11-30T12:00:00Z"], // sábado, fechamento
    ["2026-11-27T22:00:00Z", "2026-11-28T12:00:00Z"], // sexta, após o fechamento
    ["2026-11-27T19:01:02Z", "2026-11-27T19:01:02Z"], // aberto
    ["2026-11-28T11:59:57Z", "2026-11-28T12:00:00Z"], // antes de abrir
  ])("alinha %s a %s", (agora, esperado) => {
    expect(alinharJanela(janela, new Date(agora))).toEqual(new Date(esperado));
  });

  it("conta duas horas na sexta e uma no sábado", () => {
    const sexta16h = new Date("2026-11-27T19:00:00Z");
    expect(somarHorasUteis(janela, sexta16h, 3)).toEqual(new Date("2026-11-28T13:00:00Z"));
    expect(somarHorasUteis(janela, sexta16h, 2)).toEqual(new Date("2026-11-28T12:00:00Z"));
  });

  it("mantém o instante sem janela e usa horas corridas se ela foi retirada", () => {
    const domingo = new Date("2026-11-29T15:00:00Z");
    const semJanela = lerJanelaDoFluxo({ kind: "manual" });
    expect(alinharJanela(semJanela, domingo)).toBe(domingo);
    expect(somarHorasUteis(semJanela, domingo, 3)).toEqual(new Date("2026-11-29T18:00:00Z"));
  });

  it.each([
    { timezone: "Fuso/Inexistente" },
    { start: "18:00" },
    { weekdays: [] },
    { weekdays: [1, 1] },
  ])("recusa janela inválida (%j)", (patch) => {
    expect(sendWindowSchema.safeParse({ ...janela, ...patch }).success).toBe(false);
  });
});

it("conta o tempo real na transição de horário de verão", () => {
  const ny = sendWindowSchema.parse({
    timezone: "America/New_York", start: "01:30", end: "03:30", weekdays: [0, 1],
  });
  const domingo0130 = new Date("2026-03-08T06:30:00Z");
  expect(somarHorasUteis(ny, domingo0130, 1)).toEqual(new Date("2026-03-09T05:30:00Z"));
  expect(alinharJanela({ ...ny, end: "01:45" }, new Date("2026-11-01T05:50:00Z")))
    .toEqual(new Date("2026-11-01T06:30:00Z"));
});
