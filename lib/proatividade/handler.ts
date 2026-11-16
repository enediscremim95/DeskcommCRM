import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow, HandlerResult, EventHandler } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { serviceForEvent } from "@/lib/atendimento/origem";
import { espacarEnvio } from "@/lib/automation/throttle";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { sendEmail } from "@/lib/email/resend";
import { CHANNEL_SESSION_REF_COLUMNS, type ChannelSessionRef } from "@/lib/channels";
import { validarTelefoneFormulario } from "@/lib/channels/telefone-formulario";
import { assertAgendaEffectSupabase } from "@/lib/agenda/efeito";
import { ATENCAO_CONTATO, lerProatividade } from "./config";
import { executarPasso, type Fase, type Tentativa, type Resultado } from "./fluxo";

const KEY = "form_proactivity";
function assertRead(error: { message: string } | null) {
  if (error) throw new Error("proactivity_storage_unavailable");
}
function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x]!,
  );
}

export async function processarFormulario(
  db: SupabaseClient,
  event: EventRow,
  now = new Date(),
): Promise<HandlerResult> {
  const result = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
    consumer_key: KEY,
    status,
    detail,
    ...(status === "retry" ? { retry_at: new Date(now.getTime() + 60_000).toISOString() } : {}),
  });
  const org = event.organization_id;
  const { data: organization, error: orgError } = await db
    .from("organizations")
    .select("settings, timezone")
    .eq("id", org)
    .maybeSingle();
  assertRead(orgError);
  const config = lerProatividade(organization?.settings);
  if (!config.enabled) return result("skipped", "disabled");
  const enabledAt = Date.parse(organization?.settings?.form_proactivity_enabled_at ?? "");
  // Ligar não dispara backlog histórico. Data vem do servidor na ação de configuração.
  if (!Number.isFinite(enabledAt) || !event.created_at || Date.parse(event.created_at) < enabledAt)
    return result("skipped", "before_enable");
  const { data: lead, error: leadError } = await db
    .from("crm_leads")
    .select("id,contact_id,status,source,source_metadata,created_at,tags")
    .eq("organization_id", org)
    .eq("id", event.entity_id)
    .maybeSingle();
  assertRead(leadError);
  // A fonte verificável é a captação vinculada ao card; nunca aplica a importações/manuais.
  if (!lead || !lead.source_metadata?.webhook_source_id) return result("skipped", "not_form");
  if (!lead.contact_id) {
    const { error } = await db.rpc("fn_form_proactivity_attention", {
      p_org: org,
      p_lead: lead.id,
      p_tag: ATENCAO_CONTATO,
    });
    assertRead(error);
    return result("ok", "missing_contact");
  }
  const { data: attempts, error: attemptError } = await db
    .from("form_proactivity_attempts")
    .select("phase,outcome,created_at")
    .eq("organization_id", org)
    .eq("lead_id", lead.id);
  assertRead(attemptError);
  if (
    config.channel_session_id &&
    (attempts ?? []).length < 2 &&
    !(attempts ?? []).some((a) => a.outcome === "sent")
  ) {
    const retryAt = await adiarAteAJanelaAbrir(db, org, config.channel_session_id, now);
    if (retryAt) return { ...result("retry"), retry_at: retryAt };
  }
  const contactId = lead.contact_id as string;
  const loadContact = async () => {
    const { data, error } = await db
      .from("contacts")
      .select(
        "id,phone_number,email,is_blocked,is_anonymized,is_merged_into,consent,source_metadata",
      )
      .eq("organization_id", org)
      .eq("id", contactId)
      .maybeSingle();
    assertRead(error);
    return data;
  };
  const eligible = async () => {
    const [{ data: o, error: oe }, { data: l, error: le }, c, { data: messages, error: me }] =
      await Promise.all([
        db.from("organizations").select("settings").eq("id", org).maybeSingle(),
        db
          .from("crm_leads")
          .select("status,contact_id")
          .eq("organization_id", org)
          .eq("id", lead.id)
          .maybeSingle(),
        loadContact(),
        db
          .from("messages")
          .select("id,direction,status,created_at")
          .eq("organization_id", org)
          .eq("contact_id", contactId)
          .or(
            `direction.eq.inbound,and(direction.eq.outbound,created_at.gte.${lead.created_at},status.neq.failed)`,
          )
          .limit(1),
      ]);
    [oe, le, me].forEach(assertRead);
    return (
      lerProatividade(o?.settings).enabled &&
      l?.status === "open" &&
      l.contact_id === contactId &&
      !!c &&
      !c.is_blocked &&
      !c.is_anonymized &&
      !c.is_merged_into &&
      !c.consent?.marketing?.declined_at &&
      messages?.length === 0
    );
  };
  const out = await executarPasso(
    config,
    organization?.timezone ?? "America/Sao_Paulo",
    (attempts ?? []) as Tentativa[],
    {
      elegivel: eligible,
      reservar: async (phase: Fase) => {
        const { error } = await db
          .from("form_proactivity_attempts")
          .insert({ organization_id: org, lead_id: lead.id, phase });
        if (error?.code === "23505") return false;
        assertRead(error);
        return true;
      },
      concluir: async (phase: Fase, outcome: Resultado) => {
        const { error } = await db
          .from("form_proactivity_attempts")
          .update({ outcome, completed_at: new Date().toISOString() })
          .eq("organization_id", org)
          .eq("lead_id", lead.id)
          .eq("phase", phase);
        assertRead(error);
      },
      atencao: async () => {
        // RPC concatena a tag atomicamente para não sobrescrever edição humana concorrente.
        const { error } = await db.rpc("fn_form_proactivity_attention", {
          p_org: org,
          p_lead: lead.id,
          p_tag: ATENCAO_CONTATO,
        });
        assertRead(error);
      },
      enviar: async (phase: Fase) => {
        let contact = await loadContact();
        if (!contact) return "failed";
        await assertAgendaEffectSupabase(db, { organizationId: org, contactId });
        if (phase === "email") {
          if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return "failed";
          const r = await sendEmail({
            to: contact.email,
            subject: config.email_subject,
            text: config.email_text,
            html: `<p>${escapeHtml(config.email_text).replace(/\n/g, "<br>")}</p>`,
            idempotencyKey: `form:${org}:${lead.id}:email`,
          });
          // Falha de rede pode esconder aceite do provedor; não reenvia automaticamente.
          return r.ok
            ? "sent"
            : r.error === "not_configured" || r.error === "dominio_nao_verificado"
              ? "failed"
              : "uncertain";
        }
        if (!contact.phone_number || !config.channel_session_id) return "failed";
        const { data: session, error: se } = await db
          .from("channel_sessions")
          .select(`id,status,${CHANNEL_SESSION_REF_COLUMNS}`)
          .eq("organization_id", org)
          .eq("id", config.channel_session_id)
          .maybeSingle();
        assertRead(se);
        if (!session || session.status !== "WORKING") return "failed";
        if (phase === "whatsapp_corrigido") {
          let corrected: string | null;
          try {
            corrected = await validarTelefoneFormulario(
              contact.phone_number,
              session as unknown as ChannelSessionRef,
            );
          } catch {
            return "failed";
          }
          if (!corrected) return "failed";
          // Correção validada mantém o original no cadastro, sem apagar histórico.
          if (corrected !== contact.phone_number) {
            const { error } = await db
              .from("contacts")
              .update({
                phone_number: corrected,
                source_metadata: {
                  ...contact.source_metadata,
                  form_original_phone: contact.phone_number,
                },
              })
              .eq("organization_id", org)
              .eq("id", contactId)
              .eq("phone_number", contact.phone_number);
            if (error) return "failed";
            contact = await loadContact();
          }
        }
        if (!(await eligible())) return "failed";
        const boundary = await serviceForEvent(
          db,
          org,
          event.id,
          contactId,
          config.channel_session_id,
        );
        if (!boundary) return "failed";
        await espacarEnvio(config.channel_session_id);
        const message = await sendMessageHandler(
          db,
          {
            organization_id: org,
            serviceBoundary: boundary,
            proactiveContext: { organizationId: org, contactId },
            actor: { type: "webhook_source", id: KEY },
            requestId: `form:${lead.id}:${phase}`,
          },
          { conversation_id: boundary.conversation_id, type: "text", body: config.whatsapp_text },
        );
        if (
          message.status === "failed" &&
          /timeout|timed out|fetch failed|ECONNRESET|abort/i.test(message.error_message ?? "")
        )
          return "uncertain";
        return ["sent", "delivered", "read"].includes(message.status)
          ? "sent"
          : message.status === "failed"
            ? "failed"
            : "uncertain";
      },
    },
    now,
  );
  return result(out === "retry" ? "retry" : "ok");
}
export const formProactivityHandler: EventHandler = {
  key: KEY,
  events: ["lead.created"],
  handle: (row) => processarFormulario(createAdminClient(), row),
};
