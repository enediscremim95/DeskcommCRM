import { describe, expect, it } from "vitest";

import { versionCreateSchema } from "@/lib/ai/agents/validation";

const BASE = {
  provider: "anthropic" as const,
  model: "claude-sonnet-4-6",
  credential_id: "11111111-1111-4111-8111-111111111111",
  channel_session_id: "22222222-2222-4222-8222-222222222222",
};

describe("limite do system_prompt do agente", () => {
  it.each([
    [20_001, true],
    [32_000, true],
    [32_001, false],
  ])("aceita %i caracteres: %s", (length, success) => {
    expect(
      versionCreateSchema.safeParse({ ...BASE, system_prompt: "a".repeat(length) }).success,
    ).toBe(success);
  });
});
