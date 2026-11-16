import { POUSO_PADRAO } from "@/lib/navigation/pouso";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { BrowserExtensionSetup } from "./_components/BrowserExtensionSetup";

export const dynamic = "force-dynamic";

export default async function BrowserExtensionPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect(POUSO_PADRAO);
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.agent) redirect("/403");

  return <BrowserExtensionSetup />;
}
