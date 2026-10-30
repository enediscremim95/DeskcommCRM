import { describe, expect, it, vi } from "vitest";
import { carregarAprendizadoDaOrganizacao } from "./aprendizado";

describe("aprendizado por exemplos", () => {
  it("busca feedback da conversa e exemplos somente da mesma organização e canal", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ feedback: { decision: "rejected" } }] })
      .mockResolvedValueOnce({
        rows: [
          {
            original_body: "Rascunho",
            approved_body: "Resposta final",
            feedback: { decision: "edited" },
          },
        ],
      });
    const result = await carregarAprendizadoDaOrganizacao(
      { query } as never,
      {
        organizationId: "org-A",
        conversationId: "conversation-A",
        channelId: "channel-A",
        boundary: { organization_id: "org-A" } as never,
      },
    );
    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls[0]?.[0]).toContain("organization_id=$1");
    expect(calls[0]?.[1][0]).toBe("org-A");
    expect(calls[1]?.[0]).toContain("channel_session_id=$2");
    expect(calls[1]?.[1]).toEqual(["org-A", "channel-A"]);
    expect(result).toContain("Resposta final");
  });
});

