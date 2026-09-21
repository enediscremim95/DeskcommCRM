/**
 * Política de retenção do binário recebido pelos canais.
 *
 * É opt-in de propósito: configuração ausente, malformada ou `false` nunca
 * consome o Storage da instalação. Isso cobre organizações antigas e novas
 * sem backfill e sem uma segunda fonte de verdade.
 */
export const WHATSAPP_MEDIA_STORAGE_SETTING = "whatsapp_media_storage_enabled";
export const MEDIA_STATUS_NOT_STORED = "not_stored";

export function deveGuardarMidiaRecebida(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return false;
  }

  return (settings as Record<string, unknown>)[WHATSAPP_MEDIA_STORAGE_SETTING] === true;
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
