import {
  CANONICAL_LOST_REASONS,
  type LoseLeadInput,
} from "@/lib/schemas/leads";

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

export interface OpcaoDeMotivoDaPerda {
  value: string;
  label: string;
}

/** Lê a lista configurada no funil sem confiar na forma do jsonb. */
export function motivosDePerdaConfigurados(settings: unknown): string[] {
  if (!settings || typeof settings !== "object") return [];
  const motivos = (settings as { lost_reasons?: unknown }).lost_reasons;
  if (!Array.isArray(motivos)) return [];
  return motivos.filter(
    (motivo): motivo is string => typeof motivo === "string" && motivo.length > 0,
  );
}

/** Lista do funil quando existe; caso contrário, a lista canônica atual. */
export function opcoesDeMotivoDaPerda(
  motivosConfigurados?: readonly string[] | null,
): OpcaoDeMotivoDaPerda[] {
  const motivos = motivosConfigurados?.length
    ? motivosConfigurados
    : CANONICAL_LOST_REASONS;
  return motivos.map((motivo) => ({
    value: motivo,
    label:
      motivo in ROTULOS_DOS_MOTIVOS
        ? ROTULOS_DOS_MOTIVOS[motivo as keyof typeof ROTULOS_DOS_MOTIVOS]
        : motivo,
  }));
}

/** `other` legado e os rótulos configuráveis equivalentes pedem detalhe. */
export function motivoPedeDetalhe(motivo: string): boolean {
  const normalizado = motivo
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ");
  return (
    normalizado === "other" || normalizado === "outro" || normalizado === "outro motivo"
  );
}

/**
 * Monta o contrato da rota sem confundir categoria com texto livre.
 * O detalhe só pertence a `other`; trocar de opção antes de confirmar não
 * deixa o texto digitado vazar para outra categoria.
 */
export function entradaDePerda(
  motivo: string,
  detalhe: string,
): LoseLeadInput {
  const detalheLimpo = motivoPedeDetalhe(motivo) ? detalhe.trim() : "";
  return {
    lost_reason: motivo,
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
