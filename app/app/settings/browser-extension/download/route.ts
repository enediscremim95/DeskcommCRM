import type { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { criarPacoteDaExtensao } from "@/lib/browser-extension/package";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const authz = await requireRole("agent", { resource: "browser_extension" });
  if (!authz.ok) return authz.response;
  const bytes = criarPacoteDaExtensao(req.nextUrl.origin);
  const body = Uint8Array.from(bytes).buffer;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="apoio-whatsapp.zip"',
      "Cache-Control": "no-store",
    },
  });
}
