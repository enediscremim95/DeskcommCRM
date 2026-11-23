import { computeCost } from "@/lib/ai/cost";

interface ComputeCostInput {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Preserva a régua inteira de ai_agent_runs e do limite por execução. */
export async function computeCostCents(input: ComputeCostInput): Promise<number> {
  return Math.ceil((await computeCost(input)) ?? 0);
}
