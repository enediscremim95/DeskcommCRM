import type * as ImpersonateSupportTypes from "@/lib/impersonate/support";
import { Blob as NodeBlob } from "node:buffer";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const storageDownload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: { from: () => ({ download: storageDownload }) },
  })),
}));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof ImpersonateSupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const PRODUTO = "44444444-4444-4444-8444-444444444444";
const CAMINHO = `${ORG}/SKU-PAI/foto.png`;

function cliente(storagePath = CAMINHO) {
  return {
    from(tabela: string) {
      if (tabela === "conversations") {
        const cadeia = {
          eq: () => cadeia,
          maybeSingle: async () => ({ data: { id: CONVERSA }, error: null }),
        };
        return { select: () => cadeia };
      }
      if (tabela === "catalog_products") {
        const cadeia = {
          eq: () => cadeia,
          maybeSingle: async () => ({
            data: { id: PRODUTO, imagem_url: null, produto_codigo: "SKU-PAI" },
            error: null,
          }),
        };
        return { select: () => cadeia };
      }
      if (tabela === "catalog_product_images") {
        const cadeia = {
          eq: () => cadeia,
          order: async () => ({
            data: [
              {
                produto_codigo: "SKU-PAI",
                posicao: 1,
                storage_path: storagePath,
                mime_type: "image/png",
              },
            ],
            error: null,
          }),
        };
        return { select: () => cadeia };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "22222222-2222-4222-8222-222222222222", idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
  vi.mocked(createClient).mockResolvedValue(cliente() as never);
  storageDownload.mockResolvedValue({
    data: new NodeBlob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    error: null,
  });
});

describe("GET /conversations/:id/catalog-items/photo", () => {
  it("transmite a foto resolvida pelo produto sem aceitar caminho livre", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest(
      `http://localhost/api/v1/conversations/${CONVERSA}/catalog-items/photo?product_id=${PRODUTO}`,
    );

    const resposta = await GET(req, { params: Promise.resolve({ id: CONVERSA }) });

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toBe("image/png");
    expect(resposta.headers.get("content-disposition")).toContain("foto.png");
    expect(storageDownload).toHaveBeenCalledWith(CAMINHO);
    expect((await resposta.arrayBuffer()).byteLength).toBe(3);
  });

  it("recusa product_id inválido antes de consultar o banco", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest(
      `http://localhost/api/v1/conversations/${CONVERSA}/catalog-items/photo?product_id=../../segredo`,
    );

    const resposta = await GET(req, { params: Promise.resolve({ id: CONVERSA }) });

    expect(resposta.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
    expect(storageDownload).not.toHaveBeenCalled();
  });

  it("não baixa caminho de foto pertencente a outra organização", async () => {
    vi.mocked(createClient).mockResolvedValue(
      cliente("99999999-9999-4999-8999-999999999999/SKU-PAI/foto.png") as never,
    );
    const { GET } = await import("./route");
    const req = new NextRequest(
      `http://localhost/api/v1/conversations/${CONVERSA}/catalog-items/photo?product_id=${PRODUTO}`,
    );

    const resposta = await GET(req, { params: Promise.resolve({ id: CONVERSA }) });

    expect(resposta.status).toBe(404);
    expect(storageDownload).not.toHaveBeenCalled();
  });
});
