import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as FollowupAprovavel from "@/lib/leads/followup-aprovavel";

import { POST } from "./route";
import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { requireRole } from "@/lib/auth/require-role";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import {
  leUltimaRespostaDoContato,
  resolveConfiguracaoFollowupAprovavel,
} from "@/lib/leads/followup-aprovavel";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/app/api/v1/leads/_handler", () => ({ moveLeadHandler: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/automation/janela-do-canal", () => ({ adiarAteAJanelaAbrir: vi.fn() }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn() }));
vi.mock("@/lib/leads/activity-write-failure", () => ({ registraFalhaDeAtividade: vi.fn() }));
vi.mock("@/lib/leads/followup-aprovavel", async (original) => {
  const actual = await original<typeof FollowupAprovavel>();
  return {
    ...actual,
    leUltimaRespostaDoContato: vi.fn(),
    resolveConfiguracaoFollowupAprovavel: vi.fn(),
  };
});
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const PIPELINE = "55555555-5555-4555-8555-555555555555";
const TARGET = "66666666-6666-4666-8666-666666666666";
const CHANNEL = "77777777-7777-4777-8777-777777777777";
const RULE = "88888888-8888-4888-8888-888888888888";

interface UpdateCall { table: string; values: Record<string, unknown> }
let updates: UpdateCall[];

function supabaseFake() {
  return {
    from(table: string) {
      let operation = "select";
      const chain = {
        select: () => chain,
        update: (values: Record<string, unknown>) => {
          operation = "update";
          updates.push({ table, values });
          return chain;
        },
        eq: () => chain,
        contains: () => chain,
        maybeSingle: async () => {
          if (table === "crm_lead_reactivations" && operation === "update") {
            return { data: { id: PROPOSAL }, error: null };
          }
          if (table === "crm_leads") {
            return {
              data: {
                contact_id: "99999999-9999-4999-8999-999999999999",
                pipeline_id: PIPELINE,
                stage_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                updated_at: "2026-09-26T10:00:00.000Z",
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

function request(decision: "accept" | "dismiss") {
  return new NextRequest(`http://localhost/api/v1/leads/${LEAD}/reactivation`, {
    method: "POST",
    body: JSON.stringify({ decision, proposal_id: PROPOSAL }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    org: { orgId: ORG, role: "agent", name: "Org" },
    user: { id: USER, idioma: "pt-BR" },
  } as Awaited<ReturnType<typeof requireRole>>);
  vi.mocked(createClient).mockResolvedValue(
    supabaseFake() as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  vi.mocked(resolveConfiguracaoFollowupAprovavel).mockResolvedValue({
    automationRuleId: RULE,
    automationRuleName: "Retomada",
    targetStageId: TARGET,
    channelSessionId: CHANNEL,
    message: "Oi, ainda posso ajudar?",
    resuggestAfterDays: 14,
  });
  vi.mocked(leUltimaRespostaDoContato).mockResolvedValue("2026-09-20T10:00:00.000Z");
  vi.mocked(emitLeadActivity).mockResolvedValue({ ok: true });
  vi.mocked(moveLeadHandler).mockResolvedValue({ id: LEAD });
});

describe("POST /leads/:id/reactivation", () => {
  it("aprovar move para a etapa da regra fixa e informa a espera da janela", async () => {
    vi.mocked(adiarAteAJanelaAbrir).mockResolvedValue("2026-09-27T10:00:00.000Z");
    const response = await POST(request("accept"), { params: Promise.resolve({ id: LEAD }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(moveLeadHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: ORG, actor: { type: "user", id: USER } }),
      LEAD,
      expect.objectContaining({ to_stage_id: TARGET }),
    );
    expect(body.data).toMatchObject({
      status: "accepted",
      delivery_status: "queued_window",
      scheduled_for: "2026-09-27T10:00:00.000Z",
    });
    expect(updates.some((call) => call.table === "cron_jobs")).toBe(false);
  });

  it("não aprovar resolve o aviso sem mover o lead nem disparar envio", async () => {
    const response = await POST(request("dismiss"), { params: Promise.resolve({ id: LEAD }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("dismissed");
    expect(moveLeadHandler).not.toHaveBeenCalled();
    expect(adiarAteAJanelaAbrir).not.toHaveBeenCalled();
    expect(updates).toContainEqual(expect.objectContaining({
      table: "crm_lead_reactivations",
      values: expect.objectContaining({
        stage_id_at_proposal: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        last_inbound_at_at_proposal: "2026-09-20T10:00:00.000Z",
      }),
    }));
    expect(updates).toContainEqual(expect.objectContaining({
      table: "agent_inbox_items",
      values: expect.objectContaining({ status: "resolved" }),
    }));
  });
});
