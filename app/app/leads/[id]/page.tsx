import { notFound } from "next/navigation";

import { LeadPageClient } from "@/components/leads/LeadPageClient";
import { Voltar } from "@/components/navigation/Voltar";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types/leads";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) notFound();

  const { id } = await params;
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();

  if (!lead?.pipeline_id) notFound();

  const [pipelineResult, stageResult, contactResult, conversationResult, channelResult] =
    await Promise.all([
      supabase
        .from("crm_pipelines")
        .select("id, name, settings")
        .eq("organization_id", activeOrg.orgId)
        .eq("id", lead.pipeline_id)
        .maybeSingle(),
      supabase
        .from("crm_stages")
        .select("id, name")
        .eq("organization_id", activeOrg.orgId)
        .eq("id", lead.stage_id)
        .maybeSingle(),
      lead.contact_id
        ? supabase
            .from("contacts")
            .select("id, display_name, name, phone_number, email")
            .eq("organization_id", activeOrg.orgId)
            .eq("id", lead.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      lead.contact_id
        ? supabase
            .from("conversations")
            .select("id, channel_session_id")
            .eq("organization_id", activeOrg.orgId)
            .eq("contact_id", lead.contact_id)
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      listSelectableChannels(supabase, activeOrg.orgId),
    ]);

  const pipeline = pipelineResult.data;
  if (!pipeline) notFound();

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Voltar href={`/app/pipelines/${lead.pipeline_id}`}>Voltar ao funil</Voltar>
      <LeadPageClient
        key={lead.updated_at}
        lead={lead as Lead}
        pipelineName={pipeline.name}
        stageName={stageResult.data?.name ?? "Etapa não informada"}
        fieldDefs={camposDoFunil(pipeline.settings ?? null)}
        contact={contactResult.data}
        conversationId={conversationResult.data?.id ?? null}
        hasConnectedChannel={channelResult.some((channel) => channel.status === "WORKING")}
        canReplyInConversation={channelResult.some(
          (channel) =>
            channel.status === "WORKING" &&
            channel.id === conversationResult.data?.channel_session_id,
        )}
      />
    </div>
  );
}
