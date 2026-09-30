import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { BrowserExtensionSetup } from "./_components/BrowserExtensionSetup";

export const dynamic = "force-dynamic";

export default async function BrowserExtensionPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/inbox");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.agent) redirect("/403");

  return <BrowserExtensionSetup />;
}
