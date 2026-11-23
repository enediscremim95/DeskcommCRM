import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../obs/logger';
import { jevTriageHint } from './jev-triage';

const response = {
  tipo: { choice: 'seguro', confidence: 0.95, probabilities: { seguro: 0.92 } },
  prioridade: { choice: 'normal', confidence: 0.9, probabilities: { normal: 0.9 } },
  risco: { choice: '2', confidence: 0.88, probabilities: { '2': 0.85 } },
};
const info = vi.fn();
const input = {
  organizationId: 'org',
  channelId: 'canal',
  agentId: 'agente',
  message: 'Vocês trabalham com seguro para o veículo?',
  log: { info } as unknown as Logger,
};

describe('triagem Jev', () => {
  beforeEach(() => {
    info.mockClear();
    vi.stubEnv('JEV_TRIAGE_ORGANIZATION_ID', input.organizationId);
    vi.stubEnv('JEV_TRIAGE_CHANNEL_ID', input.channelId);
    vi.stubEnv('JEV_TRIAGE_AGENT_ID', input.agentId);
    vi.stubEnv('OPENROUTER_API_KEY', 'chave-ficticia');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('lê o primeiro objeto JSON envolto em Markdown no contrato de decisões', async () => {
    const payload = JSON.stringify({ answers: response, metadata: 'fecha } entre aspas' });
    const fetchMock = vi.fn().mockResolvedValue(new Response('Resultado:\n' + '```json\n' + payload + '\n```\n{}'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await jevTriageHint(input)).toContain('Tipo: seguro. Prioridade: normal. Risco: 2/10.');
    expect(info).toHaveBeenCalledWith('jev_triagem', { tipo: 'seguro', prioridade: 'normal', risco: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/alpha/decisions',
      expect.objectContaining({ body: expect.stringContaining('"model":"~typesafe/jev-latest"') }),
    );
  });

  it.each([
    ['json_invalido', { ...response, risco: { ...response.risco, choice: '11' } }],
    ['baixa_confianca', { ...response, tipo: { ...response.tipo, confidence: 0.7 } }],
  ])('segue o fluxo habitual com motivo %s', async (motivo, result) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
    expect(await jevTriageHint(input)).toBe('');
    expect(info).toHaveBeenCalledWith('jev_triagem_fallback', { motivo });
  });
});
