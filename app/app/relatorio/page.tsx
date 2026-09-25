import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientCanViewIntegration } from "@/lib/integrations/access";

import { RelatorioClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relatório" };

export default async function RelatorioPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const admin = createAdminClient();
  const [{ data: organization }, { data: nativeConfig }, canViewWindsor] = await Promise.all([
    admin
      .from("organizations")
      .select("report_url")
      .eq("id", activeOrg.orgId)
      .maybeSingle(),
    admin
      .from("traffic_dashboard_configs" as never)
      .select("organization_id")
      .eq("organization_id", activeOrg.orgId)
      .eq("enabled", true)
      .maybeSingle(),
    clientCanViewIntegration(admin, activeOrg.orgId, "windsor"),
  ]);

  // O relatório nativo habilitado é a fonte de verdade. Uma permissão antiga ou
  // inconsistente não pode expulsar o cliente de uma tela que já está ativa.
  if (!(user.is_platform_admin && !user.support) && !nativeConfig && !canViewWindsor) {
    redirect("/403");
  }

  // O texto da tela vive no componente cliente: `useT()` é hook de contexto e
  // não existe aqui. Ver o cabeçalho de `_client.tsx`.
  return <RelatorioClient
    reportUrl={(organization?.report_url as string | null) ?? null}
    nativeConfigured={Boolean(nativeConfig)}
  />;
}
