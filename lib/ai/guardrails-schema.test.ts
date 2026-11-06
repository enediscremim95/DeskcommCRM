import { describe, expect, it } from 'vitest';

import { agentPatchSchema } from './guardrails-schema';

describe('agentPatchSchema, sem_saudacao_repetida', () => {
  it.each([true, false])('aceita booleano: %p', (value) => {
    expect(
      agentPatchSchema.safeParse({ config: { sem_saudacao_repetida: value } }).success,
    ).toBe(true);
  });

  it.each(['true', 1, null])('rejeita valor não booleano: %p', (value) => {
    expect(
      agentPatchSchema.safeParse({ config: { sem_saudacao_repetida: value } }).success,
    ).toBe(false);
  });
});

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

describe('agentPatchSchema, vitrines', () => {
  const valida = {
    padrinhos: {
      intro: 'Separei dois modelos pra você 🥰',
      fechamento: 'Essas opções atendem ao que você gostaria?',
      itens: [
        { codigo: 'SUBLI-KRAFT', titulo: 'Kit Afeto com caixa kraft', fotos: 2 },
        { codigo: 'SUBLI-PINUS', titulo: 'Kit Afeto com caixa pinus', fotos: 4 },
      ],
    },
  };

  it('aceita o contrato completo e aplica fotos=2 quando ausente', () => {
    const parsed = agentPatchSchema.safeParse({
      config: {
        vitrines: {
          padrinhos: { itens: [{ codigo: 'SUBLI-KRAFT', titulo: 'Kit kraft' }] },
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.config?.vitrines?.padrinhos?.itens[0]?.fotos).toBe(2);
    }
  });

  it.each([
    { 'Padrinhos': valida.padrinhos },
    { padrinhos: { ...valida.padrinhos, intro: 'linha 1\nlinha 2' } },
    { padrinhos: { ...valida.padrinhos, itens: [] } },
    { padrinhos: { ...valida.padrinhos, itens: [{ codigo: 'X', titulo: 'T', fotos: 5 }] } },
    { padrinhos: { ...valida.padrinhos, itens: [{ codigo: 'X', titulo: 'T', fotos: 1, preco: 10 }] } },
  ])('rejeita forma inválida no PATCH: %p', (vitrines) => {
    expect(agentPatchSchema.safeParse({ config: { vitrines } }).success).toBe(false);
  });

  it('rejeita quebra de linha também nas bordas, antes do trim', () => {
    const vitrines = {
      padrinhos: {
        intro: 'Separei dois modelos\n',
        itens: [{ codigo: 'KRAFT', titulo: 'Kit Afeto', fotos: 2 }],
      },
    };
    expect(agentPatchSchema.safeParse({ config: { vitrines } }).success).toBe(false);
  });

  it('rejeita o décimo terceiro assunto', () => {
    const vitrines = Object.fromEntries(
      Array.from({ length: 13 }, (_, i) => [
        `assunto_${i}`,
        { itens: [{ codigo: `C${i}`, titulo: `Título ${i}` }] },
      ]),
    );
    expect(agentPatchSchema.safeParse({ config: { vitrines } }).success).toBe(false);
  });
});
