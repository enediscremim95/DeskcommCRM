import { PONTOS_DE_IA } from "@/lib/ai/pontos/registro";

export function pontosParaTrocaDeCredencial(): string[] {
  return PONTOS_DE_IA.filter(
    (ponto) => !ponto.fixo && !ponto.id.startsWith("followup_") &&
      !ponto.emissor.includes("/followup") && !ponto.exige.audio &&
      !ponto.exige.embeddingDims && ponto.papel !== "perceber",
  ).map((ponto) => ponto.id);
}

export interface PlanoDeCredencial {
  provider: string;
  revision: string;
  current_provider: string | null;
  current_model: string | null;
  models: { id: string; name: string }[];
  agents: { id: string; name: string; version_number: number; provider: string; model: string; operator_model: string | null }[];
  bindings: { id: string; purpose: string; provider: string; model: string; is_enabled: boolean; has_custom_endpoint: boolean }[];
  retained: string[];
}
