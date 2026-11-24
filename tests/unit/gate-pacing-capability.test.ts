/**
 * Task 5 do seam de canais — a capability do canal desarma o anti-ban, e a
 * inaplicabilidade VAI PARA O TRACE (invariante 4 de
 * `docs/doctrine/restricao-de-canal.md`): `skipped: 'not_applicable'` nunca é um
 * `pass` silencioso, porque a diferença entre "não regrediu" e "consigo provar
 * que não regrediu" é exatamente essa linha em `before_send_traces`.
 *
 * O segundo bloco prova o invariante 3 pelo GATE (não só pelo motor): num canal
 * sem risco de ban, a CORTESIA (janela/domingo/fuso) continua armada. É o caso
 * que reprova a implementação óbvia — `if (!caps.banRisk) return { pass: true }`
 * antes de `decidePacing` — que apagaria o horário comercial junto com o
 * throttle e faria a IA acordar cliente às 3h.
 */
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  pacingGate,
  runBeforeSend,
  type Gate,
  type GateContext,
} from '@/lib/agent-engine/guardrails/before-send';
import { PACING_DEFAULTS } from '@/lib/agent-engine/pacing/defaults';
import { SPINNING_DEFAULTS } from '@/lib/agent-engine/spinning/defaults';
import type { Logger } from '@/lib/agent-engine/obs/logger';

const COMERCIAL = new Date('2026-07-28T13:00:00Z'); // 10h BRT, terça — dentro da janela
const MADRUGADA = new Date('2026-07-28T06:00:00Z'); // 03h BRT — fora da janela

// Espelha o baseCtx de tests/invariants/case-guardrail.test.ts:32 (o repo não tem
// fixture compartilhada de GateContext — cada teste de gate monta a sua).
function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: COMERCIAL,
    body: 'oi',
    optedOut: false,
    provider: 'waha',
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
      rng: () => 0,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: 'inject' },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
    ...overrides,
  };
}

describe('gate de pacing respeita a capability do canal', () => {
  it('em canal SEM risco de ban, o gate registra skipped — não pass silencioso', () => {
    const v = pacingGate.evaluate(baseCtx({ provider: 'meta_cloud' }));
    expect(v.pass).toBe(true);
    if (!v.pass) throw new Error('inalcançável');
    expect(v.skipped).toBe('not_applicable');
  });

  it('em canal COM risco de ban, o gate avalia normalmente', () => {
    const v = pacingGate.evaluate(baseCtx({ provider: 'waha' }));
    expect(v.pass).toBe(true);
    if (!v.pass) throw new Error('inalcançável');
    expect(v.skipped).toBeUndefined();
  });

  it('sem risco de ban, o cap anti-ban desarma (o gate passa onde o WAHA vetaria)', () => {
    const estourado = {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 999, numberActivatedAt: null },
      crmDailyLimit: null,
      rng: () => 0,
    };
    const waha = pacingGate.evaluate(baseCtx({ provider: 'waha', pacing: estourado }));
    expect(waha.pass).toBe(false);

    const meta = pacingGate.evaluate(baseCtx({ provider: 'meta_cloud', pacing: estourado }));
    expect(meta.pass).toBe(true);
    if (!meta.pass) throw new Error('inalcançável');
    expect(meta.skipped).toBe('not_applicable');
  });

  it('invariante 3: sem risco de ban, a CORTESIA (janela) continua vetando', () => {
    const v = pacingGate.evaluate(baseCtx({ provider: 'meta_cloud', now: MADRUGADA }));
    expect(v.pass).toBe(false);
    if (v.pass) throw new Error('inalcançável');
    expect(v.code).toBe('outside_window');
  });
});

/**
 * A propagação. O veredito `skipped` só cumpre o invariante 4 se sobreviver ao
 * runner e chegar ao INSERT em `before_send_traces` — morrer no meio virando
 * `pass` seria falhar no propósito da task com os testes acima verdes.
 *
 * O provider ainda não vem do banco (`channel_sessions.provider` é da Task 6): o
 * ctx de produção fixa 'waha'. Para exercitar o ramo pelo caminho REAL, a cadeia
 * injetada delega ao `pacingGate` de verdade com o provider trocado — o que se
 * mede aqui é o runner e a escrita do trace, não um gate de mentira.
 */
describe('o skipped do gate chega em before_send_traces', () => {
  it('a linha persistida traz verdict=skipped e code=not_applicable', async () => {
    const canalSemBan: Gate = {
      name: 'pacing',
      evaluate: (ctx) => pacingGate.evaluate({ ...ctx, provider: 'meta_cloud' }),
    };
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const persisted = vi.fn().mockResolvedValue({ rows: [{ id: 'trace-1' }] });
    const pool = { connect: vi.fn().mockResolvedValue(client), query: persisted } as unknown as pg.Pool;
    const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await runBeforeSend({
      pool,
      log,
      tenantId: '00000000-0000-4000-8000-000000000001',
      leadId: '00000000-0000-4000-8000-000000000002',
      jobId: '00000000-0000-4000-8000-000000000003',
      channelSessionId: '00000000-0000-4000-8000-000000000004',
      body: 'oi',
      optedOutThisTurn: false,
      crmDailyLimit: null,
      now: COMERCIAL,
      rng: () => 0,
      gates: [canalSemBan],
      send: async () => ({ kind: 'sent', idempotencyKey: 'k', messageId: 'm' }),
    });

    expect(result.status).toBe('sent');
    expect(result.trace).toEqual([{ gate: 'pacing', verdict: 'skipped', code: 'not_applicable' }]);

    const insert = persisted.mock.calls.find(([sql]) => String(sql).includes('before_send_traces'));
    expect(insert).toBeDefined();
    // params[4] = jsonb do trace: é ESTA linha que o auditor lê depois.
    expect(JSON.parse(insert![1][4])).toEqual([
      { gate: 'pacing', verdict: 'skipped', code: 'not_applicable' },
    ]);
  });

  /**
   * Task 6 fechou a última suposição: o ctx de produção lê
   * `channel_sessions.provider` (migration 0087) em vez de fixar 'waha'.
   *
   * O teste acima injeta um gate que TROCA o provider — ele mede o runner, não a
   * origem do valor. Este mede a origem: a cadeia é o `pacingGate` REAL, sem
   * injeção, e o único motivo de o veredito sair `skipped` é o banco ter
   * respondido `meta_cloud`. Com o literal de volta no lugar da consulta, sai
   * `pass` e isto fica vermelho.
   */
  async function rodaComProviderNoBanco(provider: string) {
    // O cap ESTOURADO é o que torna a origem do provider observável: em 'waha' o
    // anti-ban veta; em 'meta_cloud' ele desarma e o envio passa. Dentro da janela
    // comercial, para que a cortesia (que vale nos dois canais) não decida o
    // desfecho e mascare a diferença.
    const client = {
      query: vi.fn(async (sql: string) => {
        const q = String(sql);
        if (q.includes('from channel_sessions')) return { rows: [{ provider }] };
        if (q.includes('from pacing_ledger')) return { rows: [{ last_sent_at: null, sent_today: '999' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const persisted = vi.fn().mockResolvedValue({ rows: [{ id: 'trace-1' }] });
    const pool = { connect: vi.fn().mockResolvedValue(client), query: persisted } as unknown as pg.Pool;
    const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    return runBeforeSend({
      pool,
      log,
      tenantId: '00000000-0000-4000-8000-000000000001',
      leadId: '00000000-0000-4000-8000-000000000002',
      jobId: '00000000-0000-4000-8000-000000000003',
      channelSessionId: '00000000-0000-4000-8000-000000000004',
      body: 'oi',
      optedOutThisTurn: false,
      crmDailyLimit: null,
      now: COMERCIAL,
      rng: () => 0,
      sleep: async () => {},
      gates: [pacingGate],
      send: async () => ({ kind: 'sent', idempotencyKey: 'k', messageId: 'm' }),
    });
  }

  it('o provider do ctx sai de channel_sessions, não de literal', async () => {
    // Sem injeção de gate: a cadeia é o `pacingGate` REAL, e a ÚNICA variável
    // entre as duas rodadas é a linha que o banco devolve. Com o literal de volta
    // no lugar da consulta, as duas rodadas dariam o mesmo desfecho e o par abaixo
    // ficaria vermelho.
    const meta = await rodaComProviderNoBanco('meta_cloud');
    expect(meta.status).toBe('sent');
    expect(meta.trace).toEqual([{ gate: 'pacing', verdict: 'skipped', code: 'not_applicable' }]);

    const waha = await rodaComProviderNoBanco('waha');
    expect(waha.status).toBe('vetoed');
    expect(waha.trace[0]?.verdict).toBe('veto');
  });
});

describe('janela de follow-up somada ao pacing', () => {
  const followupWindow = {
    timezone: 'America/Sao_Paulo', start: '09:00', end: '18:00', weekdays: [1, 2, 3, 4, 5, 6],
  };

  it('adiciona atraso no domingo somente ao fluxo com janela', () => {
    const now = new Date('2026-11-29T15:00:00Z');
    expect(pacingGate.evaluate(baseCtx({ now })).pass).toBe(true);
    expect(pacingGate.evaluate(baseCtx({ now, followupWindow }))).toMatchObject({
      pass: false,
      code: 'outside_followup_window',
      nextAllowedAt: new Date('2026-11-30T12:00:00Z'),
    });
    expect(pacingGate.evaluate(baseCtx({ now: COMERCIAL, followupWindow })).pass).toBe(true);
  });

  it('preserva o warm-up e adia para as 9h do próximo dia do fluxo', () => {
    const now = new Date('2026-11-28T15:00:00Z');
    const { pacing } = baseCtx();
    pacing.state.sentToday = 20;
    expect(pacingGate.evaluate(baseCtx({ now, pacing, followupWindow }))).toMatchObject({
      pass: false, code: 'warmup_cap', nextAllowedAt: new Date('2026-11-30T12:00:00Z'),
    });
  });

  it('respeita o fechamento de sábado do canal e o throttle na borda', () => {
    const { pacing } = baseCtx();
    const now = new Date('2026-11-27T20:59:59.500Z');
    pacing.state.lastSentAt = now;
    pacing.knobs = { ...PACING_DEFAULTS, windowSaturdayEndHour: 9 };
    expect(pacingGate.evaluate(baseCtx({ now, pacing, followupWindow }))).toMatchObject({
      pass: false, code: 'outside_followup_window', nextAllowedAt: new Date('2026-11-30T12:00:00Z'),
    });
  });
});

it('reconfere a janela imediatamente antes do transporte', async () => {
  const antes = new Date('2026-11-27T20:59:59.000Z');
  const depois = new Date('2026-11-27T21:00:00.000Z');
  const followupClock = vi.fn().mockReturnValueOnce(antes).mockReturnValue(depois);
  const send = vi.fn();
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool;
  const result = await runBeforeSend({
    pool,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tenantId: 'org', leadId: 'lead', channelSessionId: 'channel', body: 'Olá!',
    optedOutThisTurn: false, crmDailyLimit: null, now: antes, rng: () => 0,
    followupWindow: {
      timezone: 'America/Sao_Paulo', start: '09:00', end: '18:00', weekdays: [1, 2, 3, 4, 5, 6],
    },
    followupClock, send, gates: [pacingGate],
  });
  expect(result).toMatchObject({
    status: 'vetoed', code: 'outside_followup_window', nextAllowedAt: new Date('2026-11-28T12:00:00Z'),
  });
  expect(send).not.toHaveBeenCalled();
});
