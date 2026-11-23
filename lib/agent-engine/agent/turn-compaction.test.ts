import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { countPayloadTokens, type LeadContext, type LeadContextMessage } from '../edge/crm/get-lead-context';
import { maybeCompact, renderCompactedSummary } from './compaction';
import { buildOpeningMessage } from './inbound-turn';
import { scenarioContext } from './preview';
import {
  compactTurnHistory,
  readTurnCompactionChoice,
  turnCompactionBlock,
} from './turn-compaction';

vi.mock('@/lib/crypto/aes_gcm', () => ({
  byteaToBuffer: (value: Buffer) => value,
  decryptKey: () => 'CREDENCIAL_FICTICIA_DA_ORGANIZACAO',
}));

const tenantId = 'org-ficticia';
const credentialId = 'credencial-ficticia';
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const limits = { historyLimit: 20, maxTokens: 8000 };

function message(index: number, direction: LeadContextMessage['direction'], body: string) {
  return { direction, body, sent_at: new Date(Date.UTC(2026, 10, 10, 14, index)).toISOString() };
}

const facts = {
  commitments: ['Prova confirmada em 17/11 às 14h, horário de Brasília.'],
  objections: ['Evitar peças com lã.'],
  personal_data: ['Nome informado: Lia Cenário.'],
  stage: 'negociação',
  rolling_summary: 'A loja prometeu enviar a foto da gola até sexta-feira. A cliente ainda aguarda a cotação do frete.',
};

const topics = ['vestido de linho', 'casaco de algodão', 'calça de sarja', 'blusa sem manga',
  'camisa de viscose', 'bolsa de tecido', 'colete com forro', 'saia midi', 'macacão', 'cinto de lona'];
const history = [
  message(0, 'inbound', 'Sou Lia Cenário. Preciso de um conjunto sem lã e quero cotar a entrega.'),
  message(1, 'outbound', 'Prova confirmada em 17/11 às 14h (Brasília). Envio a foto da gola até sexta.'),
  ...topics.flatMap((topic, i) => [
    message(2 + 2 * i, 'inbound',
      `Sobre ${topic}, queria conferir as medidas antes da prova. ` +
      'Tenho uma peça parecida em casa e comparei com a tabela. A largura até parece suficiente ' +
      'mas fiquei em dúvida se a medida vem da peça na mesa ou do corpo. Se houver diferença entre ' +
      'os tamanhos, prefiro experimentar o mais solto. Estou montando a lista de opções para a visita.'),
    message(3 + 2 * i, 'outbound',
      `Para ${topic}, a tabela usa as medidas da peça na mesa. ` +
      'Se quiser comparar, meça uma roupa que costuma usar da mesma forma, sem esticar o tecido. ' +
      'A modelagem pode variar mesmo quando a etiqueta é igual. Na prova podemos comparar os lotes ' +
      'que estão disponíveis e conferir se a folga nos ombros e na cintura fica confortável.'),
  ]),
  message(22, 'inbound', 'Pode manter a prova e me confirmar quanto fica a entrega?'),
  message(23, 'inbound', 'Ah, e vou com uma acompanhante.'),
];
const context: LeadContext = { ...scenarioContext(history).context, conversation_id: 'conversa-ficticia' };
const defaultInput = { context, history, limits, tailTokens: 400, log, previous: undefined };

function fakeSeam(hasOrgCredential: boolean) {
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("settings->'llm'")) return { rows: [{ llm: { provider: 'anthropic' } }] };
    if (sql.includes('from ai_purpose_bindings')) {
      expect(params).toEqual([tenantId, 'compaction']);
      return { rows: [{ provider: 'openai', credential_id: credentialId, model_id: 'resumo-ficticio', is_enabled: true }] };
    }
    if (sql.includes('from ai_provider_credentials')) {
      expect(params).toEqual([tenantId, credentialId]);
      expect(sql).toContain('organization_id = $1 and id = $2');
      return { rows: hasOrgCredential ? [{
        api_key_encrypted: Buffer.alloc(1),
        api_key_iv: Buffer.alloc(1),
        api_key_tag: Buffer.alloc(1),
      }] : [] };
    }
    if (sql.includes('insert into llm_calls')) return { rows: [{ id: 'chamada-ficticia' }] };
    return { rows: [] };
  });
  const generate = vi.fn(async () => ({
    content: [{ type: 'text', text: JSON.stringify(facts) }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }));
  const factory = vi.fn((_key: string, modelId: string) => ({
    specificationVersion: 'v3',
    provider: 'openai',
    modelId,
    doGenerate: generate,
  }) as never);
  const db = { query } as unknown as pg.Pool;
  const summarize = async (prefix: Pick<LeadContext, 'messages'>, previousSummary: string) => {
    const result = await maybeCompact(
      db,
      { openaiApiKey: 'CREDENCIAL_FICTICIA_GLOBAL' },
      { tenantId, leadId: null },
      {
        context: prefix,
        previousSummary,
        conversationPrefix: true,
        knobs: { triggerMessages: 1, transcriptMaxTokens: 400 },
        notesIndexMaxTokens: 400,
      },
      { registry: { openai: factory }, log },
    );
    return result ? renderCompactedSummary(result) : null;
  };
  return { query, factory, generate, summarize };
}

describe('compactação incremental do turno', () => {
  it('detecta estouro de mensagens, usa o binding da org e mede a abertura antes/depois', async () => {
    const { factory, query, summarize } = fakeSeam(true);
    const result = await compactTurnHistory({ ...defaultInput, summarize });
    expect(result).not.toBeNull();
    expect(result!.context.messages).toEqual(history.slice(-4));
    expect(result!.context.contact).toEqual(context.contact);
    const block = turnCompactionBlock(result!.state.summary);
    for (const fact of [...facts.commitments, ...facts.objections, ...facts.personal_data, facts.rolling_summary]) {
      expect(block).toContain(fact);
    }
    expect(factory).toHaveBeenCalledExactlyOnceWith('CREDENCIAL_FICTICIA_DA_ORGANIZACAO', 'resumo-ficticio', undefined);
    expect(query.mock.calls.find(([sql]) => sql.includes('insert into llm_calls'))?.[1][4]).toBe('compaction');

    const beforeContext = { ...context, messages: history.slice(-limits.historyLimit) };
    expect(countPayloadTokens(JSON.stringify(beforeContext))).toBeLessThan(limits.maxTokens);
    const system = 'Você atende clientes de uma loja de roupas. Confirme os detalhes de cada pedido.';
    const opening = (ctx: typeof context) => buildOpeningMessage(null, null, ctx, '');
    const before = countPayloadTokens(system + '\n' + opening(beforeContext));
    const after = countPayloadTokens(system + '\n' + opening(result!.context) + '\n\n' + block);
    expect({ before, after }).toEqual({ before: 2636, after: 896 });
  });

  it('dispara por tokens antes de encher a janela de mensagens e mantém a rajada pendente', async () => {
    const shorter = history.slice(-8);
    const summarize = vi.fn().mockResolvedValue(facts.rolling_summary);
    const result = await compactTurnHistory({
      ...defaultInput, history: shorter, limits: { historyLimit: 20, maxTokens: 650 }, tailTokens: 200, summarize,
    });
    expect(summarize).toHaveBeenCalledOnce();
    expect(result?.context.messages).toEqual(history.slice(-2));
  });

  it('reusa um estado recarregado do checkpoint e só resume o delta quando a cauda enche', async () => {
    const summarize = vi.fn().mockResolvedValue(facts.rolling_summary);
    const first = await compactTurnHistory({ ...defaultInput, summarize });
    const previous: unknown = JSON.parse(JSON.stringify(first?.state));
    summarize.mockClear();
    const appended = [...history, message(24, 'outbound', 'Vou ver a cotação para você.')];
    const second = await compactTurnHistory({ ...defaultInput, history: appended, previous, summarize });
    expect(summarize).not.toHaveBeenCalled();
    expect(second?.state).toEqual(first?.state);
    expect(second?.context.messages).toEqual(appended.slice(first?.state.count));

    const newMessages = history.slice(2, 22).map((entry, i) =>
      message(25 + i, entry.direction, entry.body));
    const longer = [...appended, ...newMessages, message(45, 'inbound', 'Pode confirmar?')];
    const third = await compactTurnHistory({ ...defaultInput, history: longer, previous, summarize });
    expect(summarize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ messages: longer.slice(first!.state.count, third!.state.count) }),
      first!.state.summary,
    );
  });

  it('revalida o prefixo quando uma mensagem antiga muda e ignora o resumo obsoleto', async () => {
    const summarize = vi.fn().mockResolvedValue(facts.rolling_summary);
    const first = await compactTurnHistory({ ...defaultInput, summarize });
    const edited = [message(0, 'inbound', 'Só quero atendimento na quarta-feira.'), ...history.slice(1)];
    summarize.mockClear();
    await compactTurnHistory({ ...defaultInput, history: edited, previous: first?.state, summarize });
    expect(summarize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ messages: edited.slice(0, first?.state.count) }),
      '',
    );
  });

  it('mantém o histórico original quando o resumo falha ou quando o histórico ainda cabe', async () => {
    const summarize = vi.fn().mockResolvedValue(null);
    expect(await compactTurnHistory({ ...defaultInput, history: history.slice(-2), summarize })).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
    expect(await compactTurnHistory({ ...defaultInput, summarize })).toBeNull();
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('protege uma rajada inteira e respeita uma janela desabilitada', async () => {
    const summarize = vi.fn().mockResolvedValue(facts.rolling_summary);
    const pending = history.map((entry) => ({ ...entry, direction: 'inbound' as const }));
    expect(await compactTurnHistory({ ...defaultInput, history: pending, summarize })).toBeNull();
    expect(await compactTurnHistory({
      ...defaultInput, limits: { ...limits, historyLimit: 0 }, summarize,
    })).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it('rejeita resumo que ainda ultrapassa o orçamento configurado', async () => {
    const summarize = vi.fn().mockResolvedValue(history.map((entry) => entry.body).join(' '));
    expect(await compactTurnHistory({
      ...defaultInput, limits: { ...limits, maxTokens: 1000 }, summarize,
    })).toBeNull();
    expect(summarize).toHaveBeenCalledOnce();
  });

  it('recusa a chamada se a credencial da organização estiver ausente, mesmo com global configurada', async () => {
    const { factory, summarize } = fakeSeam(false);
    await expect(compactTurnHistory({ ...defaultInput, summarize })).rejects.toMatchObject({
      name: 'llm_not_configured',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([true, false, null])('lê a escolha %s apenas na organização do turno', async (enabled) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ enabled }] });
    await expect(readTurnCompactionChoice({ query }, tenantId, log)).resolves.toBe(enabled);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('where id = $1'), [tenantId]);
  });
});
