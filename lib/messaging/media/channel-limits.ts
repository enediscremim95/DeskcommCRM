/** Limites do WhatsApp oficial, usados também pelo BSP que transporta o canal. */
export const MAX_WHATSAPP_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_WHATSAPP_VIDEO_BYTES = 16 * 1024 * 1024;

export type MidiaDeAtalhoKind = "image" | "video";

type Resultado =
  | { ok: true; kind: MidiaDeAtalhoKind }
  | {
      ok: false;
      code: "unsupported_media_type" | "payload_too_large" | "validation_failed";
      message: string;
    };

/**
 * Valida o que pode ser guardado num atalho compartilhado.
 *
 * O transporte aceita URL, mas os limites pertencem ao canal. Validar antes do
 * upload evita guardar um arquivo que a plataforma recusará depois.
 */
export function validarMidiaDeAtalho(mime: string, sizeBytes: number): Resultado {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, code: "validation_failed", message: "Arquivo vazio." };
  }

  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base === "image/jpeg" || base === "image/png") {
    if (sizeBytes > MAX_WHATSAPP_IMAGE_BYTES) {
      return {
        ok: false,
        code: "payload_too_large",
        message: "A imagem precisa ter até 5 MB.",
      };
    }
    return { ok: true, kind: "image" };
  }

  if (base === "video/mp4" || base === "video/3gpp") {
    if (sizeBytes > MAX_WHATSAPP_VIDEO_BYTES) {
      return {
        ok: false,
        code: "payload_too_large",
        message: "O vídeo precisa ter até 16 MB.",
      };
    }
    return { ok: true, kind: "video" };
  }

  return {
    ok: false,
    code: "unsupported_media_type",
    message: "Use imagem JPEG/PNG ou vídeo MP4/3GPP.",
  };
}
