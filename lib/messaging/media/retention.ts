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

export function nomeDoArquivoDeMidia(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>).media_filename;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
