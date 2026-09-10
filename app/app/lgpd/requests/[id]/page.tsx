import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { LgpdRequestDetail } from "./_client";
import { Voltar } from "@/components/navigation/Voltar";

export const dynamic = "force-dynamic";

export default async function LgpdRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);

  if (!activeOrg) redirect("/app");

  const isAllowed =
    (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;
  if (!isAllowed) redirect("/app");

  return (
    <div className="flex h-full flex-col gap-0 p-6">
      <Voltar href="/app/lgpd/requests" className="mb-4">LGPD</Voltar>
      <LgpdRequestDetail id={id} />
    </div>
  );
}
