import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import {
  resumirOrigens,
  type LinhaDeCaptacaoParaResumo,
} from "@/lib/webhooks/resumo-origens";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "webhook_sources" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const supabase = await createClient();

  const { data: fonte, error: fonteErro } = await supabase
    .from("webhook_sources")
    .select("id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (fonteErro) return fail("internal_error", fonteErro.message, 500, { requestId });
  if (!fonte) return fail("not_found", t("Fonte não encontrada."), 404, { requestId });

  const desde = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const linhas: LinhaDeCaptacaoParaResumo[] = [];
  const tamanhoDaPagina = 1_000;
  for (let inicio = 0; ; inicio += tamanhoDaPagina) {
    const { data, error } = await supabase
      .from("webhook_lead_captures")
      .select("utm, fields, origin")
      .eq("organization_id", authz.org.orgId)
      .eq("webhook_source_id", id)
      .eq("outcome", "criado")
      .gte("received_at", desde)
      .order("received_at", { ascending: true })
      .range(inicio, inicio + tamanhoDaPagina - 1);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    const pagina = (data ?? []) as LinhaDeCaptacaoParaResumo[];
    linhas.push(...pagina);
    if (pagina.length < tamanhoDaPagina) break;
  }

  return ok(resumirOrigens(linhas), { requestId });
}
