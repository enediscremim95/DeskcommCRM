import type * as ImpersonateSupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof ImpersonateSupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const PRODUTO_1 = "44444444-4444-4444-8444-444444444444";
const PRODUTO_2 = "55555555-5555-4555-8555-555555555555";
const SKU = "SUBLI-PAI-1";

interface Opcoes {
  conversa?: { id: string } | null;
  produtos?: Array<Record<string, unknown>>;
  fotos?: Array<Record<string, unknown>>;
  filtros?: Array<[string, string, unknown]>;
}

function cliente({
  conversa = { id: CONVERSA },
  produtos = [
    {
      id: PRODUTO_1,
      nome: "Primeiro",
      descricao: "Primeiro parágrafo.\n\nSegundo parágrafo.",
      preco_cents: 3990,
      moeda: "BRL",
      imagem_url: null,
      legenda_atendimento: null,
      produto_codigo: SKU,
    },
    {
      id: PRODUTO_2,
      nome: "Segundo",
      descricao: "Descrição dois",
      preco_cents: 4990,
      moeda: "BRL",
      imagem_url: null,
      legenda_atendimento: null,
      produto_codigo: null,
    },
  ],
  fotos = [
    {
      produto_codigo: SKU,
      posicao: 1,
      storage_path: `${ORG}/${SKU}/primeira.png`,
      mime_type: "image/png",
    },
  ],
  filtros = [],
}: Opcoes = {}) {
  return {
    from(tabela: string) {
      if (tabela === "conversations") {
        const cadeia: Record<string, unknown> = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([tabela, coluna, valor]);
            return cadeia;
          },
          maybeSingle: async () => ({ data: conversa, error: null }),
        };
        return { select: () => cadeia };
      }
      if (tabela === "catalog_products") {
        const cadeia: Record<string, unknown> = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([tabela, coluna, valor]);
            return cadeia;
          },
          in: async (coluna: string, valor: unknown) => {
            filtros.push([tabela, coluna, valor]);
            return { data: produtos, error: null };
          },
        };
        return { select: () => cadeia };
      }
      if (tabela === "catalog_product_images") {
        const cadeia: Record<string, unknown> = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([tabela, coluna, valor]);
            return cadeia;
          },
          in: (coluna: string, valor: unknown) => {
            filtros.push([tabela, coluna, valor]);
            return cadeia;
          },
          order: async () => ({ data: fotos, error: null }),
        };
        return { select: () => cadeia };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
}

function pedido(productIds = [PRODUTO_1, PRODUTO_2]) {
  return new NextRequest(
    `http://localhost/api/v1/conversations/${CONVERSA}/catalog-items/draft`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_ids: productIds }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
});

describe("POST /conversations/:id/catalog-items/draft", () => {
  it("devolve rascunhos na ordem pedida e não envia nem cria mensagem", async () => {
    const filtros: Array<[string, string, unknown]> = [];
    vi.mocked(createClient).mockResolvedValue(cliente({ filtros }) as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido([PRODUTO_2, PRODUTO_1]), {
      params: Promise.resolve({ id: CONVERSA }),
    });
    const body = (await resposta.json()) as {
      data: Array<{
        product_id: string;
        legenda: string;
        foto: { url: string; mime: string; nome_do_arquivo: string } | null;
      }>;
    };

    expect(resposta.status).toBe(200);
    expect(body.data.map((item) => item.product_id)).toEqual([PRODUTO_2, PRODUTO_1]);
    expect(body.data[0]!.foto).toBeNull();
    expect(body.data[1]!.legenda).toContain("Primeiro parágrafo.\n\nSegundo parágrafo.");
    expect(body.data[1]!.foto).toEqual({
      url: `/api/v1/conversations/${CONVERSA}/catalog-items/photo?product_id=${PRODUTO_1}`,
      mime: "image/png",
      nome_do_arquivo: "primeira.png",
    });
    expect(filtros).toContainEqual(["conversations", "organization_id", ORG]);
    expect(filtros).toContainEqual(["catalog_products", "organization_id", ORG]);
    expect(filtros).toContainEqual(["catalog_product_images", "organization_id", ORG]);
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("mantém a legenda e devolve foto null quando o produto não tem imagem", async () => {
    const semFoto = {
      id: PRODUTO_1,
      nome: "Sem foto",
      descricao: "Descrição inteira",
      preco_cents: 3990,
      moeda: "BRL",
      imagem_url: null,
      legenda_atendimento: null,
      produto_codigo: null,
    };
    vi.mocked(createClient).mockResolvedValue(cliente({ produtos: [semFoto], fotos: [] }) as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido([PRODUTO_1]), {
      params: Promise.resolve({ id: CONVERSA }),
    });
    const body = (await resposta.json()) as { data: Array<{ legenda: string; foto: null }> };

    expect(body.data[0]).toMatchObject({ foto: null });
    expect(body.data[0]!.legenda).toContain("Descrição inteira");
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("recusa conversa de outra organização sem consultar produtos", async () => {
    const filtros: Array<[string, string, unknown]> = [];
    vi.mocked(createClient).mockResolvedValue(cliente({ conversa: null, filtros }) as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido([PRODUTO_1]), {
      params: Promise.resolve({ id: CONVERSA }),
    });

    expect(resposta.status).toBe(404);
    expect(filtros).toEqual([
      ["conversations", "organization_id", ORG],
      ["conversations", "id", CONVERSA],
    ]);
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("recusa usuário sem acesso antes de abrir o banco", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido([PRODUTO_1]), {
      params: Promise.resolve({ id: CONVERSA }),
    });

    expect(resposta.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("recusa onze produtos na validação", async () => {
    const onze = Array.from({ length: 11 }, (_, index) =>
      `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
    );
    const { POST } = await import("./route");

    const resposta = await POST(pedido(onze), {
      params: Promise.resolve({ id: CONVERSA }),
    });

    expect(resposta.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });
});
