import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const fonte = readFileSync(
  join(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'),
  'utf8',
);

function trecho(inicio: string, fim: string): string {
  const i = fonte.indexOf(inicio);
  expect(i, `âncora inicial sumiu: ${inicio}`).toBeGreaterThan(-1);
  const j = fonte.indexOf(fim, i + inicio.length);
  expect(j, `âncora final sumiu: ${fim}`).toBeGreaterThan(i);
  return fonte.slice(i, j);
}

describe('os cinco caminhos de aviso respeitam a configuração silenciosa', () => {
  it('teto de orçamento lê a config só no erro, suprime o aviso e mantém a escolta de handoff', () => {
    const bloco = trecho('avisarLead: async () => {', 'log: logDaEscolta,');
    expect(bloco).toContain('loadPublishedAgentConfig(');
    expect(bloco).toContain('silencioso: escalacaoSilenciosa');
    expect(fonte).toMatch(/comHandoffSeOrcamentoAcabar\([\s\S]*?performHumanHandoff/u);
  });

  it('pedido explícito passa o modo pelo aviso e continua chamando performHumanHandoff', () => {
    const bloco = trecho('// F4-06 (acceptance 1): detecção', '// F4-07: STOP AMBÍGUO');
    expect(bloco).toContain('...avisoDaEscalacao().base');
    expect(bloco).toContain('performHumanHandoff(');
  });

  it('suspeita de opt-out passa o modo pelo aviso e continua chamando performHumanHandoff', () => {
    const bloco = trecho('// F4-07: STOP AMBÍGUO', '// F3-07: compaction');
    expect(bloco).toContain('...avisoDaEscalacao().base');
    expect(bloco).toContain('performHumanHandoff(');
  });

  it('tool request_human_handoff consulta o aviso até quando já houve fala e mantém o wrapper de passagem', () => {
    const bloco = trecho('request_human_handoff: tool({', '// F3-02: a tool de agendamento');
    expect(bloco).toMatch(/seq === 0 \|\| agentConfig\?\.escalacaoSilenciosa === true/u);
    expect(bloco).toContain('avisarLeadDaEscalacao(');
    expect(bloco).toContain('applyRequestHumanHandoff(');
  });

  it('handoff automático na promessa passa o modo pelo aviso e mantém performHumanHandoff', () => {
    const bloco = trecho('await concluirHandoffAutomaticoNaPromessa({', '// F4-04: correlação');
    expect(bloco).toContain('...avisoDaEscalacao().base');
    expect(bloco).toContain('performHumanHandoff(');
  });

  it('a base compartilhada lê somente o agente atual e mantém false como default', () => {
    const bloco = trecho('const avisoDaEscalacao = () => ({', '// F4-06 (acceptance 1)');
    expect(bloco).toContain('silencioso: agentConfig?.escalacaoSilenciosa === true');
  });
});
