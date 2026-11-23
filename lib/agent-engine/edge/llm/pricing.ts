/**
 * Tarifas de contingência do Claude em centavos de dólar por milhão de tokens.
 * Fonte: https://docs.claude.com/en/docs/about-claude/pricing (conferida 2026-07).
 * Escrita usa o TTL de 1h adotado pelo motor.
 */
const PRECOS_CLAUDE = [
  { prefixo: 'claude-sonnet-4', input: 300, output: 1500, cacheRead: 30, cacheWrite: 600 },
  { prefixo: 'claude-haiku-4', input: 100, output: 500, cacheRead: 10, cacheWrite: 200 },
  { prefixo: 'claude-opus-4', input: 1500, output: 7500, cacheRead: 150, cacheWrite: 3000 },
];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function precoClaude(model: string) {
  return PRECOS_CLAUDE.find(({ prefixo }) => model.startsWith(prefixo));
}
