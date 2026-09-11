/** Decide se o silêncio é anormal para a cadência desta sessão. */
const AMOSTRA_MINIMA = 12;
const JANELA_DIAS = 30;
const PISO_MS = 45 * 60_000;
const TETO_MS = 7 * 24 * 60 * 60_000;

export interface DiagnosticoDeSilencio {
  deveAvisar: boolean;
  limiarMs: number | null;
  amostra: number;
}

function percentil90(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.ceil(ordenados.length * 0.9) - 1] ?? 0;
}

export function diagnosticarSilencioInbound(entradas: readonly string[], agora = new Date()): DiagnosticoDeSilencio {
  const inicio = agora.getTime() - JANELA_DIAS * 24 * 60 * 60_000;
  const instantes = entradas.map((valor) => new Date(valor).getTime())
    .filter((valor) => Number.isFinite(valor) && valor >= inicio && valor <= agora.getTime())
    .sort((a, b) => a - b);
  if (instantes.length < AMOSTRA_MINIMA) return { deveAvisar: false, limiarMs: null, amostra: instantes.length };
  const intervalos = instantes.slice(1).map((valor, indice) => valor - instantes[indice]!);
  const limiarMs = Math.min(TETO_MS, Math.max(PISO_MS, percentil90(intervalos) * 3));
  return { deveAvisar: agora.getTime() - instantes.at(-1)! > limiarMs, limiarMs, amostra: instantes.length };
}
