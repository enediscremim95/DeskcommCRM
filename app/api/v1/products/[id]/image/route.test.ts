// @vitest-environment node
import type * as ImpersonateSupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof ImpersonateSupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const storage = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: storage.upload,
        remove: storage.remove,
        getPublicUrl: (caminho: string) => ({
          data: {
            publicUrl: `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`,
          },
        }),
      }),
    },
  })),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
let produto: Record<string, unknown> | null;

function cliente() {
  return {
    from: () => ({
      select: () => {
        const cadeia = {
          eq: () => cadeia,
          maybeSingle: async () => ({ data: produto, error: null }),
        };
        return cadeia;
      },
      update: (mudancas: Record<string, unknown>) => {
        const cadeia = {
          eq: () => cadeia,
          not: () => cadeia,
          select: () => ({
            maybeSingle: async () => {
              if (produto) Object.assign(produto, mudancas);
              return { data: produto, error: null };
            },
          }),
        };
        return cadeia;
      },
    }),
  };
}

function pedidoComFoto() {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "foto.jpg", {
    type: "image/jpeg",
  }));
  return new NextRequest(`http://localhost/api/v1/products/${ID}/image`, {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  produto = { id: ID, origem: "painel", imagem_url: null };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
  vi.mocked(createClient).mockResolvedValue(cliente() as never);
});

describe("imagem do produto", () => {
  it("recusa trocar ou remover a foto de produto do painel", async () => {
    const { POST, DELETE } = await import("./route");
    const troca = await POST(pedidoComFoto(), { params: Promise.resolve({ id: ID }) });
    const remocao = await DELETE(
      new NextRequest(`http://localhost/api/v1/products/${ID}/image`, { method: "DELETE" }),
      { params: Promise.resolve({ id: ID }) },
    );

    expect(troca.status).toBe(409);
    expect(remocao.status).toBe(409);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("ao trocar a foto manual não remove caminho de outra organização", async () => {
    produto = {
      id: ID,
      origem: "manual",
      imagem_url: `https://crm.example/storage/v1/object/public/catalog-media/99999999-9999-4999-8999-999999999999/${ID}/foto.jpg`,
    };
    const { POST } = await import("./route");
    const resposta = await POST(pedidoComFoto(), { params: Promise.resolve({ id: ID }) });

    expect(resposta.status).toBe(200);
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
