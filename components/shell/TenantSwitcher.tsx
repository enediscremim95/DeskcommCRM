"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";
import { useOrganizationTransition } from "./OrganizationTransitionProvider";
import { CaretDown, Storefront } from "@/lib/ui/icons";
import { useUser, useActiveOrg } from "@/hooks/auth/AuthProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gravarOrgDaAba } from "@/lib/auth/org-da-aba";
import { setActiveOrg } from "@/app/actions/shell/setActiveOrg";

/**
 * Acima disto, a lista deixa de caber na tela e achar a organização pelo olho
 * vira rolagem: a busca aparece. Abaixo, o campo só ocuparia espaço.
 */
const MINIMO_PARA_BUSCAR = 6;

/** Direto no quadro do funil padrão quando o servidor já o informou. */
export function destinoAposTroca(pipelineId?: string): string {
  return pipelineId && /^[0-9a-f-]{36}$/i.test(pipelineId) ? `/app/pipelines/${pipelineId}` : "/app/kanban";
}

/** Teto da troca: acima disto a sobreposição "Carregando…" vira erro com saída. */
export const PRAZO_DA_TROCA_MS = 20_000;

/** Rejeita se `promessa` não resolver em `ms` — a Server Action não é abortável. */
export function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("troca_excedeu_o_prazo")), ms);
    promessa.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

export function TenantSwitcher() {
  const t = useT();
  const user = useUser();
  const active = useActiveOrg();
  const transition = useOrganizationTransition();
  const [isPending, setPending] = useState(false);
  const [busca, setBusca] = useState("");
  // Trava SÍNCRONA: o estado `isPending` só vale no próximo render, e dois
  // eventos do mesmo toque (select + click) passavam os dois.
  const emTroca = useRef(false);
  const switchTo = async (orgId: string) => {
    if (orgId === active?.orgId || isPending || emTroca.current) return;
    emTroca.current = true;
    flushSync(() => { setPending(true); transition.begin(t("Carregando organização…")); });
    try {
      const result = await comPrazo(setActiveOrg(orgId), PRAZO_DA_TROCA_MS);
      if (!result.ok) throw new Error(result.error);
      // A org é POR ABA: grava antes de navegar, senão o recarregamento desta
      // aba voltaria à org que outra aba escolheu por último (cookie compartilhado).
      gravarOrgDaAba(orgId);
      // Novo documento elimina QueryClient, subscriptions e respostas em voo.
      window.location.assign(destinoAposTroca(result.pipelineId));
    } catch {
      emTroca.current = false;
      transition.cancel();
      setPending(false);
      toast.error(t("Não foi possível trocar de organização. Seu acesso pode ter mudado. Tente novamente."));
    }
  };

  if (user.organizations.length <= 1 && !user.is_platform_admin) return null;

  // Sem acento e sem caixa: quem digita "imobiliaria" acha "Imobiliária".
  const semAcento = (texto: string) =>
    texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const alvo = semAcento(busca.trim());
  const organizacoes = alvo
    ? user.organizations.filter((org) => semAcento(org.organization_name).includes(alvo))
    : user.organizations;
  const mostrarBusca = user.organizations.length >= MINIMO_PARA_BUSCAR;

  return (
    <DropdownMenu onOpenChange={(aberto) => { if (!aberto) setBusca(""); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={isPending || !!user.support} className="gap-2" title={user.support ? "Saia do acompanhamento para trocar de organização" : undefined} data-testid="tenant-switcher">
          <Storefront size={16} weight="duotone" aria-hidden />
          <span className="max-w-[160px] truncate">{active?.name ?? "Selecionar org"}</span>
          <CaretDown size={12} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        {mostrarBusca && (
          <div className="px-2 pt-1 pb-2" onKeyDown={(event) => event.stopPropagation()}>
            <Input
              autoFocus
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder={t("Buscar organização…")}
              aria-label={t("Buscar organização")}
              data-testid="tenant-switcher-busca"
              className="h-8"
            />
          </div>
        )}
        {organizacoes.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {t("Nenhuma organização com esse nome")}
          </p>
        )}
        {organizacoes.map((org) => (
          <DropdownMenuItem
            key={org.organization_id}
            data-testid={`tenant-switcher-item-${org.organization_id}`}
            // onSelect (e não onClick): é o evento do Radix para ponteiro, toque e
            // Enter/Espaço. onClick perdia o toque quando o item era re-renderizado
            // entre o pressionar e o soltar.
            onSelect={() => { void switchTo(org.organization_id); }}
            className="flex items-center justify-between"
          >
            <span className="truncate">{org.organization_name}</span>
            {active?.orgId === org.organization_id && <span className="text-xs text-muted-foreground">✓</span>}
          </DropdownMenuItem>
        ))}
        {user.is_platform_admin && <DropdownMenuItem asChild>
          <Link href="/admin/tenants">{t("Gerenciar organizações")}</Link>
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
