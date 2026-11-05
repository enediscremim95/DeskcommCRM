import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  filtrarMensagemDoTurno,
  normalizarMensagemDoTurno,
  registrarMensagemEnviadaNoTurno,
  resultadoDeEnvioSemRepeticao,
} from "./dedupe-mensagem-turno";

describe("dedupe de mensagem no mesmo turno", () => {
  it.each([
    ["  Olá   tudo bem? 🥰  ", "olá tudo bem?"],
    ["OLÁ TUDO BEM? 😊", "olá tudo bem?"],
    ["Oi 👨‍👩‍👧‍👦", "oi"],
  ])("normaliza %j", (entrada, esperado) => {
    expect(normalizarMensagemDoTurno(entrada)).toBe(esperado);
  });

  it("remove os parágrafos repetidos e preserva ordem e pontuação dos novos", () => {
    const enviadas = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno(
      "Primeiro parágrafo.\n\nSegundo parágrafo! 🥰",
      enviadas,
    );

    const filtrada = filtrarMensagemDoTurno({
      body: "Segundo parágrafo! 😊\n\nTerceiro, novo?\n\nPrimeiro parágrafo.",
      enviadas,
      log,
    });

    expect(filtrada).toEqual({
      status: "pronta",
      body: "Terceiro, novo?",
      paragrafos_recebidos: 3,
      paragrafos_enviados: 1,
      paragrafos_repetidos_removidos: 2,
    });
    expect(resultadoDeEnvioSemRepeticao(filtrada)).toEqual({
      ok: true,
      status: "enviado_sem_repeticao",
      paragrafos_repetidos_removidos: 2,
    });
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith("parágrafos repetidos no mesmo turno não enviados", {
      paragrafos_recebidos: 3,
      paragrafos_enviados: 1,
      paragrafos_repetidos_removidos: 2,
    });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("Primeiro parágrafo");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("Segundo parágrafo");
  });

  it("cobre o caso real da Sublimando em que a segunda chamada repete dois parágrafos", () => {
    const enviadas = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno(
      "Ótima tarde, Renata! Sou a Lorenza da Sublimando! Como vai? 🌷\n\n" +
        "Parabéns pelo primeiro aninho da sua princesa 💗\n\n" +
        "Fazemos sim as lembrancinhas de festa infantil",
      enviadas,
    );

    expect(
      filtrarMensagemDoTurno({
        body:
          "Ótima tarde, Renata! Sou a Lorenza da Sublimando! Como vai? 🌷\n\n" +
          "Parabéns pelo primeiro aninho da sua princesa 💗",
        enviadas,
        log,
      }),
    ).toEqual({
      status: "duplicate_skipped",
      ok: true,
      paragrafos_recebidos: 2,
      paragrafos_enviados: 0,
      paragrafos_repetidos_removidos: 2,
    });
  });

  it("cobre o caso real quase igual sem inventar dedupe fuzzy dentro do parágrafo", () => {
    const enviadas = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno("Joia, anotei o tema ursinha rosa", enviadas);

    expect(
      filtrarMensagemDoTurno({
        body:
          "Joia, anotei o tema ursinha rosa, Renata 🌷\n\n" +
          "Dos modelos que te mandei, algum chamou mais sua atenção?",
        enviadas,
        log,
      }),
    ).toEqual({
      status: "pronta",
      body:
        "Joia, anotei o tema ursinha rosa, Renata 🌷\n\n" +
        "Dos modelos que te mandei, algum chamou mais sua atenção?",
      paragrafos_recebidos: 2,
      paragrafos_enviados: 2,
      paragrafos_repetidos_removidos: 0,
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("pula corpo idêntico, todos repetidos e texto de um único parágrafo", () => {
    const enviadas = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno("Olá, posso ajudar? 🥰", enviadas);

    expect(
      filtrarMensagemDoTurno({ body: "  OLÁ,   posso ajudar? 😊", enviadas, log }),
    ).toEqual({
      status: "duplicate_skipped",
      ok: true,
      paragrafos_recebidos: 1,
      paragrafos_enviados: 0,
      paragrafos_repetidos_removidos: 1,
    });
  });

  it("remove a segunda ocorrência normalizada dentro do mesmo corpo", () => {
    const log = { warn: vi.fn() };
    expect(
      filtrarMensagemDoTurno({
        body: "Parágrafo novo.\n\nPARÁGRAFO   NOVO. 😊",
        enviadas: new Set(),
        log,
      }),
    ).toEqual({
      status: "pronta",
      body: "Parágrafo novo.",
      paragrafos_recebidos: 2,
      paragrafos_enviados: 1,
      paragrafos_repetidos_removidos: 1,
    });
  });

  it("não vaza estado entre turnos diferentes", () => {
    const turnoA = new Set<string>();
    const turnoB = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno("Oi!", turnoA);

    expect(filtrarMensagemDoTurno({ body: "Oi! 😊", enviadas: turnoA, log }).status).toBe(
      "duplicate_skipped",
    );
    expect(filtrarMensagemDoTurno({ body: "Oi! 😊", enviadas: turnoB, log })).toMatchObject({
      status: "pronta",
      body: "Oi! 😊",
      paragrafos_repetidos_removidos: 0,
    });
  });

  it("o turno real e o sandbox chamam o mesmo helper antes do teto físico", () => {
    const real = fs.readFileSync(
      path.join(process.cwd(), "lib", "agent-engine", "agent", "inbound-turn.ts"),
      "utf8",
    );
    const sandbox = fs.readFileSync(
      path.join(process.cwd(), "lib", "agent-engine", "agent", "preview.ts"),
      "utf8",
    );
    const inicio = real.indexOf("send_message: tool({");
    const fim = real.indexOf("update_lead_state: tool({", inicio);
    const ramo = real.slice(inicio, fim);
    expect(ramo.indexOf("filtrarMensagemDoTurno")).toBeGreaterThan(0);
    expect(ramo.indexOf("filtrarMensagemDoTurno")).toBeLessThan(
      ramo.indexOf("seq >= maxSendsPerTurn"),
    );
    expect(ramo).toContain("registrarMensagemEnviadaNoTurno");
    expect(sandbox).toContain("filtrarMensagemDoTurno");
  });
});
