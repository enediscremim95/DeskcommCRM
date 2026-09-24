import type { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { autenticarExtensao } from "@/lib/browser-extension/auth";
import { comCorsDaExtensao, respostaPreflightDaExtensao } from "@/lib/browser-extension/cors";

export const dynamic = "force-dynamic";
export const OPTIONS = respostaPreflightDaExtensao;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authn = await autenticarExtensao(req);
  if (!authn.ok) return comCorsDaExtensao(authn.response);
  const { id } = await ctx.params;
  const { admin, organizationId, userId } = authn.auth;
  const { data } = await admin
    .from("message_templates")
    .select("audio_storage_path, owner_user_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
    .maybeSingle();
  if (!data?.audio_storage_path)
    return comCorsDaExtensao(fail("not_found", "Áudio não encontrado.", 404));
  const { data: blob, error } = await admin.storage
    .from("whatsapp-media")
    .download(data.audio_storage_path);
  if (error || !blob) return comCorsDaExtensao(fail("not_found", "Áudio não encontrado.", 404));
  return comCorsDaExtensao(
    new Response(await blob.arrayBuffer(), {
      headers: { "Content-Type": "audio/ogg; codecs=opus", "Cache-Control": "private, max-age=60" },
    }),
  );
}
