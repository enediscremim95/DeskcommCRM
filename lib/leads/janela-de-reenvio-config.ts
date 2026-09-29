/**
 * O primeiro corte medido em produção que separa o bloco curto do bloco diário.
 * Até 1 hora havia 63 pares; acima dela havia 56, distribuídos de horas a dias.
 */
export const JANELA_REENVIO_PADRAO_MINUTOS = 60;
export const JANELA_REENVIO_MIN_MINUTOS = 1;
export const JANELA_REENVIO_MAX_MINUTOS = 10_080;

export function minutosDaJanelaDeReenvio(settings: unknown): number {
  const bruto =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).lead_reentry_window_minutes
      : undefined;
  const numero = typeof bruto === "number" ? bruto : Number(bruto);
  if (!Number.isInteger(numero)) return JANELA_REENVIO_PADRAO_MINUTOS;
  return Math.min(JANELA_REENVIO_MAX_MINUTOS, Math.max(JANELA_REENVIO_MIN_MINUTOS, numero));
}
