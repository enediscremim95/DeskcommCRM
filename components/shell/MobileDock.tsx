"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { Gear } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { itemAtivo, sidebarGroups } from "@/lib/navigation/registry";

const DESTINOS_DIARIOS = ["/app/inbox", "/app/radar", "/app/kanban", "/app/tasks"] as const;

/**
 * Atalhos da operação no polegar.
 *
 * A gaveta continua sendo o inventário completo. Este dock é a projeção das
 * quatro telas abertas durante o atendimento, mais Configurações. Os destinos
 * passam pelo mesmo registro e pela mesma permissão do sidebar, então uma
 * interface simplificada não ganha atalhos para telas que ela escondeu.
 */
export function MobileDock() {
  const pathname = usePathname();
  const t = useT();
  const { user, activeOrg } = useAuth();
  const visiveis = sidebarGroups(
    user.is_platform_admin && !user.support,
    activeOrg?.role ?? null,
    activeOrg?.interface_settings,
    activeOrg?.integration_access,
  ).flatMap((grupo) => grupo.items);

  const atalhos = DESTINOS_DIARIOS.flatMap((href) => {
    const destino = visiveis.find((item) => item.href === href);
    return destino ? [destino] : [];
  });

  if (atalhos.length === 0) return null;

  return (
    <nav
      aria-label={t("Atalhos principais")}
      className="crm-mobile-dock fixed inset-x-0 bottom-0 z-30 grid border-t md:hidden"
      style={{ gridTemplateColumns: `repeat(${atalhos.length + 1}, minmax(0, 1fr))` }}
    >
      {atalhos.map((item) => {
        const ativo = itemAtivo(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? "page" : undefined}
            className={cn(
              "flex min-h-14 min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors focus-visible:z-10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              ativo ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-7 min-w-10 items-center justify-center rounded-full px-2 transition-colors",
                ativo && "bg-accent text-accent-foreground",
              )}
            >
              <Icon size={19} weight={ativo ? "fill" : "regular"} aria-hidden />
            </span>
            <span className="max-w-full truncate">{t(item.label)}</span>
          </Link>
        );
      })}
      <Link
        href="/app/settings"
        aria-current={pathname.startsWith("/app/settings") ? "page" : undefined}
        className={cn(
          "flex min-h-14 min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors focus-visible:z-10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          pathname.startsWith("/app/settings")
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "flex h-7 min-w-10 items-center justify-center rounded-full px-2 transition-colors",
            pathname.startsWith("/app/settings") && "bg-accent text-accent-foreground",
          )}
        >
          <Gear size={19} weight={pathname.startsWith("/app/settings") ? "fill" : "regular"} aria-hidden />
        </span>
        <span className="max-w-full truncate">{t("Configurações")}</span>
      </Link>
    </nav>
  );
}
