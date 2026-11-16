"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { formatCents } from "@/lib/money";
import type { Produto } from "@/lib/schemas/produtos";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onDrafts: (drafts: RascunhoDoCatalogo[]) => void;
}

export interface RascunhoDoCatalogo {
  product_id: string;
  nome: string;
  legenda: string;
  excede_limite: boolean;
  foto: { url: string; mime: string; nome_do_arquivo: string } | null;
}

export function CatalogPickerDialog({ open, onOpenChange, conversationId, onDrafts }: Props) {
  const t = useT();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCarregando(true);
    setSelecionados([]);
    fetch("/api/v1/products", { credentials: "same-origin" })
      .then(async (response) => {
        const body = (await response.json()) as { data?: Produto[]; error?: { message?: string } };
        if (!response.ok || !body.data)
          throw new Error(body.error?.message ?? "catalog_load_failed");
        setProdutos(body.data.filter((produto) => produto.ativo));
      })
      .catch(() => toast.error(t("Não consegui carregar o catálogo.")))
      .finally(() => setCarregando(false));
  }, [open, t]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (!termo) return produtos;
    return produtos.filter((produto) =>
      [produto.nome, produto.codigo, produto.marca ?? ""]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(termo),
    );
  }, [busca, produtos]);

  function alternar(id: string) {
    setSelecionados((atuais) => {
      if (atuais.includes(id)) return atuais.filter((item) => item !== id);
      if (atuais.length >= 10) {
        toast.error(t("Escolha no máximo 10 produtos por envio."));
        return atuais;
      }
      return [...atuais, id];
    });
  }

  async function adicionarAoRascunho() {
    if (selecionados.length === 0) return;
    setEnviando(true);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversationId}/catalog-items/draft`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_ids: selecionados }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        data?: RascunhoDoCatalogo[];
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message ?? t("Não consegui preparar os rascunhos."));
      }
      onDrafts(body.data);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Não consegui preparar os rascunhos."),
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Adicionar produtos ao rascunho")}</DialogTitle>
          <DialogDescription>
            {t(
              "Escolha até 10 produtos. Você poderá revisar e editar cada legenda antes de enviar.",
            )}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder={t("Buscar por nome, código ou marca")}
          aria-label={t("Buscar produtos")}
        />
        <div className="max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
          {carregando ? (
            <p className="py-8 text-center text-sm">{t("Carregando catálogo…")}</p>
          ) : null}
          {!carregando && filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("Nenhum produto ativo encontrado.")}
            </p>
          ) : null}
          {filtrados.map((produto) => {
            const marcado = selecionados.includes(produto.id);
            return (
              <button
                key={produto.id}
                type="button"
                onClick={() => alternar(produto.id)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted"
                aria-pressed={marcado}
              >
                <input type="checkbox" checked={marcado} readOnly className="pointer-events-none" />
                {produto.imagem_url ? (
                  <img
                    src={produto.imagem_url}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-md bg-muted" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{produto.nome}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatCents(produto.preco_cents, produto.moeda)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
            {t("Cancelar")}
          </Button>
          <Button
            onClick={() => void adicionarAoRascunho()}
            disabled={enviando || selecionados.length === 0}
          >
            {enviando ? t("Preparando…") : t("Adicionar ao rascunho")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
