import { describe, expect, it } from "vitest";

import {
  ehAssistenteDeRespostaGerenciado,
  escolherModeloDoAssistente,
  montarPromptDoAssistente,
  nomeSeguroParaSugestao,
  patchSeguroDoAgenteInterno,
  pedidoDoAssistenteSchema,
  lerConfiguracaoDoAssistente,
} from "./config";

describe("configuração do assistente de resposta", () => {
  it("reconhece somente o agente interno marcado", () => {
    expect(
      ehAssistenteDeRespostaGerenciado({ reply_assistant: { managed: true } }),
    ).toBe(true);
    expect(ehAssistenteDeRespostaGerenciado({ reply_assistant: { managed: false } })).toBe(
      false,
    );
    expect(ehAssistenteDeRespostaGerenciado({})).toBe(false);
  });

  it("aceita desligar sem exigir chave e exige a configuração completa ao ligar", () => {
    expect(pedidoDoAssistenteSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(pedidoDoAssistenteSchema.safeParse({ enabled: true }).success).toBe(false);
  });

  it("liga a sugestão automática por padrão em configuração anterior", () => {
    expect(
      lerConfiguracaoDoAssistente({
        reply_assistant: {
          managed: true,
          enabled: true,
          provider: "anthropic",
          model: "modelo",
          credential_id: "11000000-0000-4000-8000-000000000001",
          team_style: "Fale de forma curta e cordial.",
          history_message_window: 20,
          history_token_window: 4_000,
          hourly_limit: 20,
          daily_limit: 100,
        },
      })?.auto_suggest,
    ).toBe(true);
  });

  it("limita histórico, contexto e cotas", () => {
    const base = {
      enabled: true,
      provider: "anthropic",
      credential_id: "11000000-0000-4000-8000-000000000001",
      team_style: "Fale de forma curta e cordial.",
      history_message_window: 20,
      history_token_window: 4_000,
      hourly_limit: 20,
      daily_limit: 100,
    };
    expect(pedidoDoAssistenteSchema.safeParse(base).success).toBe(true);
    expect(
      pedidoDoAssistenteSchema.safeParse({ ...base, history_message_window: 201 }).success,
    ).toBe(false);
    expect(pedidoDoAssistenteSchema.safeParse({ ...base, daily_limit: 20_000 }).success).toBe(
      false,
    );
  });

  it("monta um prompt que só sugere e não inventa condição comercial", () => {
    const prompt = montarPromptDoAssistente("Use frases curtas e chame a pessoa pelo primeiro nome.");
    expect(prompt).toContain("Nunca envie mensagens");
    expect(prompt).toContain("Não invente preço, prazo, frete, estoque");
    expect(prompt).toContain("Use frases curtas");
  });

  it("escolhe o modelo padrão somente quando a chave o oferece", () => {
    const catalogo = [
      { model_id: "modelo-caro", is_default_for_provider: false },
      { model_id: "modelo-padrao", is_default_for_provider: true },
    ];
    expect(escolherModeloDoAssistente(catalogo, ["modelo-caro"])).toBe("modelo-caro");
    expect(escolherModeloDoAssistente(catalogo, ["modelo-padrao", "modelo-caro"])).toBe(
      "modelo-padrao",
    );
    expect(escolherModeloDoAssistente(catalogo, ["outro"])).toBeNull();
  });
});

describe("nome seguro no contexto", () => {
  it.each([
    ["Ana Souza", "Ana Souza"],
    ["  João   da Silva ", "João da Silva"],
    ["5541999999999", null],
    ["1 Box Premium com entrega", null],
    ["Box Premium", null],
    ["Pedido Urgente", null],
    ["Pedido de duas camisetas tamanho M", null],
    ["cliente@example.com", null],
  ])("%s vira %s", (input, expected) => {
    expect(nomeSeguroParaSugestao(input)).toBe(expected);
  });
});

describe("trava de não-envio", () => {
  it("o agente interno nasce assistido, pausado e fora da prioridade operacional", () => {
    const patch = patchSeguroDoAgenteInterno("2026-10-29T12:00:00.000Z");
    expect(patch).toEqual({
      operation_mode: "assisted",
      paused_at: "2026-10-29T12:00:00.000Z",
      is_active: false,
      priority: -1_000_000,
    });
  });
});
