import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { pontosParaTrocaDeCredencial } from "@/lib/ai/credenciais/padrao";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

type Contexto = { params: Promise<{ id: string }> };

const confirmacao = z.strictObject({
  model_id: z.string().trim().min(1).max(120),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function GET(_request: Request, context: Contexto) {
  return processar(context);
}

export async function POST(request: Request, context: Contexto) {
  const recusado = await requireSupportWrite();
  if (recusado) return recusado;
  return processar(context, request);
}

async function processar(context: Contexto, request?: Request) {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "ai_credentials" });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  let escolha: z.infer<typeof confirmacao> | undefined;
  if (request) {
    const parsed = confirmacao.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
    escolha = parsed.data;
  }

  const { data, error } = await createAdminClient().rpc("fn_usar_credencial_ia_padrao", {
    p_org_id: auth.org.orgId,
    p_actor_id: auth.user.id,
    p_credential_id: id.data,
    p_purposes: pontosParaTrocaDeCredencial(),
    p_request_id: requestId,
    ...(escolha && { p_model_id: escolha.model_id, p_revision: escolha.revision }),
  });
  if (!error) return ok(data, { requestId });

  if (error.message === "forbidden") {
    return fail("forbidden", t("Somente o dono ou um administrador pode trocar a chave padrão."), 403, { requestId });
  }
  if (error.code === "23505" || error.message === "plan_changed") {
    return fail("conflict", t("A configuração mudou. Abra a confirmação novamente."), 409, { requestId });
  }
  if (error.message === "credential_not_usable" || error.message === "model_not_found") {
    return fail("validation_failed", t("Valide uma chave própria e escolha um modelo disponível para ela."), 422, { requestId });
  }
  if (error.message === "channel_session_offline" || error.message === "channel_session_not_found") {
    return fail("conflict", t("Conecte o canal dos agentes publicados antes de trocar a chave padrão."), 409, { requestId });
  }

  logger.error("Falha na troca da credencial padrão de IA", {
    organization_id: auth.org.orgId, request_id: requestId, codigo: error.code,
  });
  return fail("internal_error", t("Não foi possível consultar ou trocar a chave padrão."), 500, { requestId });
}
