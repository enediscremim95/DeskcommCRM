import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { ConexoesShell } from "@/components/connections/ConexoesShell";
import { traduzir } from "@/lib/i18n/dicionario";
import { clientCanViewIntegration } from "@/lib/integrations/access";
import { partnerSessionInUse } from "@/lib/channels/connect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { lerEscolhaDaOrg } from "@/lib/voice/guarda";
import { chamadaDeVozLigada } from "@/lib/voice/opt-in";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  if (
    !(user.is_platform_admin && !user.support) &&
    !(await clientCanViewIntegration(createAdminClient(), activeOrg.orgId, "whatsapp"))
  ) redirect("/403");
  const idioma = user.idioma;

  const key = process.env.WAHA_API_KEY;
  const wahaConfigured = Boolean(
    process.env.WAHA_API_BASE_URL && key && key !== "dev_plaintext_change_me",
  );
  const wacallsConfigured = Boolean(process.env.WACALLS_API_BASE_URL);
  const admin = createAdminClient();
  const db = await createClient();

  // Se uma leitura falhar, mantemos a porta visível. Esconder em estado
  // indeterminado poderia deixar uma conexão já usada sem caminho de volta.
  let parceiroEmUso = true;
  let vozEmUso = true;
  try {
    parceiroEmUso = await partnerSessionInUse(admin, activeOrg.orgId);
  } catch (error) {
    logger.warn("[connections] estado do canal parceiro ficou indeterminado", {
      organization_id: activeOrg.orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    parceiroEmUso = true;
  }
  try {
    const { escolha } = await lerEscolhaDaOrg(db, activeOrg.orgId);
    vozEmUso = chamadaDeVozLigada(escolha, wacallsConfigured);
  } catch (error) {
    logger.warn("[connections] estado da chamada de voz ficou indeterminado", {
      organization_id: activeOrg.orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    vozEmUso = true;
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Conexões", idioma)}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Por onde seu negócio fala com o cliente. Conecte números por QR ou o número oficial da Meta, e acompanhe a saúde de cada um.",
            idioma,
          )}
        </p>
      </header>
      <ConexoesShell
        wahaConfigured={wahaConfigured}
        wacallsConfigured={wacallsConfigured}
        parceiroEmUso={parceiroEmUso}
        vozEmUso={vozEmUso}
      />
    </div>
  );
}
