import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { userHasPermission } from "@/lib/auth/permissions";
import { traduzir } from "@/lib/i18n/dicionario";
import { InviteForm } from "./_components/InviteForm";

export const dynamic = "force-dynamic";

export default async function TeamInvitePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!userHasPermission(user, activeOrg, "team.manage")) {
    redirect("/403");
  }
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Convidar membros")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Cole até 20 emails (um por linha) e escolha a role compartilhada.")}
        </p>
      </header>
      <InviteForm />
    </div>
  );
}
