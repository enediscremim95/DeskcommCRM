import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryResult, QueryResultRow } from "pg";
import { z } from "zod";

import { montarLegendaDaTool, type LinhaDePrecoParaLegenda } from "@/lib/catalogo/legenda-da-tool";
import { materializarFotoDoCatalogo } from "@/lib/catalogo/materializar-foto";
import { formatCents } from "@/lib/money";
import type { Queryable } from "../queue/queue";

export const sendCatalogItemInputSchema = z
  .object({
    codigo: z.string().trim().min(1).max(120),
    quantas_fotos: z.number().int().min(1).max(4).default(3),
  })
  .strict();

interface Produto extends LinhaDePrecoParaLegenda {
  produto_codigo: string;
}
interface Foto {
  posicao: number;
  storage_path: string;
  mime_type: "image/jpeg" | "image/png";
  size_bytes: number;
  source_hash: string;
}
export type InspecaoDeItemDoCatalogo =
  | { status: "not_found" }
  | { status: "already_sent"; produtoCodigo: string }
  | {
      status: "ready";
      produtoCodigo: string;
      mensagensFisicas: number;
      precoResumo: string;
    };
export interface EstadoEnvioCatalogo {
  produtos: number;
  imagens: number;
}
export interface CandidatoCatalogo {
  body: string;
  media?: { storagePath: string; mime: "image/jpeg" | "image/png"; sizeBytes: number };
  metadata: Record<string, unknown>;
}
export type ResultadoCandidatoCatalogo =
  | { status: "sent" | "queued"; messageId?: string }
  | { status: "failed"; code: string; message: string };
export interface EnvioCatalogoSimulado {
  produtoCodigo: string;
  legenda: string;
  imagens: Array<{ nome: string; url: string }>;
}

/**
 * Planeja uma unidade inteira antes de a vitrine emitir a abertura. A leitura é
 * sempre escopada à organização e o sandbox troca somente a fonte do dedupe.
 */
export async function inspecionarItemDoCatalogo(args: {
  db: Queryable;
  organizationId: string;
  conversationId: string;
  input: z.infer<typeof sendCatalogItemInputSchema>;
  codigosJaEnviados?: ReadonlySet<string>;
}): Promise<InspecaoDeItemDoCatalogo> {
  const input = sendCatalogItemInputSchema.parse(args.input);
  const { rows } = await args.db.query<Produto>(
    `select codigo,nome,descricao,opcao_preco,preco_cents,moeda,produto_codigo
       from catalog_products
      where organization_id=$1 and codigo=$2 and ativo=true and produto_codigo is not null
      limit 1`,
    [args.organizationId, input.codigo],
  );
  const produto = rows[0];
  if (!produto) return { status: "not_found" };

  const jaEnviado = args.codigosJaEnviados
    ? args.codigosJaEnviados.has(produto.produto_codigo)
    : (
        await args.db.query<{ existe: boolean }>(
          `select exists(
             select 1 from messages
              where organization_id=$1 and conversation_id=$2 and direction='outbound'
                and metadata->>'catalog_product_code'=$3
                and status in ('queued','sending','sent','delivered','read')
           ) as existe`,
          [args.organizationId, args.conversationId, produto.produto_codigo],
        )
      ).rows[0]?.existe === true;
  if (jaEnviado) return { status: "already_sent", produtoCodigo: produto.produto_codigo };

  const fotos = await args.db.query<{ total: number }>(
    `select count(*)::int as total from (
       select 1 from catalog_product_images
        where organization_id=$1 and produto_codigo=$2
        order by posicao
        limit $3
     ) fotos`,
    [args.organizationId, produto.produto_codigo, input.quantas_fotos],
  );
  return {
    status: "ready",
    produtoCodigo: produto.produto_codigo,
    mensagensFisicas: Math.max(1, fotos.rows[0]?.total ?? 0),
    precoResumo: formatCents(produto.preco_cents, produto.moeda),
  };
}

export async function executarEnvioDeItemDoCatalogo(args: {
  db: Queryable;
  admin: SupabaseClient;
  organizationId: string;
  conversationId: string;
  input: z.infer<typeof sendCatalogItemInputSchema>;
  estado: EstadoEnvioCatalogo;
  maxSendsRestantes: () => number;
  enviar: (candidato: CandidatoCatalogo) => Promise<ResultadoCandidatoCatalogo>;
  materializar?: typeof materializarFotoDoCatalogo;
  tituloFixo?: string;
  limites?: { produtos: number; imagens: number };
}): Promise<Record<string, unknown>> {
  const input = sendCatalogItemInputSchema.parse(args.input);
  const limites = args.limites ?? { produtos: 2, imagens: 8 };
  if (args.estado.produtos >= limites.produtos) {
    return { ok: false, error: { code: "catalog_product_cap", message: `limite de ${limites.produtos} produtos neste turno; encerre e espere o cliente.` } };
  }
  const { rows } = await args.db.query<Produto>(
    `select codigo,nome,descricao,opcao_preco,preco_cents,moeda,produto_codigo
       from catalog_products
      where organization_id=$1 and codigo=$2 and ativo=true and produto_codigo is not null
      limit 1`,
    [args.organizationId, input.codigo],
  );
  const produto = rows[0];
  if (!produto) {
    return { ok: false, error: { code: "product_not_found", message: "produto ativo não encontrado nesta loja; não invente nem procure em outro tenant." } };
  }
  const duplicado = await args.db.query<{ existe: boolean }>(
    `select exists(
       select 1 from messages
        where organization_id=$1 and conversation_id=$2 and direction='outbound'
          and metadata->>'catalog_product_code'=$3
          and status in ('queued','sending','sent','delivered','read')
     ) as existe`,
    [args.organizationId, args.conversationId, produto.produto_codigo],
  );
  if (duplicado.rows[0]?.existe) {
    return { ok: true, ja_enviado: true, instrucao: "este produto já foi enviado nesta conversa; não repita e siga a conversa." };
  }
  if (
    args.estado.imagens + input.quantas_fotos > limites.imagens ||
    input.quantas_fotos > args.maxSendsRestantes()
  ) {
    return { ok: false, error: { code: "catalog_image_cap", message: "o pedido ultrapassa o limite físico deste turno; reduza quantas_fotos ou encerre." } };
  }
  const [opcoes, fotos] = await Promise.all([
    args.db.query<LinhaDePrecoParaLegenda>(
      `select codigo,nome,descricao,opcao_preco,preco_cents,moeda
         from catalog_products
        where organization_id=$1 and produto_codigo=$2 and ativo=true
        order by preco_cents,codigo`,
      [args.organizationId, produto.produto_codigo],
    ),
    args.db.query<Foto>(
      `select posicao,storage_path,mime_type,size_bytes,source_hash
         from catalog_product_images
        where organization_id=$1 and produto_codigo=$2
        order by posicao
        limit $3`,
      [args.organizationId, produto.produto_codigo, input.quantas_fotos],
    ),
  ]);
  const legenda = montarLegendaDaTool(
    produto,
    opcoes.rows,
    args.tituloFixo ? { tituloFixo: args.tituloFixo } : {},
  );
  args.estado.produtos += 1;
  const alvos: Array<Foto | null> = fotos.rows.length > 0 ? fotos.rows : [null];
  const resultados: Array<Record<string, unknown>> = [];
  for (const [indice, foto] of alvos.entries()) {
    let media: CandidatoCatalogo["media"];
    let fallbackTexto = foto === null;
    if (foto) {
      try {
        media = await (args.materializar ?? materializarFotoDoCatalogo)(
          args.admin,
          args.organizationId,
          args.conversationId,
          foto,
        );
      } catch {
        fallbackTexto = true;
      }
    }
    const metadata = {
      catalog_item_sent: true,
      catalog_product_code: produto.produto_codigo,
      catalog_price_code: produto.codigo,
      ...(foto ? { catalog_image_hash: foto.source_hash, catalog_image_position: foto.posicao } : {}),
    };
    const resultado = await args.enviar({
      body: indice === 0 || fallbackTexto ? legenda : "",
      ...(media ? { media } : {}),
      metadata,
    });
    args.estado.imagens += 1;
    resultados.push({
      posicao: foto?.posicao ?? 1,
      status: resultado.status,
      ...(fallbackTexto ? { fallback_texto: true } : {}),
      ...(resultado.status === "failed" ? { motivo: resultado.code } : {}),
      ...("messageId" in resultado && resultado.messageId ? { message_id: resultado.messageId } : {}),
    });
    if (resultado.status === "queued" || resultado.status === "failed") break;
  }
  const falhou = resultados.find((resultado) => resultado.status === "failed");
  if (falhou) {
    return { ok: false, error: { code: falhou.motivo, message: "o envio foi vetado ou falhou; não diga ao cliente que foi enviado." }, results: resultados };
  }
  return {
    ok: true,
    ja_enviado: false,
    produto_codigo: produto.produto_codigo,
    preco_resumo: formatCents(produto.preco_cents, produto.moeda),
    results: resultados,
  };
}

/**
 * Exercita a mesma validação do envio real sem consultar `messages`, materializar
 * mídia ou alcançar o canal. A única troca é nas três portas de efeito da função
 * real: a consulta de duplicidade, a cópia de Storage e o callback de envio.
 */
export async function simularEnvioDeItemDoCatalogo(args: {
  db: Queryable;
  admin: SupabaseClient;
  organizationId: string;
  input: z.infer<typeof sendCatalogItemInputSchema>;
  estado: EstadoEnvioCatalogo;
  maxSendsRestantes: () => number;
  codigosJaEnviados: Set<string>;
  tituloFixo?: string;
  limites?: { produtos: number; imagens: number };
}): Promise<{ resultado: Record<string, unknown>; envio?: EnvioCatalogoSimulado }> {
  const candidatos: CandidatoCatalogo[] = [];
  const dbSemMensagens: Queryable = {
    async query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      if (text.includes("from messages") && text.includes("catalog_product_code")) {
        const codigo = typeof values?.[2] === "string" ? values[2] : "";
        return {
          rows: [{ existe: args.codigosJaEnviados.has(codigo) }],
        } as unknown as QueryResult<R>;
      }
      return args.db.query<R>(text, values);
    },
  };
  const resultado = await executarEnvioDeItemDoCatalogo({
    db: dbSemMensagens,
    admin: args.admin,
    organizationId: args.organizationId,
    conversationId: "",
    input: args.input,
    estado: args.estado,
    maxSendsRestantes: args.maxSendsRestantes,
    ...(args.tituloFixo ? { tituloFixo: args.tituloFixo } : {}),
    ...(args.limites ? { limites: args.limites } : {}),
    materializar: async (_admin, _org, _conversation, foto) => ({
      storagePath: foto.storage_path,
      mime: foto.mime_type,
      sizeBytes: foto.size_bytes,
    }),
    enviar: async (candidato) => {
      candidatos.push(candidato);
      return { status: "sent" };
    },
  });
  if (resultado.ok !== true || resultado.ja_enviado === true) return { resultado };
  const produtoCodigo =
    typeof resultado.produto_codigo === "string" ? resultado.produto_codigo : "";
  if (!produtoCodigo) return { resultado };
  args.codigosJaEnviados.add(produtoCodigo);
  const legenda = candidatos.find((candidato) => candidato.body)?.body ?? "";
  const imagens = candidatos.flatMap((candidato) => {
    const storagePath = candidato.media?.storagePath;
    if (!storagePath) return [];
    const publicUrl = args.admin.storage.from("catalog-media").getPublicUrl(storagePath).data.publicUrl;
    return [
      {
        nome: storagePath.split("/").at(-1) ?? storagePath,
        url: publicUrl,
      },
    ];
  });
  return {
    resultado,
    envio: { produtoCodigo, legenda, imagens },
  };
}
