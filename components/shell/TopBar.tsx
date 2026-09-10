"use client";
import { AlertsBell } from "./AlertsBell";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur md:h-14 md:flex-nowrap md:gap-4 md:px-6 md:py-0">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-initial">
        <MobileSidebar />
        <TenantSwitcher />
      </div>
      <div className="order-3 flex min-w-0 basis-full justify-center sm:order-2 sm:basis-auto sm:flex-1 md:max-w-md">
        <SearchTrigger />
      </div>
      <div className="order-2 flex min-w-0 flex-wrap items-center justify-end gap-2 sm:order-3 sm:flex-nowrap">
        <AlertsBell />
        <UserMenu />
      </div>
    </header>
  );
}
