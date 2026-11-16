/**
 * Lista por agente de palavras/expressões que o modelo não pode mostrar ao
 * cliente. É deliberadamente menor que o detector de vocabulário interno: aqui
 * quem define o vocabulário é o dono do agente, e o default vazio não muda
 * nenhuma organização.
 */

function normalizar(texto: string): string {
  return texto
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/ /gu, '\\s+');
}

function ehCaractereDePalavra(caractere: string | undefined): boolean {
  return caractere !== undefined && /[\p{L}\p{N}_]/u.test(caractere);
}

/**
 * Casa palavra inteira ou expressão inteira, sem diferença de caixa/acento.
 * Ex.: `pessoa` casa `PESSÔA`, mas não casa `pessoal`.
 */
export function encontrarTermoProibido(
  corpo: string,
  termos: readonly string[],
): string | null {
  const corpoNormalizado = normalizar(corpo);
  if (corpoNormalizado === '') return null;

  for (const termoOriginal of termos) {
    const termo = normalizar(termoOriginal);
    if (termo === '') continue;
    const inicio = ehCaractereDePalavra(termo[0]) ? '(?<![\\p{L}\\p{N}_])' : '';
    const fim = ehCaractereDePalavra(termo.at(-1)) ? '(?![\\p{L}\\p{N}_])' : '';
    const re = new RegExp(`${inicio}${escaparRegExp(termo)}${fim}`, 'u');
    if (re.test(corpoNormalizado)) return termoOriginal;
  }
  return null;
}

export const ENSINO_TERMO_PROIBIDO =
  'Reescreva sem mencionar atendente, equipe, humano ou passagem para pessoa; ' +
  'fale como a dona da loja.';
