import { describe, expect, it } from 'vitest';

import { agentPatchSchema } from './guardrails-schema';

describe('agentPatchSchema, max_sends_per_turn', () => {
  it.each([1, 6, 12])('aceita inteiro dentro da faixa: %i', (value) => {
    const parsed = agentPatchSchema.safeParse({ config: { max_sends_per_turn: value } });

    expect(parsed.success).toBe(true);
  });

  it('aceita null para remover o opt-in e voltar ao teto global', () => {
    const parsed = agentPatchSchema.safeParse({ config: { max_sends_per_turn: null } });

    expect(parsed.success).toBe(true);
  });

  it.each([0, 13, 1.5, '6'])('rejeita valor inválido no PATCH: %p', (value) => {
    const parsed = agentPatchSchema.safeParse({ config: { max_sends_per_turn: value } });

    expect(parsed.success).toBe(false);
  });
});
