import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O e-mail do convidado do `crm_book_appointment` não pode chegar a log
 * persistido: nem à auditoria MCP (`api_audit_log.metadata.args`) nem ao trace
 * da execução de IA (`ai_agent_runs.tool_calls`).
 */
const auditado = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => auditado(...a) }));

const { auditMcpToolCall } = await import("@/lib/mcp/audit");
const { serializeSteps } = await import("@/lib/ai/runtime/serialize");

const EMAIL = "ana.cliente@exemplo.com";

describe("guest_email fora dos logs", () => {
  beforeEach(() => auditado.mockReset());

  it("auditoria MCP redige guest_email", async () => {
    await auditMcpToolCall({
      ctx: {
        organizationId: "org-1",
        role: "agent",
        actor: { type: "ai_agent", id: "ag-1", role: "ai_operator" },
        apiTokenId: "tok-1",
        requestId: "req-1",
        supabase: {} as never,
      },
      toolName: "crm_book_appointment",
      args: { event_type_slug: "apresentacao", guest_email: EMAIL },
      durationMs: 10,
      success: true,
    });
    const registro = JSON.stringify(auditado.mock.calls[0]![0]);
    expect(registro).not.toContain(EMAIL);
    expect(registro).toContain("[redacted]");
    expect(registro).toContain("apresentacao"); // controle: o resto continua lá
  });

  it("trace de IA redige guest_email", () => {
    const trace = JSON.stringify(
      serializeSteps([{ toolCalls: [{ toolName: "crm_book_appointment", input: { guest_email: EMAIL, contact_id: "c-1" } }] }]),
    );
    expect(trace).not.toContain(EMAIL);
    expect(trace).toContain("c-1");
  });
});
