import { redirect } from "next/navigation";

import { userHasPermission } from "@/lib/auth/permissions";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ApiTokensClient } from "./_components/ApiTokensClient";
import { traduzir } from "@/lib/i18n/dicionario";
import { env } from "@/lib/env";
import { urlDoConectorMcp } from "@/lib/mcp/conexao";

export const dynamic = "force-dynamic";

export default async function ApiTokensPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || !userHasPermission(user, activeOrg, "settings.write")) {
    redirect("/403");
  }
  const canManage = !user.support && userHasPermission(user, activeOrg, "api.tokens.manage");
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">API Tokens</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Tokens server-to-server. Plaintext exibido", idioma)}{" "}
          <strong>{traduzir("uma única vez", idioma)}</strong>{" "}
          {traduzir("na criação.", idioma)}
        </p>
      </header>
      <ApiTokensClient
        connectorUrl={urlDoConectorMcp(env.NEXT_PUBLIC_APP_URL)}
        canManage={canManage}
      />
    </div>
  );
}
