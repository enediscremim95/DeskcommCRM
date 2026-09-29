import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Origens que provam uma resposta humana.
 *
 * `user` nasce quando um atendente envia pelo painel. `external_device` nasce
 * quando o webhook recebe uma saída feita pelo celular. `crm` e `system` fazem
 * parte do vocabulário legado do banco, mas não provam, sozinhos, autoria
 * humana. `ai` e `automation` são explicitamente automáticos.
 *
 * Esta é a mesma classificação usada pela reatividade dos follow-ups. Mantê-la
 * num helper impede que cada motor invente uma definição diferente de humano.
 */
export const ORIGENS_DE_RESPOSTA_HUMANA = ["user", "external_device"] as const;

export function ehRespostaHumana(sentVia: string | null | undefined): boolean {
  return ORIGENS_DE_RESPOSTA_HUMANA.some((origem) => origem === sentVia);
}

/**
 * Confirma se um humano respondeu na conversa DEPOIS do evento que disparou a
 * automação. A comparação usa `created_at`, que é o relógio pedido pelo
 * contrato da regra, e não `sent_at` (campo de transporte/editável na origem).
 */
export async function houveRespostaHumanaDepoisDoEvento(
  admin: SupabaseClient,
  params: {
    organizationId: string;
    conversationId: string;
    eventCreatedAt: string;
  },
): Promise<boolean> {
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("conversation_id", params.conversationId)
    .eq("direction", "outbound")
    .in("sent_via", [...ORIGENS_DE_RESPOSTA_HUMANA])
    .gt("created_at", params.eventCreatedAt)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`human_reply_check_failed: ${error.message}`);
  return Boolean(data);
}
