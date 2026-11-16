import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/event-log/dispatcher";

const sendAction = vi.hoisted(() => ({ execute: vi.fn(async () => ({ status: "success" })) }));
const state = vi.hoisted(() => ({ settings: {} as unknown, writes: [] as Array<{ table: string; patch: unknown }> }));
const email = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q = (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "in", "gte"]) chain[m] = () => chain;
      chain.update = (patch: unknown) => { state.writes.push({ table, patch }); return chain; };
      chain.maybeSingle = async () => ({ data: table === "organizations" ? { settings: state.settings } : null, error: null });
      chain.then = (r: (v: unknown) => unknown) => r({ data: null, error: null, count: 0 });
      return chain;
    };
    return { from: q };
  },
}));
vi.mock("@/lib/automation/engine", () => ({
  buildContext: async () => ({ lead: { id: "l1", source: "webhook", status: "open", contact_id: "c1", tags: [] }, contact: { id: "c1", phone_number: "5541999990000", email: "a@b.com" } }),
}));
vi.mock("@/lib/automation/actions", () => ({ getAction: () => sendAction }));
vi.mock("@/lib/automation/actions/register-all", () => ({}));
vi.mock("@/lib/email/organization-outreach", () => ({ sendOrganizationOutreach: email }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: async () => ({ ok: true }) }));

import { captureProactivityHandler } from "./capture.handler";

const CANAL = "11111111-1111-4111-8111-111111111111";
const row = (created: string): EventRow => ({ id: "e1", organization_id: "org-qualquer", event_type: "lead.created", entity_kind: "lead", entity_id: "l1", payload: {}, metadata: {}, consumed_by: [], attempts: 0, created_at: created } as EventRow);
const ligada = { capture_proactivity: { enabled: true, channel_session_id: CANAL } };

describe("captureProactivityHandler (envio simulado)", () => {
  beforeEach(() => { vi.useFakeTimers(); state.writes = []; sendAction.execute.mockClear(); email.mockClear(); });

  it("organização sem configuração (qualquer id) não envia nada", async () => {
    vi.setSystemTime(new Date("2026-11-16T15:00:00Z"));
    state.settings = {};
    const r = await captureProactivityHandler.handle(row("2026-11-16T14:00:00Z"));
    expect(r).toMatchObject({ status: "skipped", detail: "disabled" });
    expect(sendAction.execute).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
  });

  it("ligada, mas fora do horário comercial: adia e não envia", async () => {
    vi.setSystemTime(new Date("2026-11-16T22:00:00Z")); // 19h em São Paulo
    state.settings = ligada;
    const r = await captureProactivityHandler.handle(row("2026-11-16T21:00:00Z"));
    expect(r).toMatchObject({ status: "retry", detail: "outside_business_hours" });
    expect(sendAction.execute).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
  });

  it("ligada em horário comercial: tenta WhatsApp simulado sem mexer em etapa/status", async () => {
    vi.setSystemTime(new Date("2026-11-16T15:00:00Z"));
    state.settings = ligada;
    await captureProactivityHandler.handle(row("2026-11-16T14:00:00Z"));
    expect(sendAction.execute).toHaveBeenCalledTimes(1);
    for (const w of state.writes.filter((x) => x.table === "crm_leads")) {
      expect(Object.keys(w.patch as object)).toEqual(["tags"]);
    }
  });

  it("código do primeiro contato nunca escreve etapa nem status do negócio", () => {
    const src = ["capture.handler.ts", "capture-machine.ts", "capture-policy.ts"].map((f) => readFileSync(`${process.cwd()}/lib/proactivity/${f}`, "utf8")).join("\n");
    expect(src).not.toMatch(/stage_id|lost_reason|won_at|status:\s*["'](lost|won)/);
    expect(src).not.toMatch(/fn_mover|fn_juntar|move_lead/);
  });
});
