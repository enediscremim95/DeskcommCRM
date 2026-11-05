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

const remove = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ storage: { from: () => ({ remove }) } })),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";

let linha: Record<string, unknown> | null;
let atualizacao: Record<string, unknown> | null;

function cliente() {
  const cadeiaDeFiltro = <T>(resultado: () => T) => {
    const cadeia = {
      eq: () => cadeia,
      select: () => ({ maybeSingle: async () => resultado() }),
      maybeSingle: async () => resultado(),
    };
    return cadeia;
  };
  return {
    from: () => ({
      select: () => cadeiaDeFiltro(() => ({ data: linha, error: null })),
      update: (mudancas: Record<string, unknown>) => {
        atualizacao = mudancas;
        return cadeiaDeFiltro(() => {
          if (linha) Object.assign(linha, mudancas);
          return { data: linha, error: null };
        });
      },
      delete: () =>
        cadeiaDeFiltro(() => {
          const removida = linha;
          linha = null;
          return { data: removida ? { id: ID } : null, error: null };
        }),
    }),
  };
}

function patch(corpo: unknown) {
  return new NextRequest(`http://localhost/api/v1/products/${ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  linha = {
    id: ID,
    origem: "painel",
    imagem_url: null,
    legenda_atendimento: null,
  };
  atualizacao = null;
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
  vi.mocked(createClient).mockResolvedValue(cliente() as never);
});

describe("produto gerenciado pelo painel", () => {
  it.each([
    ["nome", "Outro nome"],
    ["descricao", "Outra descrição"],
    ["preco_cents", 1],
    ["imagem_url", "https://example.com/foto.jpg"],
    ["ativo", false],
    ["codigo", "OUTRO-CODIGO"],
    ["marca", "Outra marca"],
    ["categoria", "Outra categoria"],
    ["custo_cents", 1],
    ["quantidade", 1],
    ["controla_estoque", false],
  ])("recusa alterar %s", async (campo, valor) => {
    const { PATCH } = await import("./route");
    const resposta = await PATCH(patch({ [campo]: valor }), {
      params: Promise.resolve({ id: ID }),
    });
    const body = (await resposta.json()) as { error: { code: string; message: string } };

    expect(resposta.status).toBe(409);
    expect(body.error).toEqual({
      code: "gerenciado_pelo_painel",
      message: "Este produto vem do painel de produtos. Mude lá.",
    });
    expect(atualizacao).toBeNull();
  });

  it("permite editar a legenda do atendimento", async () => {
    const { PATCH } = await import("./route");
    const resposta = await PATCH(patch({ legenda_atendimento: "Leve também a embalagem." }), {
      params: Promise.resolve({ id: ID }),
    });

    expect(resposta.status).toBe(200);
    expect(atualizacao).toEqual({ legenda_atendimento: "Leve também a embalagem." });
  });

  it("recusa excluir o produto", async () => {
    const { DELETE } = await import("./route");
    const resposta = await DELETE(
      new NextRequest(`http://localhost/api/v1/products/${ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: ID }) },
    );

    expect(resposta.status).toBe(409);
    expect(linha).not.toBeNull();
  });

  it("não remove do bucket um caminho de outra organização", async () => {
    linha = {
      id: ID,
      origem: "manual",
      imagem_url: `https://crm.example/storage/v1/object/public/catalog-media/99999999-9999-4999-8999-999999999999/${ID}/foto.jpg`,
    };
    const { DELETE } = await import("./route");
    const resposta = await DELETE(
      new NextRequest(`http://localhost/api/v1/products/${ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: ID }) },
    );

    expect(resposta.status).toBe(200);
    expect(remove).not.toHaveBeenCalled();
  });
});
