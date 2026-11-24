"use client";

import { Badge } from "@/components/ui/badge";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { useT } from "@/hooks/i18n/useT";

import { ondeNoAr } from "./onde-no-ar";

export function OndeNoAr({ agent }: { agent: AgentRow }) {
  const t = useT();
  const info = ondeNoAr(agent, t);

  return (
    <section
      className="min-w-0 rounded-md border bg-muted/30 p-3 text-xs"
      aria-label={t("Onde o agente está no ar")}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant={info.tom} className="max-w-full text-left whitespace-normal">
          {info.statusTexto}
        </Badge>
        {info.canalTexto && (
          <span className="min-w-0 font-medium break-words">{info.canalTexto}</span>
        )}
      </div>
      {info.versaoTexto && (
        <p className="mt-1 break-words text-muted-foreground">{info.versaoTexto}</p>
      )}
    </section>
  );
}
