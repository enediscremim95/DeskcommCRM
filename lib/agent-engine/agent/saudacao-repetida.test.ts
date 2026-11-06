import { describe, expect, it, vi } from 'vitest';

import {
  ORIGEM_INTERNA_DA_MENSAGEM,
  type LeadContextMessage,
} from '../edge/crm/get-lead-context';
import {
  filtrarSaudacaoRepetida,
  JANELA_SEM_SAUDACAO_REPETIDA_MS,
  temMensagemRecenteDoAgente,
} from './saudacao-repetida';

const AGORA = new Date('2026-11-05T18:00:00.000Z');

function outboundDoAgente(sentAt: string): LeadContextMessage {
  return {
    direction: 'outbound',
    body: 'Resposta anterior',
    sent_at: sentAt,
    [ORIGEM_INTERNA_DA_MENSAGEM]: 'ai',
  };
}

describe('saudação repetida por agente', () => {
  it('remove o parágrafo de abertura quando houve mensagem da IA nas últimas 12 horas', () => {
    const warn = vi.fn();
    expect(
      filtrarSaudacaoRepetida({
        body: 'Ótima tarde, Bruna! Pode mandar o comprovante por aqui 🌷\n\nAssim que chegar, eu confiro.',
        ativa: true,
        mensagens: [outboundDoAgente('2026-11-05T17:00:00.000Z')],
        agora: AGORA,
        log: { warn },
      }),
    ).toEqual({
      status: 'pronta',
      body: 'Assim que chegar, eu confiro.',
      paragrafos_de_saudacao_removidos: 1,
    });
    expect(warn).toHaveBeenCalledWith('saudação repetida removida da mensagem', {
      paragrafos_recebidos: 2,
      paragrafos_enviados: 1,
      paragrafos_de_saudacao_removidos: 1,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Bruna');
  });

  it('mantém a saudação na primeira mensagem, após mais de 12 horas e com config desligada', () => {
    const body = 'Boa tarde, Bruna! Como vai?';
    const log = { warn: vi.fn() };
    for (const caso of [
      { ativa: true, mensagens: [] },
      { ativa: true, mensagens: [outboundDoAgente('2026-11-05T05:59:59.999Z')] },
      { ativa: false, mensagens: [outboundDoAgente('2026-11-05T17:00:00.000Z')] },
    ]) {
      expect(filtrarSaudacaoRepetida({ body, agora: AGORA, log, ...caso })).toEqual({
        status: 'pronta',
        body,
        paragrafos_de_saudacao_removidos: 0,
      });
    }
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('não confunde outbound humano com mensagem do agente e inclui a borda de 12 horas', () => {
    const humana: LeadContextMessage = {
      direction: 'outbound',
      body: 'Atendimento humano',
      sent_at: '2026-11-05T17:00:00.000Z',
      [ORIGEM_INTERNA_DA_MENSAGEM]: 'user',
    };
    expect(temMensagemRecenteDoAgente([humana], AGORA)).toBe(false);
    expect(
      temMensagemRecenteDoAgente(
        [outboundDoAgente(new Date(AGORA.getTime() - JANELA_SEM_SAUDACAO_REPETIDA_MS).toISOString())],
        AGORA,
      ),
    ).toBe(true);
  });

  it('devolve duplicate_skipped quando só restou a saudação', () => {
    expect(
      filtrarSaudacaoRepetida({
        body: 'Olá, Bruna! Sou a Lorenza, como vai?',
        ativa: true,
        mensagens: [outboundDoAgente('2026-11-05T17:00:00.000Z')],
        agora: AGORA,
        log: { warn: vi.fn() },
      }),
    ).toEqual({ status: 'duplicate_skipped', paragrafos_de_saudacao_removidos: 1 });
  });

  it('a origem interna não entra no JSON entregue ao modelo', () => {
    const mensagem = outboundDoAgente('2026-11-05T17:00:00.000Z');
    expect(JSON.stringify(mensagem)).toBe(
      '{"direction":"outbound","body":"Resposta anterior","sent_at":"2026-11-05T17:00:00.000Z"}',
    );
  });
});
