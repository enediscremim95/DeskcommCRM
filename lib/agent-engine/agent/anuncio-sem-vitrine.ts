export const MENSAGEM_ANUNCIO_SEM_VITRINE =
  'Não anuncie o envio por texto: a ferramenta crm_send_vitrine já envia a abertura, as fotos e a pergunta final. Chame crm_send_vitrine com o assunto agora; só escreva texto para cumprimentar ou perguntar.';

const ANUNCIO_DE_PRODUTO =
  /\b(?:(?:eu\s+)?(?:(?:vou\s+(?:te\s+)?(?:mostrar|enviar|mandar|separar))|(?:ja\s+(?:vou\s+)?(?:te\s+)?(?:mostrar|mostro|enviar|envio|mandar|mando|separar|separo|separei))|separei)|deix(?:a|e)\s+eu\s+(?:te\s+)?mostrar)\b[^.!?;\n]{0,120}\b(?:modelos?|op(?:cao|coes)|valores?|precos?|kits?|fotos?|loucas?|canecas?|lembrancinhas?)\b/i;

function normalizarParaDeteccao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

/**
 * Detecta somente o anúncio explícito de uma exibição futura de produto.
 * O alvo precisa vir depois do verbo e na mesma frase, para não confundir
 * contexto passado ("os valores que te mostrei") com promessa de envio.
 */
export function anunciaEnvioDeProduto(texto: string): boolean {
  return ANUNCIO_DE_PRODUTO.test(normalizarParaDeteccao(texto));
}

export interface GuardaAnuncioSemVitrine {
  avaliar: (texto: string) =>
    | {
        ok: false;
        error: { code: 'anuncio_sem_vitrine'; message: typeof MENSAGEM_ANUNCIO_SEM_VITRINE };
      }
    | null;
  registrarSucessoDeCatalogoOuVitrine: () => void;
}

/**
 * Estado local ao turno. Recusa no máximo uma vez e deixa de atuar depois que
 * uma ferramenta de catálogo ou vitrine conclui com sucesso.
 */
export function criarGuardaAnuncioSemVitrine(ativa: boolean): GuardaAnuncioSemVitrine {
  let recusouNesteTurno = false;
  let ferramentaConcluida = false;

  return {
    avaliar(texto) {
      if (
        !ativa ||
        ferramentaConcluida ||
        recusouNesteTurno ||
        !anunciaEnvioDeProduto(texto)
      ) {
        return null;
      }
      recusouNesteTurno = true;
      return {
        ok: false,
        error: { code: 'anuncio_sem_vitrine', message: MENSAGEM_ANUNCIO_SEM_VITRINE },
      };
    },
    registrarSucessoDeCatalogoOuVitrine() {
      ferramentaConcluida = true;
    },
  };
}
