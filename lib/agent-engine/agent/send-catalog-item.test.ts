import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../queue/queue";
import { criarFilaDeEnviosDoTurno } from "./fila-de-envios-do-turno";
import {
  executarEnvioDeItemDoCatalogo,
  inspecionarItemDoCatalogo,
  sendCatalogItemInputSchema,
  simularEnvioDeItemDoCatalogo,
  type EstadoEnvioCatalogo,
} from "./send-catalog-item";

const produto = {
  codigo: "PRECO-A",
  produto_codigo: "PAI-1",
  nome: "Kit",
  descricao: "Linha um. Linha dois.",
  opcao_preco: "Versão: A",
  preco_cents: 12345,
  moeda: "BRL",
};
const fotos = [1, 2, 3].map((posicao) => ({
  posicao,
  storage_path: `org/PAI-1/${posicao}.jpg`,
  mime_type: "image/jpeg" as const,
  size_bytes: 10,
  source_hash: `h${posicao}`,
}));

function banco(opcoes: { produto?: boolean; duplicado?: boolean } = {}): Queryable {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("from catalog_products") && sql.includes("codigo=$2")) {
        return { rows: opcoes.produto === false ? [] : [produto] };
      }
      if (sql.includes("select exists")) return { rows: [{ existe: opcoes.duplicado === true }] };
      if (sql.includes("select count(*)::int")) return { rows: [{ total: fotos.length }] };
      if (sql.includes("from catalog_product_images")) return { rows: fotos };
      if (sql.includes("from catalog_products") && sql.includes("produto_codigo=$2")) {
        return { rows: [produto, { ...produto, codigo: "PRECO-B", preco_cents: 15000 }] };
      }
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  } as unknown as Queryable;
}

function base(overrides: Partial<Parameters<typeof executarEnvioDeItemDoCatalogo>[0]> = {}) {
  const estado: EstadoEnvioCatalogo = { produtos: 0, imagens: 0 };
  return {
    db: banco(),
    admin: {} as SupabaseClient,
    organizationId: "org",
    conversationId: "conv",
    input: { codigo: "PRECO-A", quantas_fotos: 3 },
    estado,
    maxSendsRestantes: () => 8,
    materializar: vi.fn(async (_admin, _org, _conv, foto) => ({
      storagePath: `org/conv/${foto.storage_path.split("/").at(-1)}`,
      mime: foto.mime_type,
      sizeBytes: foto.size_bytes,
    })),
    enviar: vi.fn(async () => ({ status: "sent" as const, messageId: "m" })),
    ...overrides,
  };
}

describe("crm_send_catalog_item", () => {
  it("não aceita preço, legenda ou URL vindos do modelo", () => {
    expect(sendCatalogItemInputSchema.safeParse({ codigo: "X", preco: 1 }).success).toBe(false);
    expect(sendCatalogItemInputSchema.safeParse({ codigo: "X", url: "https://x" }).success).toBe(false);
  });

  it("usa preço do banco, envia em ordem e só legenda a primeira foto", async () => {
    const args = base();
    const resultado = await executarEnvioDeItemDoCatalogo(args);
    expect(resultado.ok).toBe(true);
    expect(args.enviar).toHaveBeenCalledTimes(3);
    const candidatos = vi.mocked(args.enviar).mock.calls.map(([candidato]) => candidato);
    expect(candidatos[0]?.body).toContain("R$ 123,45");
    expect(candidatos[1]?.body).toBe("");
    expect(candidatos.map((c) => c.metadata.catalog_image_position)).toEqual([1, 2, 3]);
  });

  it("não repete o mesmo produto na conversa", async () => {
    const args = base({ db: banco({ duplicado: true }) });
    const resultado = await executarEnvioDeItemDoCatalogo(args);
    expect(resultado).toMatchObject({ ok: true, ja_enviado: true });
    expect(args.enviar).not.toHaveBeenCalled();
  });

  it.each(["window_closed", "opt_out"])("devolve o veto %s sem fingir envio", async (code) => {
    const args = base({
      enviar: vi.fn(async () => ({ status: "failed" as const, code, message: "vetado" })),
    });
    const resultado = await executarEnvioDeItemDoCatalogo(args);
    expect(resultado).toMatchObject({ ok: false, error: { code } });
  });

  it("trata produto inativo ou de outro tenant como inexistente", async () => {
    const args = base({ db: banco({ produto: false }) });
    expect(await executarEnvioDeItemDoCatalogo(args)).toMatchObject({
      ok: false,
      error: { code: "product_not_found" },
    });
  });

  it("aplica os tetos de produtos, imagens e maxSendsPerTurn", async () => {
    const args = base({ estado: { produtos: 2, imagens: 0 } });
    expect(await executarEnvioDeItemDoCatalogo(args)).toMatchObject({ error: { code: "catalog_product_cap" } });
    const semEspaco = base({ estado: { produtos: 0, imagens: 7 }, maxSendsRestantes: () => 2 });
    expect(await executarEnvioDeItemDoCatalogo(semEspaco)).toMatchObject({ error: { code: "catalog_image_cap" } });
  });

  it("serializa 3 chamadas simultâneas e reserva somente os 2 produtos permitidos", async () => {
    const fila = criarFilaDeEnviosDoTurno();
    const estado: EstadoEnvioCatalogo = { produtos: 0, imagens: 0 };
    const enviar = vi.fn(async () => ({ status: "sent" as const, messageId: "m" }));
    const chamadas = Array.from({ length: 3 }, () => {
      const args = base({ estado, enviar });
      return fila.enfileirar(() => executarEnvioDeItemDoCatalogo(args));
    });

    const resultados = await Promise.all(chamadas);
    expect(resultados.slice(0, 2)).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(resultados[2]).toMatchObject({ ok: false, error: { code: "catalog_product_cap" } });
    expect(estado).toEqual({ produtos: 2, imagens: 6 });
    expect(enviar).toHaveBeenCalledTimes(6);
  });

  it("relata falha parcial e para depois da imagem que falhou", async () => {
    let chamada = 0;
    const args = base({
      enviar: vi.fn(async () => {
        chamada += 1;
        return chamada === 2
          ? { status: "failed" as const, code: "channel_failed", message: "falhou" }
          : { status: "sent" as const, messageId: `m${chamada}` };
      }),
    });
    const resultado = await executarEnvioDeItemDoCatalogo(args);
    expect(resultado).toMatchObject({
      ok: false,
      results: [{ status: "sent" }, { status: "failed", motivo: "channel_failed" }],
    });
    expect(args.enviar).toHaveBeenCalledTimes(2);
  });

  it("simula com a mesma validação sem consultar messages, baixar, gravar ou enviar mídia", async () => {
    const db = banco();
    const getPublicUrl = vi.fn((storagePath: string) => ({
      data: { publicUrl: `https://crm.example/storage/v1/object/public/catalog-media/${storagePath}` },
    }));
    const admin = {
      storage: {
        from: vi.fn(() => ({ getPublicUrl })),
      },
    } as unknown as SupabaseClient;
    const codigosJaEnviados = new Set<string>();
    const estado: EstadoEnvioCatalogo = { produtos: 0, imagens: 0 };
    const args = {
      db,
      admin,
      organizationId: "org",
      input: { codigo: "PRECO-A", quantas_fotos: 3 },
      estado,
      maxSendsRestantes: () => 8 - estado.imagens,
      codigosJaEnviados,
    };

    const primeira = await simularEnvioDeItemDoCatalogo(args);
    expect(primeira.resultado).toMatchObject({
      ok: true,
      ja_enviado: false,
      produto_codigo: "PAI-1",
    });
    expect(primeira.envio).toMatchObject({
      produtoCodigo: "PAI-1",
      legenda: expect.stringContaining("R$ 123,45"),
      imagens: [
        { nome: "1.jpg", url: expect.stringContaining("/catalog-media/org/PAI-1/1.jpg") },
        { nome: "2.jpg", url: expect.stringContaining("/catalog-media/org/PAI-1/2.jpg") },
        { nome: "3.jpg", url: expect.stringContaining("/catalog-media/org/PAI-1/3.jpg") },
      ],
    });
    const segunda = await simularEnvioDeItemDoCatalogo(args);
    expect(segunda).toEqual({ resultado: expect.objectContaining({ ok: true, ja_enviado: true }) });
    expect(codigosJaEnviados).toEqual(new Set(["PAI-1"]));
    expect(vi.mocked(db.query).mock.calls.some(([sql]) => sql.includes("from messages"))).toBe(false);
    expect(getPublicUrl).toHaveBeenCalledTimes(3);
  });

  it("escopa todas as leituras da simulação à organização recebida", async () => {
    const db = banco();
    const admin = {
      storage: {
        from: () => ({
          getPublicUrl: (storagePath: string) => ({ data: { publicUrl: storagePath } }),
        }),
      },
    } as unknown as SupabaseClient;
    await simularEnvioDeItemDoCatalogo({
      db,
      admin,
      organizationId: "org-do-teste",
      input: { codigo: "PRECO-A", quantas_fotos: 3 },
      estado: { produtos: 0, imagens: 0 },
      maxSendsRestantes: () => 8,
      codigosJaEnviados: new Set(),
    });
    const consultasAoCatalogo = vi
      .mocked(db.query)
      .mock.calls.filter(([sql]) => sql.includes("catalog_products") || sql.includes("catalog_product_images"));
    expect(consultasAoCatalogo.length).toBeGreaterThan(0);
    expect(consultasAoCatalogo.every(([, values]) => values?.[0] === "org-do-teste")).toBe(true);
  });

  it("inspeciona a unidade inteira sem consultar outro tenant", async () => {
    const db = banco();
    const inspecao = await inspecionarItemDoCatalogo({
      db,
      organizationId: "org-vitrine",
      conversationId: "conv-vitrine",
      input: { codigo: "PRECO-A", quantas_fotos: 3 },
    });

    expect(inspecao).toMatchObject({
      status: "ready",
      produtoCodigo: "PAI-1",
      mensagensFisicas: 3,
      precoResumo: expect.stringMatching(/123,45/),
    });
    expect(
      vi.mocked(db.query).mock.calls.every(([, values]) => values?.[0] === "org-vitrine"),
    ).toBe(true);
  });

  it("a vitrine injeta o título fixo na legenda sem aceitar texto do modelo", async () => {
    const args = base({ tituloFixo: "Kit Afeto com caixa kraft" });
    await executarEnvioDeItemDoCatalogo(args);
    const primeiro = vi.mocked(args.enviar).mock.calls[0]?.[0];
    expect(primeiro?.body.split("\n")[0]).toBe("Kit Afeto com caixa kraft");
  });
});
