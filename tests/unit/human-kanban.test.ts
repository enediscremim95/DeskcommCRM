import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { requireHumanKanban } from "@/lib/leads/human-kanban";
import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { encerraDemanda } from "@/lib/leads/encerramento";
import { reabreLead } from "@/lib/leads/reabertura";
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

describe("fronteira humana do Kanban", () => {
  it.each(["org-a", "org-b"].flatMap(org => (["ai_agent", "webhook_source"] as const).map(type => ({org,type}))))("$type não move, ganha, perde ou reabre em $org", async ({org,type}) => {
    const from = vi.fn();
    const db = { from } as unknown as SupabaseClient;
    const ctx = { organization_id: org, requestId: "req", actor: { type, id: "auto", role: "admin" } } as HandlerCtx;
    await expect(moveLeadHandler(db, ctx, "lead", { to_stage_id: "entry" })).rejects.toMatchObject({ status: 403 });
    for (const desfecho of ["won", "lost"] as const)
      await expect(encerraDemanda(db, ctx, { leadId: "lead", desfecho, motivo: "motivo" })).rejects.toMatchObject({ status: 403 });
    await expect(reabreLead(db, ctx, "lead")).rejects.toMatchObject({ status: 403 });
    expect(from).not.toHaveBeenCalled();
  });
  it("permite a decisão humana", () => {
    expect(() => requireHumanKanban({ actor: { type: "user", id: "human" } } as HandlerCtx)).not.toThrow();
  });
});
