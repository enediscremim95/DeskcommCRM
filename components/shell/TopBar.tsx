"use client";
import Link from "next/link";
import { Palette } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { AlertsBell } from "./AlertsBell";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";

export function TopBar() {
  const t = useT();
  return (
    <header className="crm-topbar sticky top-0 z-20 flex min-h-14 flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:h-14 md:flex-nowrap md:gap-4 md:px-6 md:py-0">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-initial">
        <MobileSidebar />
        <TenantSwitcher />
      </div>
      <div className="order-3 flex min-w-0 basis-full justify-center sm:order-2 sm:flex-1 sm:basis-auto md:max-w-md">
        <SearchTrigger />
      </div>
      <div className="order-2 flex min-w-0 flex-wrap items-center justify-end gap-2 sm:order-3 sm:flex-nowrap">
        <Link
          href="/app/settings/aparencia"
          aria-label={t("Aparência")}
          title={t("Aparência")}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors hover:bg-secondary"
        >
          <Palette size={17} aria-hidden />
          <span className="hidden xl:inline">{t("Aparência")}</span>
        </Link>
        <AlertsBell />
        <UserMenu />
      </div>
    </header>
  );
}
