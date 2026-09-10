import Link from "next/link";

import { CaretLeft } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface VoltarProps {
  href: string;
  children: string;
  className?: string;
}

/** Retorno determinístico para listas, sem depender do histórico do navegador. */
export function Voltar({ href, children, className }: VoltarProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
        className,
      )}
    >
      <CaretLeft size={16} aria-hidden />
      {children}
    </Link>
  );
}
