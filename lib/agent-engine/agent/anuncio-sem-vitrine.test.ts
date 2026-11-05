import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  anunciaEnvioDeProduto,
  criarGuardaAnuncioSemVitrine,
  MENSAGEM_ANUNCIO_SEM_VITRINE,
} from './anuncio-sem-vitrine';

describe('anúncio sem vitrine', () => {
  it.each([
    'Vou te mostrar os modelos agora.',
    'Já te mostro as opções que combinam com a festa.',
    'Vou te enviar as fotos.',
    'Já te envio os valores certinhos.',
    'Vou te mandar o preço de cada uma.',
    'Já te mando o kit completo.',
    'Separei dois modelos pra você 🥰',
    'Deixa eu te mostrar a louça Mais Preciosa que Rubis.',
    'Vou mostrar as lembrancinhas disponíveis.',
    'Vou separar os modelos pra você.',
    'Eu já te mostro os preços.',
    'Já separei as fotos da caneca.',
  ])('detecta anúncio explícito: %s', (frase) => {
    expect(anunciaEnvioDeProduto(frase)).toBe(true);
  });

  it.each([
    'Fazemos sim o kit para convidar os padrinhos.',
    'Parabéns pela princesa!',
    'Os valores que te mostrei já são para PIX.',
    'Vou confirmar com a equipe.',
    'Já te respondo.',
    'Posso te ajudar a escolher um modelo?',
    'A foto ficou linda.',
    'Separei seu pedido para produção.',
    'Vou te mandar a confirmação do pedido.',
  ])('não cria falso positivo: %s', (frase) => {
    expect(anunciaEnvioDeProduto(frase)).toBe(false);
  });

  it('recusa só a primeira tentativa, com erro instrutivo exato', () => {
    const guarda = criarGuardaAnuncioSemVitrine(true);
    expect(guarda.avaliar('Já te mostro os modelos.')).toEqual({
      ok: false,
      error: { code: 'anuncio_sem_vitrine', message: MENSAGEM_ANUNCIO_SEM_VITRINE },
    });
    expect(guarda.avaliar('Vou te enviar as fotos.')).toBeNull();
  });

  it('não atua sem opt-in e desarma após ferramenta concluída com sucesso', () => {
    const inativa = criarGuardaAnuncioSemVitrine(false);
    expect(inativa.avaliar('Já te mostro os modelos.')).toBeNull();

    const concluida = criarGuardaAnuncioSemVitrine(true);
    concluida.registrarSucessoDeCatalogoOuVitrine();
    expect(concluida.avaliar('Já te mostro os modelos.')).toBeNull();
  });

  it('está antes do teto no turno real e é entregue à política do sandbox', () => {
    const inbound = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'agent-engine', 'agent', 'inbound-turn.ts'),
      'utf8',
    );
    const inicio = inbound.indexOf('send_message: tool({');
    const fim = inbound.indexOf('search_knowledge:', inicio + 1);
    const bloco = inbound.slice(inicio, fim > inicio ? fim : inicio + 15_000);
    const guarda = bloco.indexOf('guardaAnuncioSemVitrine.avaliar(bodySemRepeticao)');
    const teto = bloco.indexOf('if (seq >= maxSendsPerTurn)');

    expect(inicio).toBeGreaterThan(-1);
    expect(guarda).toBeGreaterThan(-1);
    expect(teto).toBeGreaterThan(guarda);
    expect(inbound).toContain('applyPreviewPolicy(');
    expect(inbound).toContain('guardaAnuncioSemVitrine,');
    expect(inbound.match(/registrarSucessoDeCatalogoOuVitrine\(\)/g)).toHaveLength(3);
  });
});
