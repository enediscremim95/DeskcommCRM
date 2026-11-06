import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { validarMidiaDeAtalho } from "@/lib/messaging/media/channel-limits";

export interface FotoDoCatalogoParaEnvio {
  storage_path: string;
  mime_type: "image/jpeg" | "image/png";
  size_bytes: number;
}

export async function materializarFotoDoCatalogo(
  admin: SupabaseClient,
  orgId: string,
  conversationId: string,
  foto: FotoDoCatalogoParaEnvio,
): Promise<{ storagePath: string; mime: "image/jpeg" | "image/png"; sizeBytes: number }> {
  if (!foto.storage_path.startsWith(`${orgId}/`)) throw new Error("catalog_image_wrong_tenant");
  const { data: arquivo, error: downloadError } = await admin.storage
    .from("catalog-media")
    .download(foto.storage_path);
  if (downloadError || !arquivo) throw new Error("catalog_image_missing");
  const buffer = Buffer.from(await arquivo.arrayBuffer());
  const mime = foto.mime_type || (foto.storage_path.endsWith(".png") ? "image/png" : "image/jpeg");
  const verdict = validarMidiaDeAtalho(mime, buffer.length);
  if (!verdict.ok || verdict.kind !== "image") throw new Error("catalog_image_invalid");
  const storagePath = `${orgId}/${conversationId}/catalog-${randomUUID()}.${mime === "image/png" ? "png" : "jpg"}`;
  const { error: uploadError } = await admin.storage
    .from("whatsapp-media")
    .upload(storagePath, buffer, { contentType: mime, upsert: false });
  if (uploadError) throw new Error("catalog_image_upload_failed");
  return { storagePath, mime, sizeBytes: buffer.length };
}
