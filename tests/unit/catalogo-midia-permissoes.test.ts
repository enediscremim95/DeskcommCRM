import type * as ImpersonateSupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof ImpersonateSupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const NEGADO = {
  ok: false,
  response: new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }),
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(NEGADO as never);
});

describe("permissões de catálogo e atalhos com mídia", () => {
  it("exige manager para guardar mídia em atalho compartilhado", async () => {
    const { POST } = await import("@/app/api/v1/message-templates/[id]/media/route");
    const resposta = await POST(
      new NextRequest("http://localhost/api/v1/message-templates/t1/media", { method: "POST" }),
      { params: Promise.resolve({ id: "t1" }) },
    );

    expect(resposta.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ resource: "message_templates" }),
    );
  });

  it("exige manager para trocar a imagem de um produto", async () => {
    const { POST } = await import("@/app/api/v1/products/[id]/image/route");
    const resposta = await POST(
      new NextRequest("http://localhost/api/v1/products/p1/image", { method: "POST" }),
      { params: Promise.resolve({ id: "p1" }) },
    );

    expect(resposta.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ resource: "catalog_products" }),
    );
  });

  it("exige agent para enviar produtos na conversa", async () => {
    const { POST } = await import("@/app/api/v1/conversations/[id]/catalog-items/route");
    const resposta = await POST(
      new NextRequest("http://localhost/api/v1/conversations/c1/catalog-items", {
        method: "POST",
        body: JSON.stringify({ product_ids: ["11111111-1111-4111-8111-111111111111"] }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "c1" }) },
    );

    expect(resposta.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ resource: "messages" }),
    );
  });
});
