import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  filtrarMensagemDoTurno,
  LIMIAR_SEMELHANCA_PARAGRAFO,
  normalizarMensagemDoTurno,
  paragrafosSaoSemelhantesNoTurno,
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

  it("remove a paráfrase curta e preserva a pergunta realmente nova", () => {
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
      body: "Dos modelos que te mandei, algum chamou mais sua atenção?",
      paragrafos_recebidos: 2,
      paragrafos_enviados: 1,
      paragrafos_repetidos_removidos: 1,
      motivo: "parecidos",
    });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("remove a paráfrase do turno A sem tocar nos valores", () => {
    const enviadas = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno(
      [
        "Entendi, então é o kit Casal, com um conjunto para a madrinha e outro para o padrinho 🫶",
        "Na versão Casal, o Kit Afeto fica assim:",
        "Caixa kraft: R$ 209,90",
        "Caixa pinus com tampa acrílica: R$ 249,90",
        "Qual caixa combina mais com o seu convite, kraft ou pinus?",
      ].join("\n\n"),
      enviadas,
    );

    expect(
      filtrarMensagemDoTurno({
        body: "Entendi, então é o Kit Afeto na versão Casal, com um conjunto para a madrinha e outro para o padrinho 🫶",
        enviadas,
        log,
      }),
    ).toMatchObject({
      status: "duplicate_skipped",
      paragrafos_repetidos_removidos: 1,
      motivo: "parecidos",
    });
    expect([...enviadas]).toContain("caixa kraft: r$ 209,90");
    expect([...enviadas]).toContain("caixa pinus com tampa acrílica: r$ 249,90");
  });

  it("remove as três paráfrases do turno B", () => {
    const enviadas = new Set<string>();
    const log = { warn: vi.fn() };
    registrarMensagemEnviadaNoTurno(
      [
        "A kraft é a caixa de papel kraft, mais rústica e natural 🌷",
        "A pinus é de madeira, com tampa de acrílico transparente, para ver o conteúdo.",
        "O que vem dentro é igual nas duas: xícaras, pires, porta-retrato, urso chaveiro, cartão, tag, fita e ramo floral.",
        "A diferença de valor é só a caixa: R$ 209,90 na kraft e R$ 249,90 na pinus.",
        "Qual delas combina mais com o seu convite, por gentileza?",
      ].join("\n\n"),
      enviadas,
    );

    expect(
      filtrarMensagemDoTurno({
        body: [
          "A kraft é a caixa de papel kraft, mais simples e natural 🌷",
          "A pinus é de madeira, com tampa de acrílico transparente para ver o que tem dentro.",
          "O conteúdo é igual nas duas: xícaras, pires, porta-retrato, urso chaveiro, cartão, tag, fita e ramo floral.",
        ].join("\n\n"),
        enviadas,
        log,
      }),
    ).toEqual({
      status: "duplicate_skipped",
      ok: true,
      paragrafos_recebidos: 3,
      paragrafos_enviados: 0,
      paragrafos_repetidos_removidos: 3,
      motivo: "parecidos",
    });
  });

  it("preserva valores, variantes distintivas e perguntas com fato diferente", () => {
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "Caixa kraft: R$ 209,90",
        "Caixa pinus com tampa acrílica: R$ 249,90",
      ),
    ).toBe(false);
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "A caixa kraft tem tampa transparente e acabamento bonito.",
        "A caixa pinus tem tampa transparente e acabamento bonito.",
      ),
    ).toBe(false);
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "Qual caixa você prefere, kraft ou pinus?",
        "Para o batizado do dia 20 de dezembro, qual delas combina mais?",
      ),
    ).toBe(false);
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "A caneca Alice tem acabamento fosco e tampa transparente.",
        "A caneca Bruna tem acabamento fosco e tampa transparente.",
      ),
    ).toBe(false);
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "A caixa kraft tem tampa transparente e acabamento natural.",
        "A caixa kraft não tem tampa transparente e acabamento natural.",
      ),
    ).toBe(false);
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "O kit vem com laço floral e cartão personalizado.",
        "O kit vem sem laço floral e cartão personalizado.",
      ),
    ).toBe(false);
  });

  it("trava a borda nomeada do limiar e não aproxima parágrafo curto", () => {
    expect(LIMIAR_SEMELHANCA_PARAGRAFO).toBe(0.7);
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "alfa beta gama delta epsilon zeta eta teta iota capa",
        "alfa beta gama delta epsilon zeta eta lambda mu nu",
      ),
    ).toBe(true);
    expect(
      paragrafosSaoSemelhantesNoTurno(
        "alfa beta gama delta epsilon zeta eta teta iota capa",
        "alfa beta gama delta epsilon zeta lambda mu nu xi",
      ),
    ).toBe(false);
    expect(paragrafosSaoSemelhantesNoTurno("kraft natural bonita", "kraft simples bonita")).toBe(false);
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

  it("turno real, sandbox e texto fixo da vitrine chamam o mesmo helper antes do teto físico", () => {
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
    const inicioVitrine = real.indexOf('rawTools.crm_send_vitrine = tool({');
    const fimVitrine = real.indexOf('const followupKnobs', inicioVitrine);
    const ramoVitrine = real.slice(inicioVitrine, fimVitrine);
    expect(ramo.indexOf("filtrarMensagemDoTurno")).toBeGreaterThan(0);
    expect(ramo.indexOf("filtrarMensagemDoTurno")).toBeLessThan(
      ramo.indexOf("seq >= maxSendsPerTurn"),
    );
    expect(ramo).toContain("registrarMensagemEnviadaNoTurno");
    expect(sandbox).toContain("filtrarMensagemDoTurno");
    expect(ramoVitrine).toContain("filtrarMensagemDoTurno");
    expect(ramoVitrine).toContain("registrarMensagemEnviadaNoTurno");
    expect(real.match(/filtrarMensagemDoTurno\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
