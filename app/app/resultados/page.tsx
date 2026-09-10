import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";

import { MetricsClient } from "../metrics/_components/MetricsClient";

export const dynamic = "force-dynamic";

export default async function ResultadosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const canCompare = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight">{t("Resultados")}</h1>
        <p className="text-sm text-muted-foreground">
          {canCompare
            ? t("Atrito, funil e performance por atendente nos últimos 30 dias.")
            : t("Atrito, seu funil e sua performance nos últimos 30 dias.")}
        </p>
      </header>
      <MetricsClient canCompare={canCompare} currentUserId={user.id} />
    </div>
  );
}
