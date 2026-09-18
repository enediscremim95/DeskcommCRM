import { redirect } from "next/navigation";

import { WorkflowsClient } from "./_client";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { clientCanViewIntegration } from "@/lib/integrations/access";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "n8n" };

export default async function WorkflowsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (
    !(user.is_platform_admin && !user.support) &&
    !(await clientCanViewIntegration(createAdminClient(), activeOrg.orgId, "n8n"))
  ) redirect("/403");
  return <WorkflowsClient />;
}
