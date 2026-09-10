import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relatório" };

export default async function RelatorioPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const admin = createAdminClient();
  const { data: organization } = await admin
    .from("organizations")
    .select("report_url")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  const reportUrl = organization?.report_url;

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Relatório</h1>
          <p className="text-sm text-muted-foreground">Acompanhe o desempenho que foi preparado para sua empresa.</p>
        </div>
        {reportUrl && <a className="inline-flex w-fit rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted" href={reportUrl} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a>}
      </header>
      {reportUrl ? (
        <iframe title="Relatório de desempenho" src={reportUrl} className="min-h-[70vh] w-full flex-1 rounded-md border bg-white" />
      ) : (
        <div className="rounded-md border p-6 text-sm">
          <p className="font-medium">Seu relatório ainda não foi configurado.</p>
          <p className="mt-1 text-muted-foreground">Peça à pessoa que administra sua conta para vincular o endereço do relatório.</p>
        </div>
      )}
    </div>
  );
}
