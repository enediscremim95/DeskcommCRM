import { beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

const mocks = vi.hoisted(() => ({
  expectativa: vi.fn(),
  beforeSend: vi.fn(),
}));

vi.mock('@/lib/escalacao/disponibilidade', () => ({
  expectativaDeAtendimento: mocks.expectativa,
}));
vi.mock('../guardrails/before-send', () => ({
  runBeforeSend: mocks.beforeSend,
}));

import { avisarLeadDaEscalacao } from './aviso-de-escalacao';

const ids = {
  tenantId: 'org-1',
  leadId: 'lead-1',
  conversationId: 'conv-1',
  channelSessionId: 'channel-1',
  jobId: 'job-1',
};

function opts(silencioso: boolean) {
  const send = vi.fn(async () => ({
    kind: 'sent' as const,
    idempotencyKey: 'k-1',
    messageId: 'm-1',
  }));
  return {
    send,
    value: {
      motivo: 'pediu_humano' as const,
      silencioso,
      channel: { send } as never,
      optedOutThisTurn: false,
      now: new Date('2026-11-06T15:00:00-03:00'),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    },
  };
}

describe('aviso de escalação silenciosa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.expectativa.mockResolvedValue({ quem: { disponiveis: 1, total: 1 }, frase: 'ok' });
    mocks.beforeSend.mockImplementation(async (args: { body: string; send: (body: string) => unknown }) => ({
      status: 'sent',
      outcome: await args.send(args.body),
      trace: [],
    }));
  });

  it('ligada: retorna o motivo antes de montar texto, consultar disponibilidade ou tocar no canal', async () => {
    const { value, send } = opts(true);

    await expect(
      avisarLeadDaEscalacao({} as pg.Pool, ids, value),
    ).resolves.toEqual({ avisado: false, porque: 'aviso_desligado_pelo_agente' });
    expect(mocks.expectativa).not.toHaveBeenCalled();
    expect(mocks.beforeSend).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('desligada: preserva o aviso anterior pela cadeia e pelo canal', async () => {
    const { value, send } = opts(false);

    await expect(avisarLeadDaEscalacao({} as pg.Pool, ids, value)).resolves.toEqual({
      avisado: true,
    });
    expect(mocks.expectativa).toHaveBeenCalledTimes(1);
    expect(mocks.beforeSend).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
