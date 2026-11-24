import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFollowupTurnHandler, type FollowupTurnDeps } from "./followup-turn";
import { JobSettledError } from "./inbound-turn";
import type { JobRow } from "../queue/queue";

const { runAgentTurn, runBeforeSend, complete } = vi.hoisted(() => ({
  runAgentTurn: vi.fn(), runBeforeSend: vi.fn(), complete: vi.fn(),
}));

vi.mock("./inbound-turn", () => ({
  runAgentTurn,
  JobSettledError: class extends Error {},
}));
vi.mock("../guardrails/before-send", () => ({ runBeforeSend }));
vi.mock("./human-handoff", () => ({ isLeadInHandoff: async () => false }));
vi.mock("./fuso-da-org", () => ({ fusoDaOrganizacao: async () => "America/Sao_Paulo" }));
vi.mock("../edge/crm/get-lead-context", () => ({
  getLeadContext: async () => ({ ok: true, context: { contact: { is_blocked: false } } }),
}));
vi.mock("@/lib/atendimento/fronteira-server", () => ({ requireCurrentServiceBoundary: async () => {} }));

const domingo = new Date("2026-11-29T15:00:00Z");
const segunda9h = new Date("2026-11-30T12:00:00Z");
const send_window = {
  timezone: "America/Sao_Paulo", start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5, 6],
};

function setup(fixedBody?: string) {
  const query = vi.fn(async (sql: string, _values: unknown[]) => {
    if (sql.includes("join channel_sessions")) return { rows: [{ channel_session_id: "session", archived_at: null }] };
    if (sql.includes("join followup_flow_pointers")) return { rows: [{ trigger_config: { kind: "manual", send_window } }] };
    if (sql.includes("update job_queue")) return { rows: [{ id: "job" }] };
    throw new Error("Consulta inesperada");
  });
  const deps = {
    clock: () => domingo,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    knobs: {},
    channel: vi.fn(),
    completeFollowupTurn: complete,
  } as unknown as FollowupTurnDeps;
  const job = {
    id: "job", kind: "followup_turn", organization_id: "org", contact_id: "contact",
    locked_by: "worker", claim_acquired_at: domingo.toISOString(),
    payload: {
      service_boundary: { organization_id: "org", contact_id: "contact", conversation_id: "conv",
        service_revision: 1, demanda_id: null, demanda_revision: null },
      followup_enrollment_id: "00000000-0000-4000-8000-000000000001",
      node_id: "action", purpose: "send_message", fixed_body: fixedBody,
    },
  } as unknown as JobRow;

  return { query, job, run: () => createFollowupTurnHandler(deps)(job, { query } as unknown as pg.Pool, { workerId: "worker" }) };
}

beforeEach(() => vi.resetAllMocks());

describe("follow-up dirigido por fluxo", () => {
  it.each(["outside_followup_window", "warmup_cap"])("texto fixo veta %s e mantém o mesmo job pendente", async (code) => {
    const { query, job, run } = setup("Olá!");
    runBeforeSend.mockResolvedValue({ status: "vetoed", code, nextAllowedAt: segunda9h });
    await expect(run()).rejects.toBeInstanceOf(JobSettledError);
    expect(runBeforeSend).toHaveBeenCalledWith(expect.objectContaining({ followupWindow: send_window }));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("update job_queue"), [
      job.id, "worker", segunda9h.getTime() - domingo.getTime(),
      `followup_deferred: ${code}`, domingo.toISOString(),
    ]);
    expect(complete).not.toHaveBeenCalled();
  });

  it("entrega a janela ao turno de IA e deixa o enrollment no nó quando ele adia", async () => {
    const { run } = setup();
    runAgentTurn.mockRejectedValue(new JobSettledError("adiado"));
    await expect(run()).rejects.toBeInstanceOf(JobSettledError);
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      expect.objectContaining({ followupWindow: send_window }),
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
