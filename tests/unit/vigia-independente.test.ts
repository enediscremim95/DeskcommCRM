import { describe, expect, it } from "vitest";

import {
  ALERTA_MIDIA_BYTES_PADRAO,
  avaliarOcupacaoDeMidia,
  avaliarSaude,
  heartbeatDaVigiaExpirou,
  LIMITE_MIDIA_BYTES_PADRAO,
  LEMBRETE_INCIDENTE_MS,
  observacaoDoHealth,
} from "@/lib/channels/vigia-independente.mjs";

const T0 = Date.parse("2026-09-29T17:00:00.000Z");
const saudavel = {
  caiu: false,
  componentes: {
    app: { status: "ok" as const },
    supabase: { status: "ok" as const },
    redis: { status: "ok" as const },
    waha: { status: "ok" as const },
  },
};
const bancoFora = {
  caiu: true,
  componentes: {
    app: { status: "ok" as const },
    supabase: { status: "down" as const, reason: "tempo_esgotado" },
    redis: { status: "ok" as const },
    waha: { status: "ok" as const },
  },
};

describe("vigia independente", () => {
  it("um soluço isolado não avisa e a terceira falha avisa UMA vez", () => {
    let estado = {};
    let rodada = avaliarSaude(estado, bancoFora, T0);
    expect(rodada.eventos).toEqual([]);
    estado = rodada.estado;

    rodada = avaliarSaude(estado, bancoFora, T0 + 60_000);
    expect(rodada.eventos).toEqual([]);
    estado = rodada.estado;

    rodada = avaliarSaude(estado, bancoFora, T0 + 120_000);
    expect(rodada.eventos.map((e) => e.tipo)).toEqual(["caiu"]);
    estado = rodada.estado;

    rodada = avaliarSaude(estado, bancoFora, T0 + 180_000);
    expect(rodada.eventos).toEqual([]);
  });

  it("avisa UMA vez na volta, só depois de duas respostas saudáveis", () => {
    let estado = avaliarSaude({}, bancoFora, T0).estado;
    estado = avaliarSaude(estado, bancoFora, T0 + 60_000).estado;
    estado = avaliarSaude(estado, bancoFora, T0 + 120_000).estado;

    let rodada = avaliarSaude(estado, saudavel, T0 + 180_000);
    expect(rodada.eventos).toEqual([]);
    rodada = avaliarSaude(rodada.estado, saudavel, T0 + 240_000);
    expect(rodada.eventos.map((e) => e.tipo)).toEqual(["voltou"]);
    rodada = avaliarSaude(rodada.estado, saudavel, T0 + 300_000);
    expect(rodada.eventos).toEqual([]);
  });

  it("queda longa lembra a cada 6 horas, não a cada checagem", () => {
    let estado = avaliarSaude({}, bancoFora, T0).estado;
    estado = avaliarSaude(estado, bancoFora, T0 + 60_000).estado;
    estado = avaliarSaude(estado, bancoFora, T0 + 120_000).estado;

    expect(avaliarSaude(estado, bancoFora, T0 + LEMBRETE_INCIDENTE_MS - 1).eventos).toEqual([]);
    const rodada = avaliarSaude(estado, bancoFora, T0 + 120_000 + LEMBRETE_INCIDENTE_MS);
    expect(rodada.eventos.map((e) => e.tipo)).toEqual(["continua_fora"]);
  });

  it("timeout de 3 s do health não vira queda quando o Supabase responde à sonda direta", () => {
    const payload = {
      data: {
        checks: {
          supabase: { status: "down", reason: "tempo_esgotado" },
          redis: { status: "ok" },
          waha: { status: "ok" },
        },
      },
    };
    const observacao = observacaoDoHealth(payload, true, true);
    expect(observacao.caiu).toBe(false);
    expect(observacao.componentes.supabase).toMatchObject({
      status: "degraded",
      reason: "health_3s_excedido_mas_consulta_direta_respondeu",
    });
  });

  it("avisa ao cruzar ocupação e não repete enquanto permanece na mesma faixa", () => {
    const primeiro = avaliarOcupacaoDeMidia("normal", ALERTA_MIDIA_BYTES_PADRAO);
    expect(primeiro.evento?.tipo).toBe("midia_em_alerta");
    expect(avaliarOcupacaoDeMidia(primeiro.nivel, ALERTA_MIDIA_BYTES_PADRAO + 1).evento).toBeNull();
    expect(
      avaliarOcupacaoDeMidia(primeiro.nivel, LIMITE_MIDIA_BYTES_PADRAO).evento?.tipo,
    ).toBe("midia_no_limite");
  });

  it("o watchdog dá cinco minutos de partida antes de declarar que a vigia morreu", () => {
    const inicio = Date.parse("2026-09-29T14:00:00.000Z");

    expect(
      heartbeatDaVigiaExpirou(null, new Date(inicio).toISOString(), inicio + 4 * 60 * 1000),
    ).toBe(false);
    expect(
      heartbeatDaVigiaExpirou(null, new Date(inicio).toISOString(), inicio + 6 * 60 * 1000),
    ).toBe(true);
    expect(
      heartbeatDaVigiaExpirou(
        new Date(inicio + 5 * 60 * 1000).toISOString(),
        new Date(inicio).toISOString(),
        inicio + 6 * 60 * 1000,
      ),
    ).toBe(false);
  });
});
