/**
 * Ritmo humano das mensagens fixas disparadas por `automation_rules`.
 *
 * Este módulo só calcula tempo. Ele nunca dorme: o motor persiste o cursor no
 * `event_log` e devolve `retry_at`, deixando o worker e a rota cron livres para
 * processar outros eventos durante esperas de dezenas de segundos.
 *
 * Fórmula portada do fluxo N8N aprovado pelo dono do produto:
 *   - antes da primeira mensagem: 40–100s;
 *   - por mensagem: (20s + 0,6s por caractere) × variação de 0,9 a 1,2;
 *   - "digitando": 45% do alvo, limitado a 3–15s;
 *   - restante: pausa silenciosa depois do envio, antes da próxima mensagem.
 */

export const ESPERA_INICIAL_MIN_MS = 40_000;
export const ESPERA_INICIAL_AMPLITUDE_MS = 60_000;
export const TEMPO_BASE_MENSAGEM_MS = 20_000;
export const TEMPO_POR_CARACTERE_MS = 600;
export const VARIACAO_MINIMA = 0.9;
export const VARIACAO_AMPLITUDE = 0.3;
export const DIGITANDO_FRACAO = 0.45;
export const DIGITANDO_MIN_MS = 3_000;
export const DIGITANDO_MAX_MS = 15_000;

/** Chave privada do motor dentro de `event_log.metadata`. */
export const RITMO_HUMANO_METADATA_KEY = "automation_human_pacing_v1";

export interface PlanoRitmoHumano {
  alvo_ms: number;
  digitando_ms: number;
  restante_ms: number;
}

function aleatorioNormalizado(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

/** Espera antes da primeira mensagem da regra. */
export function calcularEsperaInicialMs(aleatorio = Math.random()): number {
  const r = aleatorioNormalizado(aleatorio);
  return Math.floor(ESPERA_INICIAL_MIN_MS + r * ESPERA_INICIAL_AMPLITUDE_MS);
}

/** Plano completo de UMA mensagem, sem relógio e sem efeito colateral. */
export function calcularPlanoRitmoHumano(
  tamanhoDoTexto: number,
  aleatorio = Math.random(),
): PlanoRitmoHumano {
  const tamanho = Math.max(0, Math.floor(Number.isFinite(tamanhoDoTexto) ? tamanhoDoTexto : 0));
  const variacao = VARIACAO_MINIMA + aleatorioNormalizado(aleatorio) * VARIACAO_AMPLITUDE;
  const alvo = Math.round((TEMPO_BASE_MENSAGEM_MS + tamanho * TEMPO_POR_CARACTERE_MS) * variacao);
  const digitando = Math.min(
    DIGITANDO_MAX_MS,
    Math.max(DIGITANDO_MIN_MS, Math.round(alvo * DIGITANDO_FRACAO)),
  );
  return {
    alvo_ms: alvo,
    digitando_ms: digitando,
    restante_ms: Math.max(0, alvo - digitando),
  };
}

/** Converte uma duração em reagendamento durável. Não cria timer. */
export function reagendarEm(duracaoMs: number, agoraMs = Date.now()): string {
  return new Date(agoraMs + Math.max(0, Math.floor(duracaoMs))).toISOString();
}

