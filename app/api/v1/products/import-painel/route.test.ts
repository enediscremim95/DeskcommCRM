// @vitest-environment node
import type * as ImpersonateSupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { baixarFotoDoPainel } from "@/lib/catalogo/foto-do-painel";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/catalogo/foto-do-painel", () => ({ baixarFotoDoPainel: vi.fn() }));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof ImpersonateSupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown> & { id: string; organization_id: string; codigo: string };
type Foto = Record<string, unknown> & {
  organization_id: string;
  produto_codigo: string;
  posicao: number;
  source_hash: string;
  storage_path: string;
};

let linhas: Linha[] = [];
let fotos: Foto[] = [];
let proximoId = 10;
const uploads: string[] = [];
const remocoes: string[] = [];

function selecionar<T extends Record<string, unknown>>(fonte: T[]) {
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
        data: fonte.filter((linha) => filtros.every(([c, v]) => linha[c] === v)).slice(inicio, fim + 1),
        error: null,
      };
    },
  };
  return cadeia;
}

function atualizarLinhas(mudancas: Record<string, unknown>) {
  const filtros: Array<[string, unknown]> = [];
  const aplicar = () => {
    const encontradas = linhas.filter((linha) => filtros.every(([c, v]) => linha[c] === v));
    encontradas.forEach((linha) => Object.assign(linha, mudancas));
    return { data: encontradas, error: null };
  };
  const cadeia = {
    eq(coluna: string, valor: unknown) {
      filtros.push([coluna, valor]);
      return cadeia;
    },
    select() {
      return {
        maybeSingle: async () => {
          const resultado = aplicar();
          return { data: resultado.data[0] ? { id: resultado.data[0].id } : null, error: null };
        },
      };
    },
    then(resolve: (valor: { data: Linha[]; error: null }) => unknown) {
      return Promise.resolve(aplicar()).then(resolve);
    },
  };
  return cadeia;
}

function adminEmMemoria() {
  return {
    from(tabela: string) {
      if (tabela === "organizations") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { currency: "BRL" }, error: null }) }),
          }),
        };
      }
      if (tabela === "catalog_product_groups") {
        return { upsert: async () => ({ error: null }) };
      }
      if (tabela === "catalog_product_images") {
        return { select: () => selecionar(fotos) };
      }
      if (tabela !== "catalog_products") throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => selecionar(linhas),
        async upsert(linha: Record<string, unknown>) {
          const existente = linhas.find(
            (item) => item.organization_id === linha.organization_id && item.codigo === linha.codigo,
          );
          const salva = existente ?? {
            id: `00000000-0000-4000-8000-${String(proximoId++).padStart(12, "0")}`,
            organization_id: String(linha.organization_id),
            codigo: String(linha.codigo),
            imagem_url: null,
            imagem_origem_url: null,
          };
          Object.assign(salva, linha);
          if (!existente) linhas.push(salva);
          return { data: { id: salva.id }, error: null };
        },
        update: atualizarLinhas,
      };
    },
    async rpc(
      nome: string,
      args: {
        p_organization_id: string;
        p_produto_codigo: string;
        p_images: Array<Record<string, unknown>>;
      },
    ) {
      if (nome !== "fn_sync_catalog_product_images") throw new Error(`rpc inesperada: ${nome}`);
      fotos = fotos.filter(
        (foto) =>
          foto.organization_id !== args.p_organization_id || foto.produto_codigo !== args.p_produto_codigo,
      );
      fotos.push(
        ...args.p_images.map(
          (foto) =>
            ({
              ...foto,
              organization_id: args.p_organization_id,
              produto_codigo: args.p_produto_codigo,
            }) as Foto,
        ),
      );
      return { error: null };
    },
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
          data: { publicUrl: `https://crm.example/storage/v1/object/public/catalog-media/${caminho}` },
        }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => adminEmMemoria()) }));

function pedido(produtos: unknown[], extras: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/v1/products/import-painel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ produtos, ...extras }),
  });
}

function produto(codigo: string, extras: Record<string, unknown> = {}) {
  return {
    sku: codigo,
    nome: `Produto ${codigo}`,
    grupo: "Presentes",
    tipo: "kit",
    situacao: "A",
    descricao: "Descrição do painel",
    acompanha: [],
    precos: [129.9],
    opcoes: {},
    opcoes_precos: {},
    variacoes: [{ codigo, atributos: {}, preco: 129.9 }],
    fotos: [],
    ...extras,
  };
}

function linha(codigo: string, extras: Record<string, unknown> = {}): Linha {
  return {
    id: `00000000-0000-4000-8000-${String(proximoId++).padStart(12, "0")}`,
    organization_id: ORG,
    codigo,
    nome: `Produto ${codigo}`,
    descricao: "Descrição do painel",
    categoria: "Presentes",
    preco_cents: 12990,
    ativo: true,
    origem: "painel",
    produto_codigo: codigo,
    opcao_preco: null,
    imagem_url: null,
    imagem_origem_url: null,
    ...extras,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  linhas = [];
  fotos = [];
  uploads.length = 0;
  remocoes.length = 0;
  proximoId = 10;
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
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
    expect(linhas[0]).toMatchObject({ organization_id: ORG, codigo: "SUBLI-1", origem: "painel" });
  });

  it("atualiza por código, desativa o que sumiu e não toca outra origem", async () => {
    linhas = [
      linha("SUBLI-1", { nome: "Nome antigo", origem: "manual" }),
      linha("SUMIU"),
      linha("MANUAL", { origem: "manual" }),
    ];
    const { POST } = await import("./route");
    const resposta = await POST(pedido([produto("SUBLI-1")]));
    const body = (await resposta.json()) as { data: Record<string, number> };

    expect(body.data).toMatchObject({ criados: 0, atualizados: 1, desativados: 1 });
    expect(linhas.find((item) => item.codigo === "SUBLI-1")).toMatchObject({
      nome: "Produto SUBLI-1",
      origem: "painel",
    });
    expect(linhas.find((item) => item.codigo === "SUMIU")?.ativo).toBe(false);
    expect(linhas.find((item) => item.codigo === "MANUAL")?.ativo).toBe(true);
  });

  it("não baixa de novo quando a foto de mesmo hash já está materializada", async () => {
    const origem = "https://orgbling.s3.amazonaws.com/f/foto.jpg";
    linhas = [linha("SUBLI-1")];
    fotos = [
      {
        organization_id: ORG,
        produto_codigo: "SUBLI-1",
        posicao: 1,
        source_hash: "hash-1",
        storage_path: `${ORG}/SUBLI-1/foto.jpg`,
        mime_type: "image/jpeg",
        size_bytes: 3,
        imagem_origem_url: `${origem}?h=hash-1`,
      },
    ];
    const { POST } = await import("./route");
    const resposta = await POST(
      pedido([produto("SUBLI-1", { fotos: [{ url: origem, h: "hash-1" }] })]),
    );
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
          fotos: [{ url: "https://orgbling.s3.amazonaws.com/f/foto.jpg", h: "hash-1" }],
        }),
      ]),
    );
    const body = (await resposta.json()) as {
      data: { criados: number; falhas: Array<{ codigo: string; etapa: string; motivo: string }> };
    };

    expect(body.data.criados).toBe(1);
    expect(body.data.falhas).toEqual([
      expect.objectContaining({ codigo: "SUBLI-1", etapa: "foto", motivo: "foto_bytes_invalidos" }),
    ]);
    expect(linhas[0]).toMatchObject({ imagem_url: null, imagem_origem_url: null });
  });

  it("guarda a foto no namespace do tenant e persiste somente a origem canônica", async () => {
    const origem = "https://orgbling.s3.amazonaws.com/f/foto.jpg";
    const { POST } = await import("./route");
    await POST(pedido([produto("SUBLI-1", { fotos: [{ url: origem, h: "hash-1" }] })]));

    expect(uploads[0]).toMatch(new RegExp(`^${ORG}/SUBLI-1/.+\\.jpg$`));
    expect(linhas[0]).toMatchObject({ imagem_origem_url: `${origem}?h=hash-1` });
    expect(String(linhas[0]?.imagem_url)).toContain(`/catalog-media/${ORG}/SUBLI-1/`);
  });

  it("procura o código em todas as páginas do catálogo antes do upsert", async () => {
    linhas = Array.from({ length: 501 }, (_, indice) => {
      const codigo = `MANUAL-${String(indice + 1).padStart(3, "0")}`;
      return linha(codigo, { origem: "manual" });
    });
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

  it("desativa linhas legadas estranhas sem criar pais falsos nem duplicatas ativas", async () => {
    const codigoReal = "SUBLI-PADR-LOUCA-CASAL-8PCS-CASAL";
    linhas = [
      linha("padrinhos:kit-afeto:g1-individual-1", { produto_codigo: null }),
      linha("natal:SUBLI-NAT-ANTIGO", { produto_codigo: null }),
      linha("MANUAL-PRESERVADO", { origem: "manual", produto_codigo: null }),
    ];
    const { POST } = await import("./route");
    const resposta = await POST(
      pedido([
        produto("SUBLI-PADR-LOUCA-CASAL-8PCS", {
          opcoes: { Versão: ["Casal"] },
          opcoes_precos: { Versão: { muda_preco: true, valores: [] } },
          variacoes: [{ codigo: codigoReal, atributos: { Versão: "Casal" }, preco: 169.9 }],
        }),
      ]),
    );
    const body = (await resposta.json()) as { data: Record<string, number> };

    expect(body.data).toMatchObject({ criados: 1, desativados: 2 });
    expect(linhas.find((item) => item.codigo === "padrinhos:kit-afeto:g1-individual-1")?.ativo).toBe(
      false,
    );
    expect(linhas.find((item) => item.codigo === "natal:SUBLI-NAT-ANTIGO")?.ativo).toBe(false);
    expect(linhas.find((item) => item.codigo === "MANUAL-PRESERVADO")?.ativo).toBe(true);

    const linhasAtivasDoPainel = linhas.filter((item) => item.origem === "painel" && item.ativo);
    expect(linhasAtivasDoPainel).toEqual([
      expect.objectContaining({
        codigo: codigoReal,
        produto_codigo: "SUBLI-PADR-LOUCA-CASAL-8PCS",
      }),
    ]);
    expect(new Set(linhasAtivasDoPainel.map((item) => item.codigo)).size).toBe(
      linhasAtivasDoPainel.length,
    );
  });

  it("grava peso e medidas pelo SKU e mantém a embalagem como estimada", async () => {
    const { POST } = await import("./route");
    await POST(
      pedido([
        produto("KIT-FRETE", {
          peso_medidas: {
            opcoes: [
              {
                sku: "KIT-FRETE",
                peso_kg: 2.75,
                altura_cm: 15,
                largura_cm: 25,
                comprimento_cm: 35,
              },
            ],
          },
        }),
      ]),
    );

    expect(linhas[0]).toMatchObject({
      codigo: "KIT-FRETE",
      peso_kg: 2.75,
      altura_cm: 15,
      largura_cm: 25,
      comprimento_cm: 35,
      embalagem_estimada: true,
    });
  });
});
