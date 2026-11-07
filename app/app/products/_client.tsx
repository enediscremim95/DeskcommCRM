"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { imagemEhDoCatalogoGerenciado } from "@/lib/catalogo/caminho-da-imagem";
import { formatCents } from "@/lib/money";
import { precoParaCentavos, type Produto } from "@/lib/schemas/produtos";

interface Textos {
  titulo: string;
  subtitulo: string;
  vazio: string;
  vazioDica: string;
}

interface ResumoDaImportacao {
  total_linhas: number;
  criados: number;
  atualizados: number;
  erros: Array<{ linha: number; motivo: string }>;
  colunas_ignoradas: string[];
}

interface Rascunho {
  codigo: string;
  nome: string;
  descricao: string;
  marca: string;
  categoria: string;
  preco: string;
  custo: string;
  quantidade: string;
  controla_estoque: boolean;
  ativo: boolean;
  legendaAtendimento: string;
}

const VAZIO: Rascunho = {
  codigo: "",
  nome: "",
  descricao: "",
  marca: "",
  categoria: "",
  preco: "",
  custo: "",
  quantidade: "0",
  controla_estoque: true,
  ativo: true,
  legendaAtendimento: "",
};

function rascunhoDoProduto(produto: Produto): Rascunho {
  const dinheiro = (valor: number | null) =>
    valor === null ? "" : (valor / 100).toFixed(2).replace(".", ",");
  return {
    codigo: produto.codigo,
    nome: produto.nome,
    descricao: produto.descricao ?? "",
    marca: produto.marca ?? "",
    categoria: produto.categoria ?? "",
    preco: dinheiro(produto.preco_cents),
    custo: dinheiro(produto.custo_cents),
    quantidade: String(produto.quantidade),
    controla_estoque: produto.controla_estoque,
    ativo: produto.ativo,
    legendaAtendimento: produto.legenda_atendimento ?? "",
  };
}

function doRascunho(
  r: Rascunho,
  t: (s: string) => string,
): Record<string, unknown> | { erro: string } {
  const preco_cents = precoParaCentavos(r.preco);
  if (preco_cents === null) return { erro: t("Preço inválido. Escreva assim: 5.499,00") };
  const custo_cents = r.custo.trim() === "" ? null : precoParaCentavos(r.custo);
  if (r.custo.trim() !== "" && custo_cents === null) return { erro: t("Custo inválido.") };

  return {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    descricao: r.descricao.trim() || undefined,
    ...(r.marca.trim() ? { marca: r.marca.trim() } : {}),
    ...(r.categoria.trim() ? { categoria: r.categoria.trim() } : {}),
    preco_cents,
    custo_cents,
    controla_estoque: r.controla_estoque,
    quantidade: Number(r.quantidade) || 0,
    ativo: r.ativo,
    legenda_atendimento: r.legendaAtendimento.trim() || null,
  };
}

export function ProdutosClient({
  inicial,
  podeEditar,
  textos,
}: {
  inicial: Produto[];
  podeEditar: boolean;
  textos: Textos;
}) {
  const t = useT();
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [criando, setCriando] = React.useState(false);
  const [editando, setEditando] = React.useState<Produto | null>(null);
  const [rascunho, setRascunho] = React.useState<Rascunho>(VAZIO);
  const [imagem, setImagem] = React.useState<File | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const [importando, setImportando] = React.useState(false);
  const [resumo, setResumo] = React.useState<ResumoDaImportacao | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q === "") return inicial;
    return inicial.filter((p) =>
      [p.nome, p.codigo, p.marca ?? "", p.categoria ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [inicial, busca]);

  async function salvar() {
    const vemDoPainel = editando?.origem === "painel";
    const corpo = vemDoPainel
      ? { legenda_atendimento: rascunho.legendaAtendimento.trim() || null }
      : doRascunho(rascunho, t);
    if ("erro" in corpo) {
      toast.error(corpo.erro as string);
      return;
    }
    setSalvando(true);
    let produtoFoiSalvo = false;
    try {
      const salvo = editando
        ? await apiClient.patch<{ data: Produto }>(`/api/v1/products/${editando.id}`, corpo)
        : await apiClient.post<{ data: Produto }>("/api/v1/products", corpo);
      produtoFoiSalvo = true;
      if (imagem && !vemDoPainel) {
        const form = new FormData();
        form.set("file", imagem);
        const resposta = await fetch(`/api/v1/products/${salvo.data.id}/image`, {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        if (!resposta.ok) {
          const body = (await resposta.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(body?.error?.message ?? t("O produto foi salvo, mas a imagem não."));
        }
      }
      toast.success(t(editando ? "Produto atualizado" : "Produto cadastrado"));
      setRascunho(VAZIO);
      setImagem(null);
      setEditando(null);
      setCriando(false);
      router.refresh();
    } catch (e) {
      if (e instanceof Error) toast.error(e.message);
      else showApiError(e);
      if (produtoFoiSalvo) {
        setRascunho(VAZIO);
        setImagem(null);
        setEditando(null);
        setCriando(false);
        router.refresh();
      }
    } finally {
      setSalvando(false);
    }
  }

  async function importar(arquivo: File) {
    setImportando(true);
    setResumo(null);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      const res = await fetch("/api/v1/products/import", { method: "POST", body: form });
      const json = (await res.json()) as
        { data: ResumoDaImportacao } | { error?: { message?: string } };
      if (!res.ok || !("data" in json)) {
        const msg = "error" in json ? json.error?.message : undefined;
        toast.error(msg ?? t("Não consegui ler essa planilha."));
        return;
      }
      // O resumo fica NA TELA, não num toast que some em 4 segundos: quem
      // importou 300 produtos precisa ler quais linhas foram recusadas e por quê.
      setResumo(json.data);
      router.refresh();
    } catch {
      toast.error(t("Não consegui enviar o arquivo."));
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function alternarAtivo(p: Produto) {
    try {
      await apiClient.patch(`/api/v1/products/${p.id}`, { ativo: !p.ativo });
      toast.success(t(p.ativo ? "Produto desativado" : "Produto reativado"));
      router.refresh();
    } catch (e) {
      showApiError(e);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-6" data-testid="tela-produtos">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{textos.titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{textos.subtitulo}</p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t("Buscar por nome, código ou marca")}
          className="h-9 w-full max-w-sm rounded-md border px-3 text-sm"
          data-testid="busca-produto"
        />
        {podeEditar ? (
          <>
            <Button
              onClick={() => {
                setCriando((v) => !v);
                setEditando(null);
                setRascunho(VAZIO);
                setImagem(null);
              }}
              data-testid="novo-produto"
            >
              {t(criando ? "Cancelar" : "Novo produto")}
            </Button>
            <input
              ref={arquivoRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="arquivo-planilha"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importar(f);
              }}
            />
            <Button
              variant="outline"
              disabled={importando}
              onClick={() => arquivoRef.current?.click()}
              data-testid="importar-planilha"
            >
              {t(importando ? "Importando…" : "Importar planilha")}
            </Button>
          </>
        ) : null}
      </div>

      {podeEditar ? (
        // Rota de API que devolve o arquivo com `content-disposition:
        // attachment` — é download, não navegação de página, e `<Link>` do Next
        // faria navegação de cliente para algo que não é tela.
        <a
          href="/api/v1/products/import"
          download="modelo-catalogo.csv"
          className="mb-4 inline-block text-xs text-muted-foreground underline"
          data-testid="modelo-planilha"
        >
          {t("Baixar planilha modelo")}
        </a>
      ) : null}

      {resumo ? (
        <div className="mb-6 rounded-lg border p-4 text-sm" data-testid="resumo-importacao">
          <p className="font-medium">
            {resumo.criados} {t("novos")} · {resumo.atualizados} {t("atualizados")} ·{" "}
            {resumo.total_linhas} {t("linhas na planilha")}
          </p>
          {resumo.colunas_ignoradas.length > 0 ? (
            <p className="mt-2 text-muted-foreground">
              {t("Não usei estas colunas:")} {resumo.colunas_ignoradas.join(", ")}.
            </p>
          ) : null}
          {resumo.erros.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium">{t("Linhas que não entraram:")}</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {resumo.erros.slice(0, 20).map((e) => (
                  <li key={`${e.linha}-${e.motivo}`}>
                    {t("Linha")} {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
              {resumo.erros.length > 20 ? (
                <p className="mt-1 text-muted-foreground">
                  {t("…e mais")} {resumo.erros.length - 20}.
                </p>
              ) : null}
            </div>
          ) : null}
          <button className="mt-3 text-xs underline" onClick={() => setResumo(null)}>
            {t("Fechar")}
          </button>
        </div>
      ) : null}

      {criando && podeEditar ? (
        <div className="mb-6 rounded-lg border p-4" data-testid="form-produto">
          {editando?.origem === "painel" ? (
            <div className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">
              <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                {t("Vem do painel")}
              </span>
              <p className="mt-2 text-muted-foreground">
                {t("Nome, descrição, preço, foto e situação são alterados no painel de produtos.")}
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("Código")}
              <input
                value={rascunho.codigo}
                onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })}
                disabled={editando?.origem === "painel"}
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="produto-codigo"
              />
            </label>
            <label className="text-sm">
              {t("Nome")}
              <input
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                disabled={editando?.origem === "painel"}
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="produto-nome"
              />
            </label>
            <label className="text-sm">
              {t("Marca")}
              <input
                value={rascunho.marca}
                onChange={(e) => setRascunho({ ...rascunho, marca: e.target.value })}
                disabled={editando?.origem === "painel"}
                className="mt-1 h-9 w-full rounded-md border px-3"
              />
            </label>
            <label className="text-sm">
              {t("Categoria")}
              <input
                value={rascunho.categoria}
                onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value })}
                disabled={editando?.origem === "painel"}
                className="mt-1 h-9 w-full rounded-md border px-3"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              {t("Descrição")}
              <textarea
                value={rascunho.descricao}
                onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
                disabled={editando?.origem === "painel"}
                maxLength={2000}
                rows={3}
                className="mt-1 w-full rounded-md border px-3 py-2"
                data-testid="produto-descricao"
              />
            </label>
            <label className="text-sm">
              {t("Preço de venda")}
              <input
                value={rascunho.preco}
                onChange={(e) => setRascunho({ ...rascunho, preco: e.target.value })}
                disabled={editando?.origem === "painel"}
                placeholder="5.499,00"
                className="mt-1 h-9 w-full rounded-md border px-3"
                data-testid="produto-preco"
              />
            </label>
            <label className="text-sm">
              {t("Custo")} <span className="text-muted-foreground">{t("(opcional)")}</span>
              <input
                value={rascunho.custo}
                onChange={(e) => setRascunho({ ...rascunho, custo: e.target.value })}
                disabled={editando?.origem === "painel"}
                placeholder="4.100,00"
                className="mt-1 h-9 w-full rounded-md border px-3"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(
                  "Serve para o atendente saber até onde pode negociar. Não aparece para o cliente.",
                )}
              </span>
            </label>
          </div>

          <label className="mt-3 block text-sm">
            {t("Legenda personalizada do atendimento")}{" "}
            <span className="text-muted-foreground">{t("(opcional)")}</span>
            <textarea
              value={rascunho.legendaAtendimento}
              onChange={(e) => setRascunho({ ...rascunho, legendaAtendimento: e.target.value })}
              maxLength={4000}
              rows={3}
              className="mt-1 w-full rounded-md border px-3 py-2"
              data-testid="produto-legenda-atendimento"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {t(
                "Quando preenchida, substitui a descrição na mensagem enviada. Nome e preço permanecem.",
              )}
            </span>
          </label>

          <label className="mt-3 block text-sm">
            {t("Imagem do produto")}
            {editando?.origem === "painel" ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("A foto deste produto é atualizada pelo painel.")}
              </span>
            ) : (
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={(e) => setImagem(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm"
                data-testid="produto-imagem"
              />
            )}
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("JPEG ou PNG até 5 MB.")}
            </span>
          </label>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rascunho.controla_estoque}
              onChange={(e) => setRascunho({ ...rascunho, controla_estoque: e.target.checked })}
              disabled={editando?.origem === "painel"}
              data-testid="produto-controla-estoque"
            />
            {t("Controlar estoque deste produto")}
          </label>
          {rascunho.controla_estoque ? (
            <label className="mt-2 block text-sm">
              {t("Quantidade")}
              <input
                value={rascunho.quantidade}
                onChange={(e) => setRascunho({ ...rascunho, quantidade: e.target.value })}
                disabled={editando?.origem === "painel"}
                className="mt-1 h-9 w-32 rounded-md border px-3"
              />
            </label>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                "Sem controle de estoque, este produto sempre aparece como disponível para o atendente — é o certo para item sob encomenda ou fracionado.",
              )}
            </p>
          )}

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rascunho.ativo}
              onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })}
              disabled={editando?.origem === "painel"}
            />
            {t("Produto ativo")}
          </label>

          <div className="mt-4">
            <Button onClick={salvar} disabled={salvando} data-testid="salvar-produto">
              {t(salvando ? "Salvando…" : "Salvar produto")}
            </Button>
          </div>
        </div>
      ) : null}

      {filtrados.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-8 text-center"
          data-testid="produtos-vazio"
        >
          <p className="font-medium">{textos.vazio}</p>
          <p className="mt-1 text-sm text-muted-foreground">{textos.vazioDica}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="lista-produtos">
          {filtrados.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-4 p-3"
              data-testid={`produto-${p.codigo}`}
            >
              {p.imagem_url ? (
                <img
                  src={p.imagem_url}
                  alt={p.nome}
                  className="h-14 w-14 shrink-0 rounded-md border object-cover"
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-md border bg-muted" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate font-medium ${p.ativo ? "" : "text-muted-foreground line-through"}`}
                >
                  {p.nome}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.codigo}
                  {p.marca ? ` · ${p.marca}` : ""}
                  {p.controla_estoque
                    ? ` · ${p.quantidade} ${t("em estoque")}`
                    : ` · ${t("sem controle de estoque")}`}
                </p>
                {p.descricao ? (
                  <p className="line-clamp-1 text-xs text-muted-foreground">{p.descricao}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {p.origem === "painel" ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {t("Vem do painel")}
                    </span>
                  ) : null}
                  {p.imagem_url && !imagemEhDoCatalogoGerenciado(p.imagem_url) ? (
                    <span className="text-amber-700" data-testid={`imagem-externa-${p.codigo}`}>
                      {t("Imagem externa: no envio, este produto sai como texto.")}
                    </span>
                  ) : null}
                </div>
              </div>
              <span className="shrink-0 font-medium tabular-nums">
                {formatCents(p.preco_cents, p.moeda)}
              </span>
              {podeEditar ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRascunho(rascunhoDoProduto(p));
                      setImagem(null);
                      setEditando(p);
                      setCriando(true);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    data-testid={`editar-${p.codigo}`}
                  >
                    {t("Editar")}
                  </Button>
                  {p.origem !== "painel" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void alternarAtivo(p)}
                      data-testid={`alternar-${p.codigo}`}
                    >
                      {t(p.ativo ? "Desativar" : "Reativar")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
