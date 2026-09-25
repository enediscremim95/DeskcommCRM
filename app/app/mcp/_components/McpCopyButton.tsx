"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";

interface McpCopyButtonProps {
  value: string;
  label: string;
  className?: string;
}

export function McpCopyButton({ value, label, className }: McpCopyButtonProps) {
  const t = useT();

  return (
    <Button
      type="button"
      variant="secondary"
      className={className}
      onClick={() => {
        void copyToClipboard(value).then((copied) => {
          if (copied) toast.success(t("Copiado."));
          else toast.error(t("Não foi possível copiar. Selecione o texto e copie manualmente."));
        });
      }}
    >
      {label}
    </Button>
  );
}
