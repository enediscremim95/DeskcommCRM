import {
  ORIGEM_INTERNA_DA_MENSAGEM,
  type LeadContextMessage,
} from '../edge/crm/get-lead-context';
import { paragrafosDaMensagem } from './dedupe-mensagem-turno';

export const JANELA_SEM_SAUDACAO_REPETIDA_MS = 12 * 60 * 60 * 1_000;

const ABERTURA = /^(?:ótim[oa]\s+(?:dia|tarde|noite)|bom\s+dia|boa\s+(?:tarde|noite)|oi|olá)(?=\s|[,!:.?-]|$)/iu;
const NOME_APOS_ABERTURA = /^\s*[,!:.-]?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}'-]{1,}(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}'-]{1,})?\s*[!,.:]/u;

function eSaudacaoDeAbertura(paragrafo: string): boolean {
  const abertura = ABERTURA.exec(paragrafo);
  if (!abertura) return false;
  const restante = paragrafo.slice(abertura[0].length);
  const semAcento = restante.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
  return NOME_APOS_ABERTURA.test(restante) || /\b(?:sou\s+(?:a|o)|como\s+vai)\b/.test(semAcento);
}

export function temMensagemRecenteDoAgente(
  mensagens: readonly LeadContextMessage[],
  agora: Date,
): boolean {
  const agoraMs = agora.getTime();
  return mensagens.some((mensagem) => {
    if (mensagem.direction !== 'outbound' || mensagem[ORIGEM_INTERNA_DA_MENSAGEM] !== 'ai') {
      return false;
    }
    const enviadaEm = Date.parse(mensagem.sent_at);
    const idade = agoraMs - enviadaEm;
    return Number.isFinite(enviadaEm) && idade >= 0 && idade <= JANELA_SEM_SAUDACAO_REPETIDA_MS;
  });
}

export type ResultadoFiltroSaudacao =
  | { status: 'duplicate_skipped'; body?: never; paragrafos_de_saudacao_removidos: number }
  | { status: 'pronta'; body: string; paragrafos_de_saudacao_removidos: number };

export function filtrarSaudacaoRepetida(args: {
  body: string;
  ativa: boolean;
  mensagens: readonly LeadContextMessage[];
  agora: Date;
  log: { warn: (message: string, fields: Record<string, unknown>) => void };
}): ResultadoFiltroSaudacao {
  if (!args.ativa || !temMensagemRecenteDoAgente(args.mensagens, args.agora)) {
    return { status: 'pronta', body: args.body, paragrafos_de_saudacao_removidos: 0 };
  }

  const recebidos = paragrafosDaMensagem(args.body);
  const permitidos = recebidos.filter((paragrafo) => !eSaudacaoDeAbertura(paragrafo));
  const removidos = recebidos.length - permitidos.length;
  if (removidos > 0) {
    args.log.warn('saudação repetida removida da mensagem', {
      paragrafos_recebidos: recebidos.length,
      paragrafos_enviados: permitidos.length,
      paragrafos_de_saudacao_removidos: removidos,
    });
  }
  if (permitidos.length === 0) {
    return { status: 'duplicate_skipped', paragrafos_de_saudacao_removidos: removidos };
  }
  return {
    status: 'pronta',
    body: permitidos.join('\n\n'),
    paragrafos_de_saudacao_removidos: removidos,
  };
}
