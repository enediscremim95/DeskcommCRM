export const MENSAGEM_ANUNCIO_SEM_VITRINE =
  'Não anuncie o envio por texto: a ferramenta crm_send_vitrine já envia a abertura, as fotos e a pergunta final. Chame crm_send_vitrine com o assunto agora; só escreva texto para cumprimentar ou perguntar.';

export const INSTRUCAO_CHAMAR_VITRINE = 'chame crm_send_vitrine se for mostrar produtos';

const ANUNCIO_DE_PRODUTO =
  /\b(?:(?:eu\s+)?(?:(?:vou\s+(?:te\s+)?(?:mostrar|enviar|mandar|separar))|(?:ja\s+(?:vou\s+)?(?:te\s+)?(?:mostrar|mostro|enviar|envio|mandar|mando|separar|separo|separei))|separei)|deix(?:a|e)\s+eu\s+(?:te\s+)?mostrar)\b[^.!?;\n]{0,120}\b(?:modelos?|op(?:cao|coes)|valores?|precos?|kits?|fotos?|loucas?|canecas?|lembrancinhas?)\b/i;

const APRESENTACAO_SEM_PRODUTO = [
  /\b(?:essas?|estes?)\s+sao\b[^.!?;\n]{0,100}\b(?:modelos?|opcoes?|kits?|fotos?|loucas?|canecas?|lembrancinhas?)\b/i,
  /\bqual\s+desses?\b[^.!?;\n]{0,80}\b(?:modelos?|opcoes?|kits?|canecas?|lembrancinhas?)\b[^.!?;\n]{0,80}\bver\s+melhor\b/i,
];

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
  const normalizado = normalizarParaDeteccao(texto);
  return ANUNCIO_DE_PRODUTO.test(normalizado) || APRESENTACAO_SEM_PRODUTO.some((r) => r.test(normalizado));
}

function paragrafos(texto: string): string[] {
  const partes = texto.split(/\r?\n\s*\r?\n+/).map((p) => p.trim()).filter(Boolean);
  return partes.length > 0 ? partes : [texto.trim()];
}

export type AvaliacaoAnuncioSemVitrine =
  | {
      status: 'pronta_sem_anuncio';
      body: string;
      paragrafos_de_anuncio_removidos: number;
    }
  | {
      ok: false;
      error: { code: 'anuncio_sem_vitrine'; message: typeof MENSAGEM_ANUNCIO_SEM_VITRINE };
    };

export interface GuardaAnuncioSemVitrine {
  avaliar: (texto: string) => AvaliacaoAnuncioSemVitrine | null;
  registrarSucessoDeCatalogoOuVitrine: () => void;
}

/**
 * Estado local ao turno. Recusa no máximo uma vez e deixa de atuar depois que
 * uma ferramenta de catálogo ou vitrine conclui com sucesso.
 */
export function criarGuardaAnuncioSemVitrine(
  ativa: boolean,
  log?: { warn: (message: string, fields: Record<string, unknown>) => void },
): GuardaAnuncioSemVitrine {
  let recusouNesteTurno = false;
  let ferramentaConcluida = false;

  return {
    avaliar(texto) {
      if (!ativa || ferramentaConcluida || recusouNesteTurno) {
        return null;
      }
      const recebidos = paragrafos(texto);
      const permitidos = recebidos.filter((paragrafo) => !anunciaEnvioDeProduto(paragrafo));
      const removidos = recebidos.length - permitidos.length;
      if (removidos === 0) return null;
      log?.warn('parágrafos de anúncio sem vitrine removidos', {
        paragrafos_recebidos: recebidos.length,
        paragrafos_enviados: permitidos.length,
        paragrafos_de_anuncio_removidos: removidos,
      });
      if (permitidos.length > 0) {
        return {
          status: 'pronta_sem_anuncio',
          body: permitidos.join('\n\n'),
          paragrafos_de_anuncio_removidos: removidos,
        };
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

export function resultadoDeEnvioSemAnuncio(
  avaliacao: AvaliacaoAnuncioSemVitrine | null,
): {
  ok: true;
  status: 'enviado_sem_anuncio';
  paragrafos_de_anuncio_removidos: number;
  instrucao: typeof INSTRUCAO_CHAMAR_VITRINE;
} | null {
  if (!avaliacao || !('status' in avaliacao) || avaliacao.status !== 'pronta_sem_anuncio') {
    return null;
  }
  return {
    ok: true,
    status: 'enviado_sem_anuncio',
    paragrafos_de_anuncio_removidos: avaliacao.paragrafos_de_anuncio_removidos,
    instrucao: INSTRUCAO_CHAMAR_VITRINE,
  };
}
