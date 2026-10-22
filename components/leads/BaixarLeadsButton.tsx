"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { DownloadSimple } from "@/lib/ui/icons";

export function BaixarLeadsButton() {
  const t = useT();

  return (
    <Button variant="outline" asChild>
      <a href="/api/v1/leads/export" download data-testid="baixar-leads">
        <DownloadSimple size={16} weight="bold" aria-hidden />
        <span>{t("Baixar leads")}</span>
      </a>
    </Button>
  );
}
