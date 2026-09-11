"use client";
/**
 * O cartão "Modelo de negócio" na tela da organização.
 *
 * Fica ao lado de Ações e não dentro do formulário de criação por uma razão de
 * operação: aplicar template é a SEGUNDA coisa que se faz num cliente novo, e
 * quem cria a organização muitas vezes não é quem sabe qual nicho ela é. Junto
 * com a criação, a escolha teria que ser feita antes da conversa com o cliente.
 *
 * A tela avisa, antes do clique, que o funil vai ser substituído — porque vai.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/i18n/useT";
import {
  useAplicarTemplate,
  useCatalogoDeTemplates,
  type TemplateDoCatalogo,
} from "@/hooks/useTemplateDeOrganizacao";

interface TenantTemplateProps {
  organizationId: string;
  /** `redacted` esconde a ação: não se reconfigura tenant anonimizado. */
  status: "active" | "suspended" | "redacted";
}

export function TenantTemplate({ organizationId, status }: TenantTemplateProps) {
  const t = useT();
  const [confirmando, setConfirmando] = useState<TemplateDoCatalogo | null>(null);
  const { data, isLoading } = useCatalogoDeTemplates(organizationId);
  const aplicar = useAplicarTemplate();

  if (status !== "active") return null;

  const catalogo = data?.data?.catalogo ?? [];
  const aplicado = data?.data?.aplicado ?? null;

  return (
    <>
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t("Modelo de negócio")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "Deixa o funil, os campos, as respostas prontas e o atendente prontos para o nicho do cliente.",
            )}
          </p>
        </div>

        {aplicado && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            {t("Já aplicado:")}{" "}
            <span className="font-medium text-foreground">
              {catalogo.find((c) => c.id === aplicado.id)?.nome ?? aplicado.id}
            </span>
          </p>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
          </div>
        ) : (
          <div className="space-y-2">
            {catalogo.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setConfirmando(tpl)}
                disabled={aplicar.isPending}
                className="w-full rounded-md border px-3 py-2.5 text-left transition-colors hover:border-foreground/40 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block text-sm font-medium">{t(tpl.nome)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(tpl.para_quem)}
                </span>
                <span className="mt-1.5 block text-[11px] text-muted-foreground">
                  {tpl.quantos_campos} {t("campos")} · {tpl.quantas_respostas}{" "}
                  {t("respostas prontas")} · {tpl.quantas_cadencias}{" "}
                  {t("cadências (desligadas)")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!confirmando} onOpenChange={(o) => !o && setConfirmando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Aplicar")} {confirmando ? t(confirmando.nome) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {t(
                    "As colunas do funil atual serão substituídas pelas do modelo. Só funciona em funil vazio: se já tiver negócio dentro, nada é alterado.",
                  )}
                </p>
                <p>
                  {t(
                    "O atendente recebe as instruções do nicho em rascunho, sem publicar. As cadências entram desligadas. Contatos, conversas e canais não são tocados.",
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicar.isPending}>{t("Cancelar")}</AlertDialogCancel>
            <Button
              disabled={aplicar.isPending}
              onClick={() => {
                if (!confirmando) return;
                aplicar.mutate(
                  { tenantId: organizationId, templateId: confirmando.id },
                  { onSettled: () => setConfirmando(null) },
                );
              }}
            >
              {aplicar.isPending ? t("Aplicando…") : t("Aplicar modelo")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
