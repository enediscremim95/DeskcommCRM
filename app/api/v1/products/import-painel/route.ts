import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { caminhoDaImagemDoCatalogo } from "@/lib/catalogo/caminho-da-imagem";
import { baixarFotoDoPainel } from "@/lib/catalogo/foto-do-painel";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_PRODUTOS = 2_000;
const PAGINA = 500;

const produtoDoPainelSchema = z.object({
  codigo: z.string().trim().min(1).max(60),
  nome: z.string().trim().min(2).max(200),
  descricao: z.string().trim().max(2000),
  preco_cents: z.number().int().min(0),
  imagem_url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((valor) => valor.startsWith("https://"), "a foto precisa usar https")
    .optional(),
  ativo: z.boolean(),
});

const importacaoSchema = z
  .object({ produtos: z.array(produtoDoPainelSchema).max(MAX_PRODUTOS) })
  .superRefine(({ produtos }, ctx) => {
    const vistos = new Set<string>();
    produtos.forEach((produto, indice) => {
      if (vistos.has(produto.codigo)) {
        ctx.addIssue({
          code: "custom",
          path: ["produtos", indice, "codigo"],
          message: "cada código pode aparecer uma só vez",
        });
      }
      vistos.add(produto.codigo);
    });
  });

interface ProdutoExistente {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  preco_cents: number;
  ativo: boolean;
  origem: string;
  imagem_url: string | null;
  imagem_origem_url: string | null;
}

interface FalhaDaImportacao {
  codigo: string;
  motivo: string;
}

function motivoDaFoto(erro: unknown): string {
  const codigo = erro instanceof Error ? erro.message : "erro_desconhecido";
  const conhecidos: Record<string, string> = {
    foto_exige_https: "o endereço não usa HTTPS",
    foto_host_nao_permitido: "o host não está na lista permitida",
    foto_porta_nao_permitida: "a porta não é permitida",
    foto_maior_que_5mb: "o arquivo passa de 5 MB",
    foto_bytes_invalidos: "os bytes não são JPEG nem PNG",
    "unsafe_url:private_ip": "o endereço resolve para uma rede privada",
    "unsafe_url:dns_failed": "o host não resolveu no DNS",
    "unsafe_url:dns_empty": "o host não devolveu endereço no DNS",
  };
  return conhecidos[codigo] ?? "não foi possível baixar a foto";
}

function nucleoMudou(
  existente: ProdutoExistente | undefined,
  recebido: z.infer<typeof produtoDoPainelSchema>,
): boolean {
  if (!existente) return true;
  return (
    existente.origem !== "painel" ||
    existente.nome !== recebido.nome ||
    (existente.descricao ?? "") !== recebido.descricao ||
    existente.preco_cents !== recebido.preco_cents ||
    existente.ativo !== recebido.ativo
  );
}

function fotoEstaAtual(
  existente: ProdutoExistente | undefined,
  origem: string | undefined,
  orgId: string,
): boolean {
  if (!existente) return false;
  if (!origem) return !existente.imagem_url && !existente.imagem_origem_url;
  return (
    existente.imagem_origem_url === origem &&
    caminhoDaImagemDoCatalogo(existente.imagem_url, orgId, existente.id) !== null
  );
}

/**
 * O painel não é chamado por esta rota. Quem opera envia o retrato em JSON, e
 * este handler só aplica o retrato ao tenant autenticado.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const parsed = importacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  const atuais: ProdutoExistente[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("catalog_products")
      .select(
        "id, codigo, nome, descricao, preco_cents, ativo, origem, imagem_url, imagem_origem_url",
      )
      .eq("organization_id", orgId)
      .order("id", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) {
      return fail("internal_error", t("Erro ao ler o catálogo."), 500, { requestId });
    }
    const pagina = (data ?? []) as unknown as ProdutoExistente[];
    atuais.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  const porCodigo = new Map(atuais.map((produto) => [produto.codigo, produto]));
  const codigosRecebidos = new Set(parsed.data.produtos.map((produto) => produto.codigo));
  const moeda = await moedaDaOrganizacao(supabase, orgId);
  const admin = createAdminClient();
  const falhas: FalhaDaImportacao[] = [];
  let criados = 0;
  let atualizados = 0;
  let desativados = 0;
  let ignorados = 0;

  for (const recebido of parsed.data.produtos) {
    const existente = porCodigo.get(recebido.codigo);
    const fotoAtual = fotoEstaAtual(existente, recebido.imagem_url, orgId);
    const mudou = nucleoMudou(existente, recebido) || !fotoAtual;
    if (!mudou) {
      ignorados += 1;
      continue;
    }

    const linha = {
      organization_id: orgId,
      codigo: recebido.codigo,
      nome: recebido.nome,
      descricao: recebido.descricao || null,
      preco_cents: recebido.preco_cents,
      ativo: recebido.ativo,
      origem: "painel",
      ...(!existente ? { moeda } : {}),
      ...(!fotoAtual ? { imagem_url: null, imagem_origem_url: null } : {}),
    };
    const { data: salvo, error: salvarError } = await supabase
      .from("catalog_products")
      .upsert(linha, { onConflict: "organization_id,codigo" })
      .select("id")
      .single();
    if (salvarError || !salvo) {
      falhas.push({ codigo: recebido.codigo, motivo: "Não foi possível salvar o produto." });
      continue;
    }

    const productId = (salvo as { id: string }).id;
    if (existente) atualizados += 1;
    else criados += 1;

    if (!fotoAtual) {
      const anterior = caminhoDaImagemDoCatalogo(existente?.imagem_url, orgId, existente?.id);
      if (recebido.imagem_url) {
        try {
          const foto = await baixarFotoDoPainel(recebido.imagem_url);
          const caminho = `${orgId}/${productId}/${randomUUID()}.${foto.extensao}`;
          const { error: uploadError } = await admin.storage
            .from("catalog-media")
            .upload(caminho, foto.bytes, { contentType: foto.mime, upsert: false });
          if (uploadError) throw new Error("foto_upload_falhou");
          const { data: publica } = admin.storage.from("catalog-media").getPublicUrl(caminho);
          const { data: vinculada, error: vinculoError } = await supabase
            .from("catalog_products")
            .update({
              imagem_url: publica.publicUrl,
              imagem_origem_url: recebido.imagem_url,
            })
            .eq("organization_id", orgId)
            .eq("id", productId)
            .select("id")
            .maybeSingle();
          if (vinculoError || !vinculada) {
            await admin.storage.from("catalog-media").remove([caminho]);
            throw new Error("foto_vinculo_falhou");
          }
        } catch (erro) {
          falhas.push({
            codigo: recebido.codigo,
            motivo: `Foto não importada: ${motivoDaFoto(erro)}. O produto ficou sem foto.`,
          });
        }
      }
      if (anterior) await admin.storage.from("catalog-media").remove([anterior]);
    }
  }

  for (const produto of atuais) {
    if (produto.origem !== "painel" || !produto.ativo || codigosRecebidos.has(produto.codigo)) {
      continue;
    }
    const { data, error } = await supabase
      .from("catalog_products")
      .update({ ativo: false })
      .eq("organization_id", orgId)
      .eq("id", produto.id)
      .eq("origem", "painel")
      .select("id")
      .maybeSingle();
    if (error || !data) {
      falhas.push({ codigo: produto.codigo, motivo: "Não foi possível desativar o produto." });
    } else {
      desativados += 1;
    }
  }

  await audit({
    organizationId: orgId,
    actorUserId: authz.user.id,
    action: "catalog_product.panel_imported",
    resourceType: "catalog_products",
    resourceId: null,
    requestId,
    metadata: {
      actor_type: "user",
      recebidos: parsed.data.produtos.length,
      criados,
      atualizados,
      desativados,
      ignorados,
      falhas: falhas.length,
    },
  });

  return ok({ criados, atualizados, desativados, ignorados, falhas }, { requestId });
}
