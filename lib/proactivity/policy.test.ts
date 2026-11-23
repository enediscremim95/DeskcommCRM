import { describe, expect, it } from "vitest";
import { proactiveDecision, proactivePolicy, proactivePolicySchema } from "./policy";
const now = new Date("2026-11-16T15:00:00Z");
const input = { now, lastInbound: "2026-11-16T14:00:00Z", attempts: 0 };
describe("follow-up proativo por organização", () => {
 it.each([undefined, {}, { proactive_followup: { enabled: "true" } }])("ausente ou inválido permanece desligado", (settings) => expect(proactiveDecision(proactivePolicy(settings), input)).toBe("disabled"));
 it("a escolha de uma organização não habilita outra", () => {
  expect(proactiveDecision(proactivePolicy({ proactive_followup: { enabled: true } }), input)).toBeNull();
  expect(proactiveDecision(proactivePolicy({}), input)).toBe("disabled");
 });
 it.each([null, "invalid", "2026-11-15T15:00:00Z", "2026-11-16T16:00:00Z"])("não envia fora de 24h: %s", (lastInbound) => expect(proactiveDecision(proactivePolicySchema.parse({ enabled: true }), { ...input, lastInbound })).toBe("outside_whatsapp_window"));
 it("limita tentativas e horário comercial no fuso da org", () => {
  const p = proactivePolicySchema.parse({ enabled: true });
  expect(proactiveDecision(p, { ...input, attempts: 2 })).toBe("attempt_limit");
  expect(proactiveDecision(p, { ...input, now: new Date("2026-11-16T22:00:00Z") })).toBe("outside_business_hours");
  expect(proactiveDecision(p, { now: new Date("2026-11-15T15:00:00Z"), lastInbound: "2026-11-15T14:00:00Z", attempts: 0 })).toBe("outside_business_hours");
 });
});
