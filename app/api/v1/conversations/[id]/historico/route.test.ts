import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  aprofundar: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/channels/historico", () => ({ aprofundarHistorico: mocks.aprofundar }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { POST } from "./route";

describe("POST /conversations/:id/historico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({
      ok: true,
      user: { id: "user-1" },
      org: { orgId: "org-autenticada" },
    });
    mocks.aprofundar.mockResolvedValue({ status: "ok", inseridas: 2, duplicadas: 0, ignoradas: 0 });
  });

  it("exige viewer e usa a organização autenticada, nunca uma escolha do cliente", async () => {
    const req = new NextRequest("http://localhost/api/v1/conversations/conv-1/historico", {
      method: "POST",
      body: JSON.stringify({ organization_id: "org-alheia" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "conv-1" }) });

    expect(res.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith("viewer", expect.objectContaining({ resource: "conversations" }));
    expect(mocks.aprofundar).toHaveBeenCalledWith({
      organizationId: "org-autenticada",
      conversationId: "conv-1",
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-autenticada",
      resourceId: "conv-1",
    }));
  });

  it("não audita rodada sem mensagem nova", async () => {
    mocks.aprofundar.mockResolvedValue({ status: "ja_importado", inseridas: 0 });
    const req = new NextRequest("http://localhost/api/v1/conversations/conv-1/historico", { method: "POST" });
    await POST(req, { params: Promise.resolve({ id: "conv-1" }) });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
