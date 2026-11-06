import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  concluirHandoffAutomaticoNaPromessa,
  criarEstadoHandoffAutomaticoNaPromessa,
  promessaSemHandoff,
  registrarHandoffRealizadoNesteTurno,
  registrarMensagemParaHandoffAutomatico,
} from './promessa-sem-handoff';

const DEVEM_CASAR = [
  'Vou conferir com a produção se conseguimos te encaixar.',
  'Vou confirmar isso aqui rapidinho e já te respondo.',
  'Deixa eu confirmar o frete certinho pra você e já te respondo.',
  'Já vou verificar com a equipe e te retorno.',
  'Vamos checar com o time e já te respondo 😊',
  'Vou ver com a Lorenza e já te retorno.',
  'Deixe eu conferir com a produção, por favor.',
  'Vou pedir para a equipe confirmar e já te respondo.',
  'VOU CONFERIR COM A PRODUÇÃO E TE RETORNO.',
  'Vou confirmar com a producao e já respondo.',
  'Deixa eu checar com o time se ainda cabe hoje 🙏',
  'Confirmar o valor certinho e já te retorno.',
] as const;

const NAO_DEVEM_CASAR = [
  'Conferindo o pedido, está tudo certinho?',
  'Pode conferir o valor para mim?',
  'A equipe já confirmou o prazo.',
  'A produção confirmou que fica pronto amanhã.',
  'Não consigo confirmar esse prazo.',
  'Não vou confirmar com a equipe agora.',
  'Quer que eu confirme o pedido?',
  'Você disse "vou confirmar com a equipe", foi isso?',
  'Vou confirmar o pedido.',
  'Seu pedido está confirmado.',
  'Já conferi com a Lorenza e está tudo certo.',
  'O time verificou o endereço ontem.',
  'Pode ver se o frete está certo?',
] as const;

describe('detector de promessa sem handoff', () => {
  it.each(DEVEM_CASAR)('casa promessa explícita: %s', (frase) => {
    expect(promessaSemHandoff(frase)).toBe(true);
  });

  it.each(NAO_DEVEM_CASAR)('não cria falso positivo: %s', (frase) => {
    expect(promessaSemHandoff(frase)).toBe(false);
  });

  it('mantém o corpus mínimo pedido, com 12 positivos e 13 negativos', () => {
    expect(DEVEM_CASAR).toHaveLength(12);
    expect(NAO_DEVEM_CASAR).toHaveLength(13);
  });
});

function cenario() {
  const estado = criarEstadoHandoffAutomaticoNaPromessa();
  registrarMensagemParaHandoffAutomatico(
    estado,
    'Vou conferir com a produção e já te respondo.',
  );
  return {
    estado,
    humano: vi.fn(async () => false),
    aplicar: vi.fn(async () => undefined),
    sandbox: vi.fn(),
    info: vi.fn(),
  };
}

describe('fechamento automático do turno', () => {
  it('fica desligado por padrão e não consulta nem aplica efeito', async () => {
    const c = cenario();
    await expect(
      concluirHandoffAutomaticoNaPromessa({
        ativo: false,
        estado: c.estado,
        sandbox: false,
        conversaEmAtendimentoHumano: c.humano,
        aplicarHandoff: c.aplicar,
        registrarSandbox: c.sandbox,
        log: { info: c.info },
      }),
    ).resolves.toBe('desligado');
    expect(c.humano).not.toHaveBeenCalled();
    expect(c.aplicar).not.toHaveBeenCalled();
  });

  it('ligado aplica uma passagem automática com observabilidade sem conteúdo', async () => {
    const c = cenario();
    await expect(
      concluirHandoffAutomaticoNaPromessa({
        ativo: true,
        estado: c.estado,
        sandbox: false,
        conversaEmAtendimentoHumano: c.humano,
        aplicarHandoff: c.aplicar,
        registrarSandbox: c.sandbox,
        log: { info: c.info },
      }),
    ).resolves.toBe('aplicado');
    expect(c.aplicar).toHaveBeenCalledOnce();
    expect(c.info).toHaveBeenCalledWith('handoff automático na promessa aplicado', {
      reason: 'promessa_de_conferir_sem_passar',
      mensagens_enviadas: 1,
      mensagens_com_promessa: 1,
    });
    expect(JSON.stringify(c.info.mock.calls)).not.toContain('produção');
  });

  it('não duplica quando já houve handoff neste turno', async () => {
    const c = cenario();
    registrarHandoffRealizadoNesteTurno(c.estado);
    await expect(
      concluirHandoffAutomaticoNaPromessa({
        ativo: true,
        estado: c.estado,
        sandbox: false,
        conversaEmAtendimentoHumano: c.humano,
        aplicarHandoff: c.aplicar,
        registrarSandbox: c.sandbox,
        log: { info: c.info },
      }),
    ).resolves.toBe('handoff_ja_realizado');
    expect(c.aplicar).not.toHaveBeenCalled();
  });

  it('não aplica se a conversa já está em atendimento humano', async () => {
    const c = cenario();
    c.humano.mockResolvedValue(true);
    await expect(
      concluirHandoffAutomaticoNaPromessa({
        ativo: true,
        estado: c.estado,
        sandbox: false,
        conversaEmAtendimentoHumano: c.humano,
        aplicarHandoff: c.aplicar,
        registrarSandbox: c.sandbox,
        log: { info: c.info },
      }),
    ).resolves.toBe('conversa_ja_humana');
    expect(c.aplicar).not.toHaveBeenCalled();
  });

  it('executa o fechamento no máximo uma vez por turno', async () => {
    const c = cenario();
    const args = {
      ativo: true,
      estado: c.estado,
      sandbox: false,
      conversaEmAtendimentoHumano: c.humano,
      aplicarHandoff: c.aplicar,
      registrarSandbox: c.sandbox,
      log: { info: c.info },
    };
    await expect(concluirHandoffAutomaticoNaPromessa(args)).resolves.toBe('aplicado');
    await expect(concluirHandoffAutomaticoNaPromessa(args)).resolves.toBe('ja_finalizado');
    expect(c.aplicar).toHaveBeenCalledOnce();
  });

  it('no sandbox registra o rastro e não executa efeito real', async () => {
    const c = cenario();
    await expect(
      concluirHandoffAutomaticoNaPromessa({
        ativo: true,
        estado: c.estado,
        sandbox: true,
        conversaEmAtendimentoHumano: c.humano,
        aplicarHandoff: c.aplicar,
        registrarSandbox: c.sandbox,
        log: { info: c.info },
      }),
    ).resolves.toBe('simulado');
    expect(c.sandbox).toHaveBeenCalledWith('handoff_automatico_na_promessa');
    expect(c.aplicar).not.toHaveBeenCalled();
  });

  it('turno real e sandbox convergem no mesmo fechamento estrutural', () => {
    const inbound = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'agent-engine', 'agent', 'inbound-turn.ts'),
      'utf8',
    );
    expect(inbound.match(/concluirHandoffAutomaticoNaPromessa\(\{/g)).toHaveLength(1);
    const fechamento = inbound.indexOf('concluirHandoffAutomaticoNaPromessa({');
    const mainRun = inbound.indexOf('const turn = await runModelCall(');
    const falhaDoTurno = inbound.indexOf('if (runError !== null)', fechamento);
    expect(fechamento).toBeGreaterThan(mainRun);
    expect(falhaDoTurno).toBeGreaterThan(fechamento);
  });
});
