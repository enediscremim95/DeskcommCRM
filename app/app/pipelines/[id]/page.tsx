import { notFound, redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PipelinePageClient } from "./_client";
import { Voltar } from "@/components/navigation/Voltar";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const { id } = await params;
  const supabase = await createClient();
  // Mesma razão da Agenda: a RLS é piso, não escopo. Sem este filtro o funil de
  // OUTRA organização do mesmo usuário abre, e o quadro monta com as etapas de
  // um lugar e o cabeçalho de outro.
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id, name, vocabulary")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) notFound();
  return (
    <div className="flex min-h-[640px] flex-col gap-4 p-6">
      <div className="shrink-0">
        <Voltar href="/app/settings/tenant/pipelines">Funis</Voltar>
      </div>
      <div className="min-h-0 flex-1">
        <PipelinePageClient pipelineId={id} initialName={pipeline.name} />
      </div>
    </div>
  );
}
