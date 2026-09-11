import { describe, expect, it } from "vitest";
import { diagnosticarSilencioInbound } from "./inbound-silence";

const agora = new Date("2026-09-11T15:00:00.000Z");
const mensagens = Array.from({ length: 15 }, (_, i) => new Date(agora.getTime() - (14 - i) * 5 * 60_000).toISOString());

describe("diagnosticarSilencioInbound", () => {
  it("não julga número de baixo volume", () => {
    expect(diagnosticarSilencioInbound(mensagens.slice(0, 11), agora)).toEqual({ deveAvisar: false, limiarMs: null, amostra: 11 });
  });
  it("avisa quando o silêncio excede a cadência observada", () => {
    const dados = Array.from({ length: 12 }, (_, i) => new Date(agora.getTime() - (125 - i * 5) * 60_000).toISOString());
    expect(diagnosticarSilencioInbound(dados, agora)).toMatchObject({ deveAvisar: true, limiarMs: 45 * 60_000 });
  });
  it("não avisa dentro da cadência", () => expect(diagnosticarSilencioInbound(mensagens, agora).deveAvisar).toBe(false));
});
