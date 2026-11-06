import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { baixarFotoDoPainel, type FotoBaixadaDoPainel } from "@/lib/catalogo/foto-do-painel";
import { urlDeFotoPermitida } from "@/lib/catalogo/hosts-de-foto";
import { MOEDA_PADRAO } from "@/lib/money";

const MAX_PRODUTOS = 2_000;
const MAX_FOTOS = 9;
const TAMANHO_PAGINA = 500;

const fotoSchema = z.object({
  url: z.string().trim().url().max(2_000),
  h: z.string().trim().min(1).max(200),
});
const variacaoSchema = z.object({
  codigo: z.string().trim().min(1).max(120),
  atributos: z.record(z.string(), z.string()),
  preco: z.number().finite().nonnegative(),
});
const opcaoPrecoSchema = z.object({
  muda_preco: z.boolean(),
  valores: z
    .array(
      z.object({
        valor: z.string(),
        min: z.number().finite().nonnegative(),
        max: z.number().finite().nonnegative(),
        n: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});
const embalagemSchema = z.object({
  sku: z.string().trim().min(1).max(120),
  peso_kg: z.number().finite().positive(),
  altura_cm: z.number().finite().positive(),
  largura_cm: z.number().finite().positive(),
  comprimento_cm: z.number().finite().positive(),
});
export const retratoDoPainelSchema = z.object({
  gerado_em: z.string().optional(),
  produtos: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(120),
        nome: z.string().trim().min(2).max(300),
        grupo: z.string().trim().max(120),
        tipo: z.string().trim().max(80),
        situacao: z.string().trim().min(1).max(20),
        descricao: z.string().trim().max(20_000),
        acompanha: z.array(z.string().trim().max(500)).max(100).default([]),
        precos: z.array(z.number().finite().nonnegative()).max(200).default([]),
        opcoes: z.record(z.string(), z.array(z.string())).default({}),
        opcoes_precos: z.record(z.string(), opcaoPrecoSchema).default({}),
        variacoes: z.array(variacaoSchema).max(2_000).default([]),
        peso_medidas: z
          .object({ opcoes: z.array(embalagemSchema).max(2_000).default([]) })
          .optional(),
        fotos: z.array(fotoSchema).max(MAX_FOTOS).default([]),
      }),
    )
    .max(MAX_PRODUTOS),
});

export type RetratoDoPainel = z.infer<typeof retratoDoPainelSchema>;

export interface LinhaNormalizadaDoPainel {
  codigo: string;
  produto_codigo: string;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  opcao_preco: string | null;
  preco_cents: number;
  ativo: boolean;
  peso_kg: number | null;
  altura_cm: number | null;
  largura_cm: number | null;
  comprimento_cm: number | null;
  embalagem_estimada: boolean;
}

export interface ProdutoNormalizadoDoPainel {
  sku: string;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  acompanha: string[];
  ativo: boolean;
  linhas: LinhaNormalizadaDoPainel[];
  fotos: Array<{ url: string; h: string }>;
}

export interface ResumoImportacaoPainel {
  criados: number;
  atualizados: number;
  desativados: number;
  ignorados: number;
  fotos_novas: number;
  fotos_removidas: number;
  fotos_reordenadas: number;
  falhas: Array<{ codigo: string; etapa: "produto" | "foto"; motivo: string }>;
}

export interface OpcoesImportacaoPainel {
  aplicar?: boolean;
  baixarFoto?: (url: string) => Promise<FotoBaixadaDoPainel>;
  gerarId?: () => string;
}

function centavos(valor: number): number {
  const texto = valor.toString().toLowerCase();
  if (texto.includes("e")) return Math.round(valor * 100);
  const [inteiro, decimal = ""] = texto.split(".");
  const duasCasas = `${decimal}00`.slice(0, 2);
  const terceira = Number(decimal[2] ?? "0");
  return Number(inteiro) * 100 + Number(duasCasas) + (terceira >= 5 ? 1 : 0);
}

function ativa(situacao: string, grupo: string): boolean {
  return situacao.toUpperCase() === "A" && grupo.trim().toLocaleLowerCase("pt-BR") !== "recuperados";
}

export function normalizarRetratoDoPainel(retrato: RetratoDoPainel): ProdutoNormalizadoDoPainel[] {
  return retrato.produtos.map((produto) => {
    const embalagemPorSku = new Map(
      (produto.peso_medidas?.opcoes ?? []).map((opcao) => [opcao.sku, opcao]),
    );
    const camposDeEmbalagem = (sku: string) => {
      const embalagem = embalagemPorSku.get(sku);
      return {
        peso_kg: embalagem?.peso_kg ?? null,
        altura_cm: embalagem?.altura_cm ?? null,
        largura_cm: embalagem?.largura_cm ?? null,
        comprimento_cm: embalagem?.comprimento_cm ?? null,
        // O painel atual não declara medição real. Só uma ação futura e
        // explícita poderá mudar este campo para false.
        embalagem_estimada: true,
      };
    };
    const dimensoesDePreco = Object.entries(produto.opcoes_precos)
      .filter(([, regra]) => regra.muda_preco)
      .map(([nome]) => nome)
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const porCombinacao = new Map<string, LinhaNormalizadaDoPainel>();
    for (const variacao of produto.variacoes) {
      const partes = dimensoesDePreco.map((dimensao) => `${dimensao}: ${variacao.atributos[dimensao] ?? ""}`);
      const chave = partes.join("\u001f") || produto.sku;
      const candidata = camposDeEmbalagem(variacao.codigo);
      const existente = porCombinacao.get(chave);
      if (existente) {
        // Variações de cor podem compartilhar a mesma linha de preço. A caixa
        // mais pesada governa a cotação dessa linha; o código vendável continua
        // sendo o primeiro, como antes da chegada das medidas.
        if ((candidata.peso_kg ?? -1) > (existente.peso_kg ?? -1)) {
          Object.assign(existente, candidata);
        }
        continue;
      }
      porCombinacao.set(chave, {
        codigo: variacao.codigo,
        produto_codigo: produto.sku,
        nome: produto.nome,
        descricao: produto.descricao || null,
        categoria: produto.grupo || null,
        opcao_preco: partes.length > 0 ? partes.join("; ") : null,
        preco_cents: centavos(variacao.preco),
        ativo: ativa(produto.situacao, produto.grupo),
        ...candidata,
      });
    }
    if (porCombinacao.size === 0) {
      const preco = produto.precos[0];
      if (preco !== undefined) {
        porCombinacao.set(produto.sku, {
          codigo: produto.sku,
          produto_codigo: produto.sku,
          nome: produto.nome,
          descricao: produto.descricao || null,
          categoria: produto.grupo || null,
          opcao_preco: null,
          preco_cents: centavos(preco),
          ativo: ativa(produto.situacao, produto.grupo),
          ...camposDeEmbalagem(produto.sku),
        });
      }
    }
    return {
      sku: produto.sku,
      nome: produto.nome,
      descricao: produto.descricao || null,
      categoria: produto.grupo || null,
      acompanha: produto.acompanha,
      ativo: ativa(produto.situacao, produto.grupo),
      linhas: [...porCombinacao.values()],
      fotos: produto.fotos.map((foto) => {
        const url = urlDeFotoPermitida(foto.url);
        return { url: url.toString(), h: foto.h };
      }),
    };
  });
}

export function origemCanonicaDaFoto(urlBruta: string, hash: string): string {
  const url = urlDeFotoPermitida(urlBruta);
  return `${url.protocol}//${url.host}${url.pathname}?h=${encodeURIComponent(hash)}`;
}

function motivoSeguro(erro: unknown): string {
  const codigo = erro instanceof Error ? (erro.message.split(":", 1)[0] ?? "erro_desconhecido") : "erro_desconhecido";
  const permitidos = new Set([
    "foto_exige_https",
    "foto_host_nao_permitido",
    "foto_url_com_credencial",
    "foto_porta_nao_permitida",
    "foto_maior_que_5mb",
    "foto_bytes_invalidos",
    "foto_timeout",
    "foto_upload_falhou",
    "foto_sync_falhou",
  ]);
  return permitidos.has(codigo) ? codigo : "foto_importacao_falhou";
}

interface ProdutoAtual {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  preco_cents: number;
  ativo: boolean;
  origem: string;
  produto_codigo: string | null;
  opcao_preco: string | null;
  peso_kg: number | string | null;
  altura_cm: number | string | null;
  largura_cm: number | string | null;
  comprimento_cm: number | string | null;
  embalagem_estimada: boolean;
}

interface FotoAtual {
  produto_codigo: string;
  posicao: number;
  storage_path: string;
  mime_type: "image/jpeg" | "image/png";
  size_bytes: number;
  source_hash: string;
  imagem_origem_url: string;
}

export function planejarGaleria(
  recebidas: Array<{ h: string }>,
  antigas: Array<{ source_hash: string; posicao: number }>,
): { novas: string[]; removidas: string[]; reordenadas: string[] } {
  const porHash = new Map(antigas.map((foto) => [foto.source_hash, foto]));
  return {
    novas: recebidas.filter((foto) => !porHash.has(foto.h)).map((foto) => foto.h),
    removidas: antigas
      .filter((foto) => !recebidas.some((recebida) => recebida.h === foto.source_hash))
      .map((foto) => foto.source_hash),
    reordenadas: recebidas
      .filter((foto, indice) => porHash.get(foto.h)?.posicao !== indice + 1)
      .map((foto) => foto.h),
  };
}

function linhaMudou(atual: ProdutoAtual | undefined, linha: LinhaNormalizadaDoPainel): boolean {
  const igual = (a: number | string | null | undefined, b: number | null) =>
    a == null ? b === null : b !== null && Number(a) === b;
  return (
    !atual ||
    atual.origem !== "painel" ||
    atual.nome !== linha.nome ||
    atual.descricao !== linha.descricao ||
    atual.categoria !== linha.categoria ||
    atual.preco_cents !== linha.preco_cents ||
    atual.ativo !== linha.ativo ||
    atual.produto_codigo !== linha.produto_codigo ||
    atual.opcao_preco !== linha.opcao_preco ||
    !igual(atual.peso_kg, linha.peso_kg) ||
    !igual(atual.altura_cm, linha.altura_cm) ||
    !igual(atual.largura_cm, linha.largura_cm) ||
    !igual(atual.comprimento_cm, linha.comprimento_cm) ||
    (atual.embalagem_estimada ?? true) !== linha.embalagem_estimada
  );
}

export async function importarCatalogoDoPainel(
  admin: SupabaseClient,
  orgId: string,
  retratoBruto: unknown,
  opts: OpcoesImportacaoPainel = {},
): Promise<ResumoImportacaoPainel> {
  const retrato = retratoDoPainelSchema.parse(retratoBruto);
  const produtos = normalizarRetratoDoPainel(retrato);
  const aplicar = opts.aplicar === true;
  const baixarFoto = opts.baixarFoto ?? baixarFotoDoPainel;
  const gerarId = opts.gerarId ?? randomUUID;
  const resumo: ResumoImportacaoPainel = {
    criados: 0,
    atualizados: 0,
    desativados: 0,
    ignorados: 0,
    fotos_novas: 0,
    fotos_removidas: 0,
    fotos_reordenadas: 0,
    falhas: [],
  };

  const atuais: ProdutoAtual[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await admin
      .from("catalog_products")
      .select(
        "id,codigo,nome,descricao,categoria,preco_cents,ativo,origem,produto_codigo,opcao_preco,peso_kg,altura_cm,largura_cm,comprimento_cm,embalagem_estimada",
      )
      .eq("organization_id", orgId)
      .order("id", { ascending: true })
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw new Error("catalogo_leitura_falhou");
    const pagina = (data ?? []) as unknown as ProdutoAtual[];
    atuais.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) break;
  }
  const fotosAtuais: FotoAtual[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await admin
      .from("catalog_product_images")
      .select("produto_codigo,posicao,storage_path,mime_type,size_bytes,source_hash,imagem_origem_url")
      .eq("organization_id", orgId)
      .order("produto_codigo", { ascending: true })
      .order("posicao", { ascending: true })
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw new Error("catalogo_leitura_falhou");
    const pagina = (data ?? []) as unknown as FotoAtual[];
    fotosAtuais.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) break;
  }
  const { data: orgData } = await admin.from("organizations").select("currency").eq("id", orgId).maybeSingle();
  const moeda = ((orgData as { currency?: string } | null)?.currency ?? MOEDA_PADRAO).toUpperCase();
  const porCodigo = new Map(atuais.map((linha) => [linha.codigo, linha]));
  const codigosRecebidos = new Set(produtos.flatMap((produto) => produto.linhas.map((linha) => linha.codigo)));

  for (const produto of produtos) {
    if (aplicar) {
      const { error } = await admin.from("catalog_product_groups").upsert(
        {
          organization_id: orgId,
          produto_codigo: produto.sku,
          nome: produto.nome,
          descricao: produto.descricao,
          acompanha: produto.acompanha,
          categoria: produto.categoria,
          ativo: produto.ativo,
          origem: "painel",
        },
        { onConflict: "organization_id,produto_codigo" },
      );
      if (error) {
        resumo.falhas.push({ codigo: produto.sku, etapa: "produto", motivo: "produto_pai_falhou" });
        continue;
      }
    }

    for (const linha of produto.linhas) {
      const atual = porCodigo.get(linha.codigo);
      if (!linhaMudou(atual, linha)) {
        resumo.ignorados += 1;
        continue;
      }
      if (aplicar) {
        const { error } = await admin.from("catalog_products").upsert(
          {
            organization_id: orgId,
            ...linha,
            moeda,
            origem: "painel",
            controla_estoque: false,
          },
          { onConflict: "organization_id,codigo" },
        );
        if (error) {
          resumo.falhas.push({ codigo: linha.codigo, etapa: "produto", motivo: "linha_preco_falhou" });
          continue;
        }
      }
      if (atual) resumo.atualizados += 1;
      else resumo.criados += 1;
    }

    const antigas = fotosAtuais.filter((foto) => foto.produto_codigo === produto.sku);
    const porHash = new Map(antigas.map((foto) => [foto.source_hash, foto]));
    const plano = planejarGaleria(produto.fotos, antigas);
    resumo.fotos_novas += plano.novas.length;
    resumo.fotos_removidas += plano.removidas.length;
    resumo.fotos_reordenadas += plano.reordenadas.length;
    if (!aplicar || (plano.novas.length === 0 && plano.removidas.length === 0 && plano.reordenadas.length === 0)) continue;

    const uploadsNovos: string[] = [];
    const galeria: Array<Omit<FotoAtual, "produto_codigo">> = [];
    let falhou = false;
    for (const [indice, foto] of produto.fotos.entries()) {
      const existente = porHash.get(foto.h);
      if (existente) {
        galeria.push({ ...existente, posicao: indice + 1 });
        continue;
      }
      try {
        const baixada = await baixarFoto(foto.url);
        const caminho = `${orgId}/${produto.sku}/${gerarId()}.${baixada.extensao}`;
        const { error } = await admin.storage
          .from("catalog-media")
          .upload(caminho, baixada.bytes, { contentType: baixada.mime, upsert: false });
        if (error) throw new Error("foto_upload_falhou");
        uploadsNovos.push(caminho);
        galeria.push({
          posicao: indice + 1,
          storage_path: caminho,
          mime_type: baixada.mime,
          size_bytes: baixada.bytes.byteLength,
          source_hash: foto.h,
          imagem_origem_url: origemCanonicaDaFoto(foto.url, foto.h),
        });
      } catch (erro) {
        resumo.falhas.push({ codigo: produto.sku, etapa: "foto", motivo: motivoSeguro(erro) });
        falhou = true;
        break;
      }
    }
    if (falhou) {
      if (uploadsNovos.length > 0) await admin.storage.from("catalog-media").remove(uploadsNovos);
      continue;
    }
    const { error: syncError } = await admin.rpc("fn_sync_catalog_product_images", {
      p_organization_id: orgId,
      p_produto_codigo: produto.sku,
      p_images: galeria,
    });
    if (syncError) {
      if (uploadsNovos.length > 0) await admin.storage.from("catalog-media").remove(uploadsNovos);
      resumo.falhas.push({ codigo: produto.sku, etapa: "foto", motivo: "foto_sync_falhou" });
      continue;
    }
    const removidas = antigas.filter((foto) => plano.removidas.includes(foto.source_hash));
    if (removidas.length > 0) {
      await admin.storage.from("catalog-media").remove(removidas.map((foto) => foto.storage_path));
    }
    const primeira = galeria[0];
    const imagemUrl = primeira
      ? admin.storage.from("catalog-media").getPublicUrl(primeira.storage_path).data.publicUrl
      : null;
    await admin
      .from("catalog_products")
      .update({ imagem_url: imagemUrl, imagem_origem_url: primeira?.imagem_origem_url ?? null })
      .eq("organization_id", orgId)
      .eq("produto_codigo", produto.sku);
  }

  for (const atual of atuais) {
    if (atual.origem !== "painel" || !atual.ativo || codigosRecebidos.has(atual.codigo)) continue;
    if (aplicar) {
      const { error } = await admin
        .from("catalog_products")
        .update({ ativo: false })
        .eq("organization_id", orgId)
        .eq("id", atual.id)
        .eq("origem", "painel");
      if (error) {
        resumo.falhas.push({ codigo: atual.codigo, etapa: "produto", motivo: "desativacao_falhou" });
        continue;
      }
    }
    resumo.desativados += 1;
  }
  return resumo;
}
