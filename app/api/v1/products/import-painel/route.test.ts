// @vitest-environment node
import type * as ImpersonateSupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { baixarFotoDoPainel } from "@/lib/catalogo/foto-do-painel";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/catalogo/moeda-da-org", () => ({
  moedaDaOrganizacao: vi.fn(async () => "BRL"),
}));
vi.mock("@/lib/catalogo/foto-do-painel", () => ({
  baixarFotoDoPainel: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof ImpersonateSupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown> & { id: string; organization_id: string; codigo: string };
let linhas: Linha[] = [];
let proximoId = 10;
const uploads: string[] = [];
const remocoes: string[] = [];

function clienteEmMemoria() {
  return {
    from(tabela: string) {
      if (tabela !== "catalog_products") throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select() {
          const filtros: Array<[string, unknown]> = [];
          const cadeia = {
            eq(coluna: string, valor: unknown) {
              filtros.push([coluna, valor]);
              return cadeia;
            },
            order() {
              return cadeia;
            },
            async range(inicio: number, fim: number) {
              return {
                data: linhas
                  .filter((linha) => filtros.every(([c, v]) => linha[c] === v))
                  .slice(inicio, fim + 1),
                error: null,
              };
            },
          };
          return cadeia;
        },
        upsert(linha: Record<string, unknown>) {
          const existente = linhas.find(
            (item) =>
              item.organization_id === linha.organization_id && item.codigo === linha.codigo,
          );
          const salva = existente ?? {
            id: `00000000-0000-4000-8000-${String(proximoId++).padStart(12, "0")}`,
            organization_id: String(linha.organization_id),
            codigo: String(linha.codigo),
          };
          Object.assign(salva, linha);
          if (!existente) linhas.push(salva);
          return {
            select: () => ({ single: async () => ({ data: { id: salva.id }, error: null }) }),
          };
        },
        update(mudancas: Record<string, unknown>) {
          const filtros: Array<[string, unknown]> = [];
          const cadeia = {
            eq(coluna: string, valor: unknown) {
              filtros.push([coluna, valor]);
              return cadeia;
            },
            select() {
              return {
                maybeSingle: async () => {
                  const linha = linhas.find((item) => filtros.every(([c, v]) => item[c] === v));
                  if (linha) Object.assign(linha, mudancas);
                  return { data: linha ? { id: linha.id } : null, error: null };
                },
              };
            },
          };
          return cadeia;
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: async (caminho: string) => {
          uploads.push(caminho);
          return { error: null };
        },
        remove: async (caminhos: string[]) => {
          remocoes.push(...caminhos);
          return { error: null };
        },
        getPublicUrl: (caminho: string) => ({
          data: {
            publicUrl: `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`,
          },
        }),
      }),
    },
  })),
}));

function pedido(produtos: unknown[], extras: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/v1/products/import-painel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ produtos, ...extras }),
  });
}

function produto(codigo: string, extras: Record<string, unknown> = {}) {
  return {
    codigo,
    nome: `Produto ${codigo}`,
    descricao: "Descrição do painel",
    preco_cents: 12990,
    ativo: true,
    ...extras,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  linhas = [];
  uploads.length = 0;
  remocoes.length = 0;
  proximoId = 10;
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
  vi.mocked(createClient).mockResolvedValue(clienteEmMemoria() as never);
  vi.mocked(baixarFotoDoPainel).mockResolvedValue({
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    mime: "image/jpeg",
    extensao: "jpg",
  });
});

describe("POST /api/v1/products/import-painel", () => {
  it("exige manager e usa a organização autenticada, nunca a do JSON", async () => {
    const { POST } = await import("./route");
    const resposta = await POST(pedido([produto("SUBLI-1")], { organization_id: OUTRA_ORG }));

    expect(resposta.status).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ resource: "catalog_products" }),
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      organization_id: ORG,
      codigo: "SUBLI-1",
      origem: "painel",
    });
  });

  it("atualiza por código, desativa o que sumiu e não toca outra origem", async () => {
    linhas = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        organization_id: ORG,
        codigo: "SUBLI-1",
        nome: "Nome antigo",
        descricao: null,
        preco_cents: 1,
        ativo: true,
        origem: "manual",
        imagem_url: null,
        imagem_origem_url: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        organization_id: ORG,
        codigo: "SUMIU",
        nome: "Sumiu",
        descricao: null,
        preco_cents: 2,
        ativo: true,
        origem: "painel",
        imagem_url: null,
        imagem_origem_url: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        organization_id: ORG,
        codigo: "MANUAL",
        nome: "Manual",
        descricao: null,
        preco_cents: 3,
        ativo: true,
        origem: "manual",
        imagem_url: null,
        imagem_origem_url: null,
      },
    ];
    const { POST } = await import("./route");
    const resposta = await POST(pedido([produto("SUBLI-1")]));
    const body = (await resposta.json()) as { data: Record<string, number> };

    expect(body.data).toMatchObject({ criados: 0, atualizados: 1, desativados: 1 });
    expect(linhas.find((linha) => linha.codigo === "SUBLI-1")).toMatchObject({
      nome: "Produto SUBLI-1",
      origem: "painel",
    });
    expect(linhas.find((linha) => linha.codigo === "SUMIU")?.ativo).toBe(false);
    expect(linhas.find((linha) => linha.codigo === "MANUAL")?.ativo).toBe(true);
  });

  it("não baixa de novo quando a URL de origem e o arquivo local não mudaram", async () => {
    const id = "00000000-0000-4000-8000-000000000004";
    const origem = "https://produtos.sublimando.com.br/f/foto.jpg";
    linhas = [
      {
        id,
        organization_id: ORG,
        codigo: "SUBLI-1",
        nome: "Produto SUBLI-1",
        descricao: "Descrição do painel",
        preco_cents: 12990,
        ativo: true,
        origem: "painel",
        imagem_url: `https://crm.example/storage/v1/object/public/catalog-media/${ORG}/${id}/foto.jpg`,
        imagem_origem_url: origem,
      },
    ];
    const { POST } = await import("./route");
    const resposta = await POST(pedido([produto("SUBLI-1", { imagem_url: origem })]));
    const body = (await resposta.json()) as { data: Record<string, number> };

    expect(body.data.ignorados).toBe(1);
    expect(baixarFotoDoPainel).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it("falha da foto não impede o produto e deixa a saída em texto", async () => {
    vi.mocked(baixarFotoDoPainel).mockRejectedValue(new Error("foto_bytes_invalidos"));
    const { POST } = await import("./route");
    const resposta = await POST(
      pedido([
        produto("SUBLI-1", {
          imagem_url: "https://produtos.sublimando.com.br/f/foto.jpg",
        }),
      ]),
    );
    const body = (await resposta.json()) as {
      data: { criados: number; falhas: Array<{ codigo: string; motivo: string }> };
    };

    expect(body.data.criados).toBe(1);
    expect(body.data.falhas).toEqual([
      expect.objectContaining({ codigo: "SUBLI-1", motivo: expect.stringContaining("sem foto") }),
    ]);
    expect(linhas[0]).toMatchObject({ imagem_url: null, imagem_origem_url: null });
  });

  it("guarda a foto no namespace do tenant e lembra a URL de origem", async () => {
    const origem = "https://produtos.sublimando.com.br/f/foto.jpg";
    const { POST } = await import("./route");
    await POST(pedido([produto("SUBLI-1", { imagem_url: origem })]));

    expect(uploads[0]).toMatch(new RegExp(`^${ORG}/${linhas[0]!.id}/.+\\.jpg$`));
    expect(linhas[0]).toMatchObject({ imagem_origem_url: origem });
    expect(String(linhas[0]!.imagem_url)).toContain(`/catalog-media/${ORG}/${linhas[0]!.id}/`);
  });

  it("procura o código em todas as páginas do catálogo antes do upsert", async () => {
    linhas = Array.from({ length: 501 }, (_, indice) => ({
      id: `00000000-0000-4000-8000-${String(indice + 1).padStart(12, "0")}`,
      organization_id: ORG,
      codigo: `MANUAL-${String(indice + 1).padStart(3, "0")}`,
      nome: `Produto manual ${indice + 1}`,
      descricao: null,
      preco_cents: 100,
      ativo: true,
      origem: "manual",
      imagem_url: null,
      imagem_origem_url: null,
    }));
    const codigoNaSegundaPagina = "MANUAL-501";
    const { POST } = await import("./route");
    const resposta = await POST(pedido([produto(codigoNaSegundaPagina)]));
    const body = (await resposta.json()) as { data: Record<string, number> };

    expect(body.data).toMatchObject({ criados: 0, atualizados: 1 });
    expect(linhas).toHaveLength(501);
    expect(linhas.at(-1)).toMatchObject({
      codigo: codigoNaSegundaPagina,
      nome: `Produto ${codigoNaSegundaPagina}`,
      origem: "painel",
    });
  });
});
