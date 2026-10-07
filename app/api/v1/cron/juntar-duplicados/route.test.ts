import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  audit: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "segredo-cron",
    INTERNAL_SECRET: "",
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/audit", () => ({ audit: (...args: unknown[]) => mocks.audit(...args) }));
vi.mock("@/lib/logger", () => ({
  logger: { error: (...args: unknown[]) => mocks.error(...args) },
}));

function request(secret = "segredo-cron") {
  return {
    headers: new Headers({ authorization: `Bearer ${secret}` }),
  } as never;
}

describe("cron juntar-duplicados", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("não audita quando o lote não juntou nada", async () => {
    mocks.rpc.mockResolvedValue({
      data: { juntados: 0, ignorados_por_risco: 2 },
      error: null,
    });
    const { GET } = await import("./route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { juntados: 0, ignorados_por_risco: 2 },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("audita uma vez quando houve junção", async () => {
    mocks.rpc.mockResolvedValue({
      data: { juntados: 3, ignorados_por_risco: 1 },
      error: null,
    });
    const { POST } = await import("./route");
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_juntar_duplicados_recentes", { p_lote: 50 });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lead.duplicate_merged",
        bypassedRls: true,
        metadata: expect.objectContaining({ juntados: 3, ignorados_por_risco: 1 }),
      }),
    );
  });

  it("recusa segredo inválido sem chamar o banco", async () => {
    const { GET } = await import("./route");
    const response = await GET(request("errado"));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
