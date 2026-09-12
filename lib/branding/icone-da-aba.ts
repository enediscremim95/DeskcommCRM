/** Formas seguras que uma instalação pode escolher para o ícone da aba. */
export const ESTILOS_DE_ICONE_DA_ABA = ["letra", "atomo"] as const;

export type EstiloDoIconeDaAba = (typeof ESTILOS_DE_ICONE_DA_ABA)[number];

/** Banco antigo, valor ausente ou valor futuro degradam para o comportamento já existente. */
export function estiloDoIconeDaAba(valor: unknown): EstiloDoIconeDaAba {
  return valor === "atomo" ? "atomo" : "letra";
}
