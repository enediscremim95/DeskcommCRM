"use client";
import Link from "next/link";
import { useState } from "react";
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
import { setActiveOrg } from "@/app/actions/shell/setActiveOrg";

/**
 * Acima disto, a lista deixa de caber na tela e achar a organização pelo olho
 * vira rolagem: a busca aparece. Abaixo, o campo só ocuparia espaço.
 */
const MINIMO_PARA_BUSCAR = 6;

export function TenantSwitcher() {
  const t = useT();
  const user = useUser();
  const active = useActiveOrg();
  const transition = useOrganizationTransition();
  const [isPending, setPending] = useState(false);
  const [busca, setBusca] = useState("");
  const switchTo = async (orgId: string) => {
    if (orgId === active?.orgId) return;
    flushSync(() => { setPending(true); transition.begin(t("Carregando organização…")); });
    try {
      const result = await setActiveOrg(orgId);
      if (!result.ok) throw new Error(result.error);
      // Novo documento elimina QueryClient, subscriptions e respostas em voo.
      window.location.assign("/app/inbox");
    } catch {
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
            onClick={() => { void switchTo(org.organization_id); }}
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
