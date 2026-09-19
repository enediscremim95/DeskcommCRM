"use client";
import { useT } from "@/hooks/i18n/useT";
import { Badge } from "@/components/ui/badge";
import type { OwnerKind } from "@/lib/types/leads";

/** Iniciais a partir do nome (primeira + última palavra). */
export function ownerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Exibe o responsável (owner) de um lead — humano ou agente de IA (0070).
 * Presentacional e sem dnd, testável em isolamento.
 *
 * O agente é PAR do humano, não um enfeite: mesmo diâmetro, mesmo peso, mesma
 * posição. A única diferença é a forma — humano = disco preenchido; agente =
 * círculo vazado com anel e inicial em mono. Nada de emoji, badge "AI"
 * colorido ou gradiente: a distinção é geométrica, não decorativa, e por isso
 * sobrevive ao daltonismo e ao teste do metro.
 */
export function OwnerBadge({
  ownerKind,
  ownerName,
  agentVersion,
  compacto = false,
  noCard = false,
}: {
  ownerKind: OwnerKind;
  ownerName: string | null;
  /** Versão publicada do agente no momento da exibição (nunca congelada no lead). */
  agentVersion?: number | null;
  /**
   * Variante de 16px, para a linha do inbox — onde os selos vizinhos têm 16px e
   * um disco de 24px empurraria a altura da linha inteira.
   *
   * É uma PROP e não um componente novo de propósito: a geometria (disco cheio =
   * pessoa, anel vazado = automático) é a mesma afirmação, e duplicá-la num
   * segundo arquivo é como duas telas passam a dizer a mesma coisa de dois jeitos.
   */
  compacto?: boolean;
  /**
   * A linha de cima do card do quadro (formato Kommo): disco de 16px e nome
   * discreto. Sem dono, fica SÓ o disco tracejado com o rótulo acessível: a
   * frase "Sem responsável" escrita em todo card era o espaço morto que o
   * dono do produto apontou, e a coluna inteira repetindo-a não informa nada.
   */
  noCard?: boolean;
}) {
  const t = useT();
  const pequeno = compacto || noCard;
  if (!ownerKind) {
    // Mesma geometria dos outros dois estados (disco + rótulo), para a linha
    // não mudar de altura conforme o lead tem dono ou não.
    return (
      <div
        className="flex min-w-0 items-center gap-1.5"
        aria-label={t("Sem responsável")}
        title={noCard ? t("Sem responsável") : undefined}
      >
        <span
          className={`${pequeno ? "h-4 w-4" : "h-6 w-6"} shrink-0 rounded-full border border-dashed border-border-strong`}
          aria-hidden
        />
        {!noCard && (
          <span className={`truncate text-text-muted ${compacto ? "text-[10px]" : "text-xs"}`}>
            {t("Sem responsável")}
          </span>
        )}
      </div>
    );
  }

  const isAgent = ownerKind === "ai";
  const label = ownerName ?? t(isAgent ? "Agente" : "Responsável");
  const versionSuffix = isAgent && agentVersion != null ? ` · v${agentVersion}` : "";
  const fullLabel = `${label}${versionSuffix}`;
  const disco = pequeno ? "h-4 w-4 text-[8px]" : "h-6 w-6 text-[10px]";

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      aria-label={`${t("Responsável")}: ${fullLabel}`}
      title={fullLabel}
    >
      <span
        className={
          isAgent
            ? // Vazado com anel: o fundo do card atravessa o disco.
              `flex ${disco} shrink-0 items-center justify-center rounded-full border border-accent bg-surface font-mono font-semibold text-accent ring-1 ring-inset ring-accent/40`
            : // Preenchido SÓLIDO: a um metro, o humano é uma mancha escura e o
              // agente é um anel claro. Contraste que não depende da borda —
              // fundo suave fazia os dois lerem como "círculo claro".
              `flex ${disco} shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground`
        }
        aria-hidden
      >
        {ownerName ? ownerInitials(ownerName) : "?"}
      </span>
      <span
        className={`truncate text-text-muted ${
          noCard
            ? "text-[11px] leading-4"
            : compacto
              ? "max-w-[7rem] text-[10px]"
              : "max-w-[9rem] text-xs"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
