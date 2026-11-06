import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  internalVocabularyGate,
  type GateContext,
} from '@/lib/agent-engine/guardrails/before-send';
import {
  encontrarTermoProibido,
  ENSINO_TERMO_PROIBIDO,
} from '@/lib/agent-engine/guardrails/termos-proibidos-ao-cliente';
import { MAX_VETOS_DE_TERMO_PROIBIDO } from '@/lib/agent-engine/agent/inbound-turn';

describe('termos proibidos por agente', () => {
  it('ignora acento e diferença de maiúscula', () => {
    expect(encontrarTermoProibido('Vou chamar um ATÉNDENTE.', ['atendente'])).toBe('atendente');
    expect(encontrarTermoProibido('Alguem DO TIME responde já.', ['alguém do time'])).toBe(
      'alguém do time',
    );
  });

  it('casa palavra inteira, não palavra parcial', () => {
    expect(encontrarTermoProibido('O pessoal responde logo.', ['pessoa'])).toBeNull();
    expect(encontrarTermoProibido('Uma pessoa responde logo.', ['pessoa'])).toBe('pessoa');
  });

  it('o gate veta com ensino em português e não expõe o termo no detalhe', () => {
    const verdict = internalVocabularyGate.evaluate({
      body: 'Passei para um atendente.',
      termosProibidosAoCliente: ['atendente'],
      internalVocabularyEnforced: false,
    } as unknown as GateContext);

    expect(verdict).toMatchObject({
      pass: false,
      code: 'termo_proibido_ao_cliente',
      reason: ENSINO_TERMO_PROIBIDO,
      detail: { leaked_count: 1, leaked_kinds: 'configurado' },
    });
  });

  it('lista vazia mantém o comportamento anterior', () => {
    expect(
      internalVocabularyGate.evaluate({
        body: 'Uma atendente responde logo.',
        termosProibidosAoCliente: [],
        internalVocabularyEnforced: false,
      } as unknown as GateContext),
    ).toEqual({ pass: true });
  });
});

describe('veto repetido não vira envio', () => {
  const fonte = readFileSync(
    join(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'),
    'utf8',
  );

  it('dá uma chance de reescrita e depois faz handoff com aviso explicitamente silencioso', () => {
    expect(MAX_VETOS_DE_TERMO_PROIBIDO).toBeGreaterThanOrEqual(2);
    expect(fonte).toMatch(/chain\.code === 'termo_proibido_ao_cliente'/u);
    expect(fonte).toMatch(/termoProibidoVetoCount < MAX_VETOS_DE_TERMO_PROIBIDO/u);
    expect(fonte).toMatch(
      /motivo: 'outro',[\s\S]{0,180}silencioso: true,[\s\S]{0,500}performHumanHandoff/u,
    );
    expect(fonte).not.toMatch(
      /chain\.code === 'termo_proibido_ao_cliente'[\s\S]{0,1200}enforceInternalVocabulary: false/u,
    );
  });
});
