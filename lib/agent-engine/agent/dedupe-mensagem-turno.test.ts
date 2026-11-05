import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  normalizarMensagemDoTurno,
  pularMensagemDuplicada,
  registrarMensagemEnviadaNoTurno,
} from "./dedupe-mensagem-turno";

describe("dedupe de mensagem no mesmo turno", () => {
  it.each([
    ["  Olá   tudo bem? 🥰  ", "olá tudo bem?"],
    ["OLÁ TUDO BEM? 😊", "olá tudo bem?"],
    ["Oi 👨‍👩‍👧‍👦", "oi"],
  ])("normaliza %j", (entrada, esperado) => {
    expect(normalizarMensagemDoTurno(entrada)).toBe(esperado);
  });

  it("pula somente a duplicata exata normalizada e registra warn sem texto do cliente", () => {
    const enviadas = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno("Olá, posso ajudar? 🥰", enviadas);

    expect(
      pularMensagemDuplicada({ body: "  OLÁ,   posso ajudar? 😊", enviadas, log }),
    ).toEqual({ ok: true, status: "duplicate_skipped" });
    expect(pularMensagemDuplicada({ body: "Olá, em que posso ajudar?", enviadas, log })).toBeNull();
    expect(log.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("Olá");
  });

  it("o turno real verifica a duplicata antes do teto físico", () => {
    const fonte = fs.readFileSync(
      path.join(process.cwd(), "lib", "agent-engine", "agent", "inbound-turn.ts"),
      "utf8",
    );
    const inicio = fonte.indexOf("send_message: tool({");
    const fim = fonte.indexOf("update_lead_state: tool({", inicio);
    const ramo = fonte.slice(inicio, fim);
    expect(ramo.indexOf("pularMensagemDuplicada")).toBeGreaterThan(0);
    expect(ramo.indexOf("pularMensagemDuplicada")).toBeLessThan(
      ramo.indexOf("seq >= maxSendsPerTurn"),
    );
    expect(ramo).toContain("registrarMensagemEnviadaNoTurno");
  });
});
