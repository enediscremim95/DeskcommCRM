"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CaretRight } from "@/lib/ui/icons";
import { NAV_DESTINATIONS, NAV_GROUPS } from "@/lib/navigation/registry";
import { useT } from "@/hooks/i18n/useT";

/**
 * Trilha derivada do mesmo catálogo que alimenta menu, hubs e busca. Assim uma
 * página não ganha um segundo nome ou uma segunda hierarquia só para o header.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const t = useT();
  const destination = [...NAV_DESTINATIONS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  if (!destination) return null;

  const group = NAV_GROUPS.find((item) => item.id === destination.group);
  const parent = group?.hub;

  return (
    <nav aria-label={t("Trilha de navegação")} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {parent ? (
        <Link href={parent.href} className="truncate hover:text-foreground focus-visible:text-foreground">
          {t(parent.label)}
        </Link>
      ) : (
        <span className="truncate">{t(group?.label ?? destination.label)}</span>
      )}
      <CaretRight size={12} aria-hidden className="shrink-0" />
      <span aria-current="page" className="truncate text-foreground">{t(destination.label)}</span>
    </nav>
  );
}
