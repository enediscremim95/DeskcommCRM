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
    <header className="crm-topbar sticky top-0 z-20 flex h-14 flex-nowrap items-center gap-2 border-b bg-background/95 px-2 backdrop-blur sm:px-4 lg:gap-4 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2 lg:flex-initial [&>button]:min-w-0 [&>button:first-child]:shrink-0">
        <MobileSidebar />
        <TenantSwitcher />
      </div>
      <div className="flex shrink-0 items-center justify-end lg:min-w-0 lg:max-w-md lg:flex-1 lg:justify-center">
        <SearchTrigger />
      </div>
      <div className="flex w-auto min-w-0 flex-nowrap items-center justify-end gap-1 sm:gap-2">
        <Link
          href="/app/settings/aparencia"
          aria-label={t("Aparência")}
          title={t("Aparência")}
          className="hidden h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors hover:bg-secondary sm:inline-flex"
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
