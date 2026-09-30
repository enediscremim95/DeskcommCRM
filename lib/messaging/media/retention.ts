/**
 * Política de retenção do binário recebido pelos canais.
 *
 * É default-on para preservar o arquivo que chegou na conversa. Só o booleano
 * `false` desliga: organizações antigas, sem a chave, não podem cair no estado
 * em que toda foto/áudio/vídeo aparece como "arquivo não guardado".
 *
 * A superfície administrativa continua permitindo opt-out explícito quando a
 * instalação preferir economizar a cota compartilhada do Storage.
 */
export const WHATSAPP_MEDIA_STORAGE_SETTING = "whatsapp_media_storage_enabled";
export const MEDIA_STATUS_NOT_STORED = "not_stored";
export const MEDIA_DISCARD_REASON_KEY = "media_discard_reason";
export const MEDIA_DISCARD_REASON_RETENTION = "retention_expired";
export const MEDIA_DISCARD_REASON_CAP = "storage_cap_reached";

/**
 * Ritmo medido: 7,9 MB/dia com 2 clientes, ou 79 MB/dia projetados para 20.
 *
 * 21 dias guardam três semanas de contexto e projetam 1,659 GB. O teto de
 * 3,15 GB é 5% dos 63 GB que estavam livres no incidente de 29/09/2026 e
 * absorve quase 2× o volume esperado dentro da retenção. O aviso em 2,37 GB
 * equivale a 30 dias no ritmo projetado: há cerca de 10 dias para o expurgo
 * corrigir a curva antes do bloqueio de novos binários.
 */
export const WHATSAPP_MEDIA_RETENTION_DAYS_DEFAULT = 21;
export const WHATSAPP_MEDIA_STORAGE_CAP_BYTES_DEFAULT = 3_150_000_000;
export const WHATSAPP_MEDIA_STORAGE_ALERT_BYTES_DEFAULT = 2_370_000_000;

export function interpretarInteiroPositivo(
  bruto: string | undefined,
  padrao: number,
): number {
  const numero = Number((bruto ?? "").trim());
  return Number.isSafeInteger(numero) && numero > 0 ? numero : padrao;
}

export function deveGuardarMidiaRecebida(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return true;
  }

  return (settings as Record<string, unknown>)[WHATSAPP_MEDIA_STORAGE_SETTING] !== false;
}

export function midiaFoiDescartada(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  return (metadata as Record<string, unknown>).media_status === MEDIA_STATUS_NOT_STORED;
}

export function motivoDoDescarteDaMidia(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const motivo = (metadata as Record<string, unknown>)[MEDIA_DISCARD_REASON_KEY];
  return typeof motivo === "string" ? motivo : null;
}

export function cabeNoTetoDeMidia(
  ocupacaoAtualBytes: number,
  novoArquivoBytes: number,
  tetoBytes = WHATSAPP_MEDIA_STORAGE_CAP_BYTES_DEFAULT,
): boolean {
  if (![ocupacaoAtualBytes, novoArquivoBytes, tetoBytes].every(Number.isFinite)) return false;
  if (ocupacaoAtualBytes < 0 || novoArquivoBytes < 0 || tetoBytes <= 0) return false;
  return ocupacaoAtualBytes + novoArquivoBytes <= tetoBytes;
}

export function nomeDoArquivoDeMidia(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).media_filename;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
