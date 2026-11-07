import type * as ImpersonateSupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { requireRole } from "@/lib/auth/require-role";
import { estadoDaJanela } from "@/lib/channels/janela";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const storageDownload = vi.hoisted(() => vi.fn());
const storageUpload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: (bucket: string) =>
        bucket === "catalog-media" ? { download: storageDownload } : { upload: storageUpload },
    },
  })),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
// A regra da janela mora em lib/channels e tem teste próprio. Aqui só importa que
// a rota a respeite, e a doutrina de canal proíbe nomear provider fora de lá.
vi.mock("@/lib/channels/janela", () => ({ estadoDaJanela: vi.fn() }));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof ImpersonateSupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const PRODUTO = "44444444-4444-4444-8444-444444444444";
const SKU_PAI = "SUBLI-NAT-CRISTA-BASE-BEGE";

interface OpcoesDoCliente {
  filtros?: Array<[string, string, unknown]>;
  imagemUrl?: string | null;
  produtoCodigo?: string | null;
  fotos?: Array<{
    produto_codigo: string;
    posicao: number;
    storage_path: string;
    mime_type: "image/jpeg" | "image/png";
    size_bytes: number;
  }>;
}

function cliente(
  lastInboundAt: string,
  { filtros = [], imagemUrl = null, produtoCodigo = SKU_PAI, fotos = [] }: OpcoesDoCliente = {},
) {
  return {
    from(tabela: string) {
      if (tabela === "conversations") {
        const cadeia: Record<string, unknown> = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([tabela, coluna, valor]);
            return cadeia;
          },
          maybeSingle: async () => ({
            data: {
              id: CONVERSA,
              last_inbound_at: lastInboundAt,
              channel_sessions: { provider: "canal-de-teste" },
            },
            error: null,
          }),
        };
        return { select: () => cadeia };
      }
      if (tabela === "catalog_products") {
        const cadeia: Record<string, unknown> = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([tabela, coluna, valor]);
            return cadeia;
          },
          in: async () => ({
            data: [
              {
                id: PRODUTO,
                nome: "Caneca sintética",
                descricao: "Descrição de teste",
                preco_cents: 3990,
                moeda: "BRL",
                imagem_url: imagemUrl,
                legenda_atendimento: null,
                produto_codigo: produtoCodigo,
              },
            ],
            error: null,
          }),
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

function pedido() {
  return new NextRequest(`http://localhost/api/v1/conversations/${CONVERSA}/catalog-items`, {
    method: "POST",
    body: JSON.stringify({ product_ids: [PRODUTO] }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  storageDownload.mockResolvedValue({
    data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }),
    error: null,
  });
  storageUpload.mockResolvedValue({ data: {}, error: null });
  vi.mocked(sendMessageHandler).mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    status: "sent",
  } as never);
  vi.mocked(estadoDaJanela).mockReturnValue({ tipo: "aberta" } as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
});

describe("POST /conversations/:id/catalog-items", () => {
  it("recusa antes do envio quando a janela de 24 horas está fechada", async () => {
    vi.mocked(estadoDaJanela).mockReturnValue({ tipo: "fechada" } as never);
    vi.mocked(createClient).mockResolvedValue(
      cliente(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()) as never,
    );
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });

    expect(resposta.status).toBe(409);
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("expõe a falha terminal de cada produto sem declarar sucesso total", async () => {
    vi.mocked(createClient).mockResolvedValue(cliente(new Date().toISOString()) as never);
    vi.mocked(sendMessageHandler).mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      status: "failed",
      error_code: "provider_send_failed",
    } as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });
    const body = (await resposta.json()) as {
      data: { sent: number; queued: number; failed: number };
    };

    expect(resposta.status).toBe(201);
    expect(body.data).toMatchObject({ sent: 0, queued: 0, failed: 1 });
  });

  it("filtra conversa e produtos pela organização autenticada", async () => {
    const filtros: Array<[string, string, unknown]> = [];
    vi.mocked(createClient).mockResolvedValue(
      cliente(new Date().toISOString(), { filtros }) as never,
    );
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });

    expect(resposta.status).toBe(201);
    expect(filtros).toContainEqual(["conversations", "organization_id", ORG]);
    expect(filtros).toContainEqual(["catalog_products", "organization_id", ORG]);
    expect(filtros).toContainEqual(["catalog_products", "ativo", true]);
    expect(sendMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: ORG }),
      expect.objectContaining({ conversation_id: CONVERSA }),
    );
  });

  it("distingue mensagem em fila de mensagem entregue", async () => {
    vi.mocked(createClient).mockResolvedValue(cliente(new Date().toISOString()) as never);
    vi.mocked(sendMessageHandler).mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      status: "queued",
    } as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });
    const body = (await resposta.json()) as {
      data: { sent: number; queued: number; failed: number };
    };

    expect(body.data).toMatchObject({ sent: 0, queued: 1, failed: 0 });
  });

  it("envia imagem quando a foto está na pasta do id do produto", async () => {
    const caminho = `${ORG}/${PRODUTO}/foto.jpg`;
    const imagem = `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`;
    vi.mocked(createClient).mockResolvedValue(
      cliente(new Date().toISOString(), { imagemUrl: imagem }) as never,
    );
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });
    const body = (await resposta.json()) as {
      data: { results: Array<{ photo: string }> };
    };

    expect(resposta.status).toBe(201);
    expect(storageDownload).toHaveBeenCalledWith(caminho);
    expect(sendMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: "image", media_size_bytes: 4 }),
    );
    expect(body.data.results[0]).toMatchObject({ photo: "sent" });
  });

  it("envia imagem quando a foto do painel está na pasta do SKU pai", async () => {
    const caminho = `${ORG}/${SKU_PAI}/foto.jpg`;
    const imagem = `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`;
    vi.mocked(createClient).mockResolvedValue(
      cliente(new Date().toISOString(), { imagemUrl: imagem }) as never,
    );
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });
    const body = (await resposta.json()) as {
      data: { results: Array<{ photo: string }> };
    };

    expect(resposta.status).toBe(201);
    expect(storageDownload).toHaveBeenCalledWith(caminho);
    expect(sendMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: "image", media_size_bytes: 4 }),
    );
    expect(body.data.results[0]).toMatchObject({ photo: "sent" });
  });

  it.each([
    [
      "outra organização",
      `https://crm.example/storage/v1/object/public/catalog-media/99999999-9999-4999-8999-999999999999/${SKU_PAI}/foto.jpg`,
    ],
    ["URL externa", "https://cdn.example/foto.jpg"],
  ])("trata %s como produto sem foto e registra o motivo", async (_caso, imagem) => {
    vi.mocked(createClient).mockResolvedValue(
      cliente(new Date().toISOString(), { imagemUrl: imagem }) as never,
    );
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });
    const body = (await resposta.json()) as {
      data: { results: Array<{ photo: string }> };
    };

    expect(resposta.status).toBe(201);
    expect(storageDownload).not.toHaveBeenCalled();
    expect(sendMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: "text" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "[catalog-items] foto do produto indisponível",
      expect.objectContaining({
        organization_id: ORG,
        product_id: PRODUTO,
        reason: "catalog_image_not_owned",
      }),
    );
    expect(body.data.results[0]).toMatchObject({ photo: "missing" });
  });

  it("envia somente texto, sem aviso, quando o produto não tem foto", async () => {
    vi.mocked(createClient).mockResolvedValue(cliente(new Date().toISOString()) as never);
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });
    const body = (await resposta.json()) as {
      data: { results: Array<{ photo: string }> };
    };

    expect(resposta.status).toBe(201);
    expect(sendMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: "text" }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(body.data.results[0]).toMatchObject({ photo: "missing" });
  });

  it("prefere a primeira foto da galeria quando imagem_url está vazia", async () => {
    const primeira = `${ORG}/${SKU_PAI}/primeira.jpg`;
    vi.mocked(createClient).mockResolvedValue(
      cliente(new Date().toISOString(), {
        fotos: [
          {
            produto_codigo: SKU_PAI,
            posicao: 1,
            storage_path: primeira,
            mime_type: "image/jpeg",
            size_bytes: 321,
          },
          {
            produto_codigo: SKU_PAI,
            posicao: 2,
            storage_path: `${ORG}/${SKU_PAI}/segunda.png`,
            mime_type: "image/png",
            size_bytes: 654,
          },
        ],
      }) as never,
    );
    const { POST } = await import("./route");

    await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });

    expect(storageDownload).toHaveBeenCalledTimes(1);
    expect(storageDownload).toHaveBeenCalledWith(primeira);
  });

  it("mantém o texto e registra aviso quando a foto não pode ser materializada", async () => {
    const caminho = `${ORG}/${SKU_PAI}/ausente.jpg`;
    const imagem = `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`;
    storageDownload.mockResolvedValue({ data: null, error: { message: "ausente" } });
    vi.mocked(createClient).mockResolvedValue(
      cliente(new Date().toISOString(), { imagemUrl: imagem }) as never,
    );
    const { POST } = await import("./route");

    const resposta = await POST(pedido(), { params: Promise.resolve({ id: CONVERSA }) });
    const body = (await resposta.json()) as {
      data: { sent: number; failed: number; results: Array<{ photo: string }> };
    };

    expect(body.data).toMatchObject({ sent: 1, failed: 0 });
    expect(body.data.results[0]).toMatchObject({ photo: "missing" });
    expect(sendMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: "text" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "[catalog-items] foto do produto indisponível",
      expect.objectContaining({
        organization_id: ORG,
        product_id: PRODUTO,
        reason: "catalog_image_missing",
      }),
    );
  });
});
