"use client";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Sparkle } from "@/lib/ui/icons";

interface Props {
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
}

/** Gera um rascunho pelo assistente ligado da organização, sem enviar. */
export function DraftReplyButton({ onClick, pending = false, disabled }: Props) {
  const t = useT();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-9 w-9 shrink-0"
      aria-label={t("Sugerir resposta")}
      aria-busy={pending}
      disabled={disabled || pending}
      onClick={onClick}
    >
      <Sparkle size={18} weight={pending ? "duotone" : "regular"} aria-hidden />
    </Button>
  );
}
