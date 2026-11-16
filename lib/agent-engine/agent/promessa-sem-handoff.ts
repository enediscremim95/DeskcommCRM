/** Motivo estável gravado no handoff automático e na observabilidade. */
export const MOTIVO_HANDOFF_AUTOMATICO_NA_PROMESSA =
  'promessa_de_conferir_sem_passar';

/** Rastro mostrado pelo simulador, sem repetir o conteúdo da mensagem. */
export const RASTRO_HANDOFF_AUTOMATICO_NA_PROMESSA =
  'handoff_automatico_na_promessa';

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/gu, ' ')
    .trim();
}

const ACAO = String.raw`(?:conferir|confirmar|verificar|checar|ver)`;
const ALVO_HUMANO = String.raw`(?:equipe|producao|lorenza|time)`;
const INICIO_DE_PROMESSA = String.raw`(?:(?:ja\s+)?(?:vou|vamos)|deixa\s+eu|deixe\s+eu)`;
const RETORNO_PROMETIDO = String.raw`(?:ja\s+te\s+respondo|ja\s+respondo|te\s+retorno|ja\s+te\s+retorno)`;

const PROMESSA_COM_ALVO = [
  new RegExp(
    String.raw`\b${INICIO_DE_PROMESSA}\b.{0,100}\b${ACAO}\b.{0,100}\b${ALVO_HUMANO}\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b${INICIO_DE_PROMESSA}\b.{0,100}\b${ALVO_HUMANO}\b.{0,100}\b${ACAO}\b`,
    'u',
  ),
];

const PROMESSA_DE_RETORNO = [
  new RegExp(
    String.raw`\b${INICIO_DE_PROMESSA}\b.{0,100}\b${ACAO}\b.{0,100}\b${RETORNO_PROMETIDO}\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b(?:confirmar|conferir)\b.{0,80}\b(?:certinho|certo)\b.{0,80}\b${RETORNO_PROMETIDO}\b`,
    'u',
  ),
];

const NEGACAO_DA_PROMESSA = new RegExp(
  String.raw`\bnao\s+(?:(?:ja\s+)?(?:vou|vamos)|consigo|posso|irei|da\s+para|deixa\s+eu|deixe\s+eu)\b.{0,80}\b${ACAO}\b`,
  'u',
);
const RELATO_DE_TERCEIRO =
  /\b(?:voce|vc|cliente|ela|ele)\s+(?:disse|falou|perguntou|escreveu)\b/u;
const ACAO_JA_CONCLUIDA = [
  new RegExp(
    String.raw`\b${ALVO_HUMANO}\b.{0,50}\b(?:ja\s+)?(?:confirmou|conferiu|verificou|checou|viu)\b`,
    'u',
  ),
  new RegExp(
    String.raw`\b(?:ja\s+)?(?:confirmei|conferi|verifiquei|chequei|vi)\b.{0,50}\b${ALVO_HUMANO}\b`,
    'u',
  ),
];

/**
 * Detecta uma promessa EXPLÍCITA de conferir algo com a equipe e voltar ao lead.
 *
 * A função é deliberadamente conservadora: não tenta inferir intenção, só aceita
 * construções futuras com alvo humano ou retorno prometido. Pergunta repetida,
 * negação e confirmação já concluída são excluídas antes dos padrões positivos.
 */
export function promessaSemHandoff(texto: string): boolean {
  const frase = normalizar(texto);
  if (frase === '') return false;
  if (NEGACAO_DA_PROMESSA.test(frase)) return false;
  if (RELATO_DE_TERCEIRO.test(frase)) return false;
  if (ACAO_JA_CONCLUIDA.some((padrao) => padrao.test(frase))) return false;
  return [...PROMESSA_COM_ALVO, ...PROMESSA_DE_RETORNO].some((padrao) =>
    padrao.test(frase),
  );
}

export interface EstadoHandoffAutomaticoNaPromessa {
  mensagensEnviadas: string[];
  handoffRealizadoNesteTurno: boolean;
  fechamentoExecutado: boolean;
}

export function criarEstadoHandoffAutomaticoNaPromessa(): EstadoHandoffAutomaticoNaPromessa {
  return {
    mensagensEnviadas: [],
    handoffRealizadoNesteTurno: false,
    fechamentoExecutado: false,
  };
}

export function registrarMensagemParaHandoffAutomatico(
  estado: EstadoHandoffAutomaticoNaPromessa,
  mensagem: string,
): void {
  estado.mensagensEnviadas.push(mensagem);
}

export function registrarHandoffRealizadoNesteTurno(
  estado: EstadoHandoffAutomaticoNaPromessa,
): void {
  estado.handoffRealizadoNesteTurno = true;
}

export type DesfechoHandoffAutomaticoNaPromessa =
  | 'desligado'
  | 'sem_promessa'
  | 'handoff_ja_realizado'
  | 'conversa_ja_humana'
  | 'aplicado'
  | 'simulado'
  | 'ja_finalizado';

/**
 * Único fechamento do gancho, compartilhado pelo turno real e pelo sandbox.
 * O chamador fornece o efeito porque só o turno real pode tocar o banco; a
 * prévia registra um impedimento e nunca executa a rotina operacional.
 */
export async function concluirHandoffAutomaticoNaPromessa(args: {
  ativo: boolean;
  estado: EstadoHandoffAutomaticoNaPromessa;
  sandbox: boolean;
  conversaEmAtendimentoHumano: () => Promise<boolean>;
  aplicarHandoff: () => Promise<void>;
  registrarSandbox: (codigo: typeof RASTRO_HANDOFF_AUTOMATICO_NA_PROMESSA) => void;
  log: {
    info: (mensagem: string, campos: Record<string, unknown>) => void;
  };
}): Promise<DesfechoHandoffAutomaticoNaPromessa> {
  if (args.estado.fechamentoExecutado) return 'ja_finalizado';
  args.estado.fechamentoExecutado = true;
  if (!args.ativo) return 'desligado';
  if (args.estado.handoffRealizadoNesteTurno) return 'handoff_ja_realizado';

  const mensagensComPromessa = args.estado.mensagensEnviadas.filter(promessaSemHandoff).length;
  if (mensagensComPromessa === 0) return 'sem_promessa';
  if (await args.conversaEmAtendimentoHumano()) return 'conversa_ja_humana';

  const campos = {
    reason: MOTIVO_HANDOFF_AUTOMATICO_NA_PROMESSA,
    mensagens_enviadas: args.estado.mensagensEnviadas.length,
    mensagens_com_promessa: mensagensComPromessa,
  };
  if (args.sandbox) {
    args.registrarSandbox(RASTRO_HANDOFF_AUTOMATICO_NA_PROMESSA);
    args.log.info('handoff automático na promessa simulado', campos);
    return 'simulado';
  }

  await args.aplicarHandoff();
  args.estado.handoffRealizadoNesteTurno = true;
  args.log.info('handoff automático na promessa aplicado', campos);
  return 'aplicado';
}
