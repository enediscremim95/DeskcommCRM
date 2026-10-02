import type { LoseLeadInput } from "@/lib/schemas/leads";

const ROTULOS_DOS_MOTIVOS = {
  requested_by_customer: "Cliente solicitou cancelamento",
  price: "Preço",
  no_response: "Sem resposta do cliente",
  product_unavailable: "Produto indisponível",
  cancelled_by_store: "Cancelado pela loja",
  cancelled_by_customer: "Cancelado pelo cliente",
  payment_failed: "Falha no pagamento",
  other: "Outro motivo",
} as const;

type Traduz = (texto: string) => string;

/**
 * Monta o contrato da rota sem confundir categoria com texto livre.
 * O detalhe só pertence a `other`; trocar de opção antes de confirmar não
 * deixa o texto digitado vazar para outra categoria.
 */
export function entradaDePerda(
  motivo: string,
  detalhe: string,
): LoseLeadInput {
  const detalheLimpo = motivo === "other" ? detalhe.trim() : "";
  return {
    lost_reason: motivo === "other" ? "other" : motivo,
    lost_reason_detail: detalheLimpo || null,
  };
}

/**
 * Leitura única para as duas fichas. Motivos legados ou configurados no funil
 * continuam aparecendo literalmente; só os códigos canônicos ganham rótulo.
 */
export function motivoDaPerdaLegivel(
  motivo: string | null,
  detalhe: string | null,
  t: Traduz,
): string | null {
  if (!motivo?.trim()) return null;
  const motivoLimpo = motivo.trim();
  const rotulo =
    motivoLimpo in ROTULOS_DOS_MOTIVOS
      ? t(ROTULOS_DOS_MOTIVOS[motivoLimpo as keyof typeof ROTULOS_DOS_MOTIVOS])
      : motivoLimpo;
  const detalheLimpo = detalhe?.trim();
  return detalheLimpo ? `${rotulo}: ${detalheLimpo}` : rotulo;
}
