import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** Janela aprovada para relacionar uma captação recente à primeira conversa. */
export const JANELA_RECONCILIACAO_WHATSAPP_DIAS = 7;

export type ResultadoReconciliacaoWhatsapp = {
  outcome: "none" | "suggestion" | "merged";
  contact_id: string;
  form_contact_id?: string;
  merge_queue_id?: string;
  telefone_original_formulario?: string | null;
  motivo?: "multiplos_candidatos" | "nome_incompativel";
};

/**
 * Tenta reconciliar somente o contato que acabou de nascer no WhatsApp.
 *
 * A seleção, a lápide, o repontamento e o registro reversível vivem na mesma
 * transação da RPC. A aplicação não lê e depois decide, porque duas mensagens
 * simultâneas poderiam escolher o mesmo cadastro do formulário.
 */
export async function reconciliarContatoWhatsappComFormulario(
  admin: Admin,
  input: {
    organizationId: string;
    whatsappContactId: string;
    externalMessageId: string;
  },
): Promise<ResultadoReconciliacaoWhatsapp | null> {
  const { data, error } = await admin.rpc(
    "fn_reconciliar_contato_whatsapp_formulario" as never,
    {
      p_organization_id: input.organizationId,
      p_contato_whatsapp: input.whatsappContactId,
      p_external_message_id: input.externalMessageId,
      p_janela_dias: JANELA_RECONCILIACAO_WHATSAPP_DIAS,
    } as never,
  );

  if (error) return null;
  return data as unknown as ResultadoReconciliacaoWhatsapp;
}
