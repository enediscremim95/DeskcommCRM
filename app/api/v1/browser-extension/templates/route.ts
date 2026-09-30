import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autenticarExtensao } from "@/lib/browser-extension/auth";
import { comCorsDaExtensao, respostaPreflightDaExtensao } from "@/lib/browser-extension/cors";

export const dynamic = "force-dynamic";
export const OPTIONS = respostaPreflightDaExtensao;

export async function GET(req: NextRequest): Promise<Response> {
  const authn = await autenticarExtensao(req);
  if (!authn.ok) return comCorsDaExtensao(authn.response);
  const { admin, organizationId, userId } = authn.auth;
  const { data, error } = await admin
    .from("message_templates")
    .select("id, title, body, shortcut, owner_user_id, audio_storage_path, audio_file_name")
    .eq("organization_id", organizationId)
    .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
    .order("updated_at", { ascending: false });
  if (error) return comCorsDaExtensao(fail("internal_error", "Erro ao listar respostas.", 500));
  return comCorsDaExtensao(
    ok(
      (data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        shortcut: item.shortcut,
        shared: item.owner_user_id === null,
        has_audio: Boolean(item.audio_storage_path),
        audio_file_name: item.audio_file_name,
      })),
    ),
  );
}
