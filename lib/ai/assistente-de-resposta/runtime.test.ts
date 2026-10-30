import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadById } = vi.hoisted(() => ({ loadById: vi.fn() }));
vi.mock("@/lib/agent-engine/agent/agent-config", () => ({
  loadPublishedAgentConfigById: loadById,
}));

import { carregarAssistenteDeResposta } from "./runtime";

const settings = {
  managed: true,
  enabled: true,
  provider: "anthropic",
  model: "modelo",
  credential_id: "11000000-0000-4000-8000-000000000001",
  team_style: "Fale de forma curta e cordial.",
  history_message_window: 20,
  history_token_window: 4_000,
  hourly_limit: 20,
  daily_limit: 100,
};

beforeEach(() => vi.clearAllMocks());

describe("carregar assistente de resposta", () => {
  it("filtra a organização e só aceita o agente assistido e pausado", async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: "agent-A", config: { reply_assistant: settings } }],
    }));
    loadById.mockResolvedValue({ operationMode: "assisted", pausedAt: "agora" });
    const result = await carregarAssistenteDeResposta(
      { query } as never,
      "11000000-0000-4000-8000-000000000002",
    );
    const [sql, args] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("organization_id=$1");
    expect(sql).toContain("operation_mode='assisted'");
    expect(sql).toContain("paused_at is not null");
    expect(sql).toContain("not is_active");
    expect(sql).toContain('"enabled":true');
    expect(args).toEqual(["11000000-0000-4000-8000-000000000002"]);
    expect(loadById).toHaveBeenCalledWith(expect.anything(), args[0], "agent-A", {
      allowManagedReplyAssistant: true,
    });
    expect(result?.settings.daily_limit).toBe(100);
  });

  it("recusa agente automático ou não pausado", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: "agent-A", config: { reply_assistant: settings } }],
      })),
    };
    loadById.mockResolvedValue({ operationMode: "automatic", pausedAt: null });
    await expect(carregarAssistenteDeResposta(pool as never, "org-A")).resolves.toBeNull();
  });
});
