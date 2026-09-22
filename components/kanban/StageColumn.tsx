"use client";
import { Droppable } from "@hello-pangea/dnd";
import { useRef, type CSSProperties } from "react";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";
import { buildCardInput } from "@/lib/kanban/card-state";
import { intervaloDaColuna } from "@/lib/kanban/selecao";
import { KanbanCard, type GestoDeSelecao } from "./KanbanCard";

interface StageColumnProps {
  stage: Stage;
  leads: Lead[];
  pipelineId: string;
  /** owner_user_id → nome, resolvido no board. O dono agente vem no lead. */
  ownerNames?: Map<string, string | null>;
  /** ids que o radar classificou como esfriando (fonte única, não recalculada). */
  coolingIds?: Set<string>;
  /** Propostas de retomada vivas, por lead. */
  reactivations?: Map<string, { proposalId: string; expiresAt: string }>;
  /** `settings.canonical_tags` do pipeline — a única tag que fica no card. */
  canonicalTags?: string[];
  canMove?: boolean;
  selectedLeadIds?: Set<string>;
  /** leadId → quantos eventos remotos já chegaram (muda = pulsa de novo). */
  pulses?: Map<string, number>;
  /**
   * Marca/desmarca um conjunto de uma vez — a etapa inteira, ou o intervalo do
   * shift+clique. Existe separado de `onSelect` porque a coluna é a única que
   * sabe a ordem VISÍVEL dos cards (é ela que recebe a lista já filtrada), e
   * resolver o intervalo no board significaria reconstruir essa ordem lá.
   */
  onSelectMany?: (leadIds: string[], marcar: boolean) => void;
  /** Abrir o dossiê — atravessa o board até o card, como `pulses`. */
  onOpen?: (leadId: string) => void;
  onSummary?: (leadId: string) => void;
}

function formatBRL(cents: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

/**
 * A coluna do quadro, com o cabeçalho no formato do Kommo: o nome da etapa em
 * caixa alta, "7 leads: R$ 19.700" logo abaixo e uma linha na cor da etapa
 * fechando o cabeçalho. A soma dos valores sai da própria lista que a coluna
 * recebe — nenhuma consulta nova.
 */
export function StageColumn({
  stage,
  leads,
  pipelineId,
  ownerNames,
  coolingIds,
  reactivations,
  canonicalTags,
  canMove = false,
  selectedLeadIds,
  pulses,
  onSelectMany,
  onOpen,
  onSummary,
}: StageColumnProps) {
  const t = useT();
  const totalCents = leads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);

  const idsVisiveis = leads.map((l) => l.id);
  const selecionadosAqui = idsVisiveis.filter((id) => selectedLeadIds?.has(id)).length;
  const todosSelecionados = idsVisiveis.length > 0 && selecionadosAqui === idsVisiveis.length;

  // A âncora do shift+clique. `useRef` e não `useState` de propósito: mudar a
  // âncora não muda nada na tela, e um `setState` aqui remontaria a coluna
  // inteira — inclusive o `Droppable` — a cada card marcado.
  const ancora = useRef<string | null>(null);

  const aoSelecionar = (leadId: string, gesto: GestoDeSelecao) => {
    if (gesto === "intervalo") {
      const faixa = intervaloDaColuna(idsVisiveis, ancora.current, leadId);
      ancora.current = leadId;
      onSelectMany?.(faixa, true);
      return;
    }
    ancora.current = leadId;
    onSelectMany?.([leadId], !selectedLeadIds?.has(leadId));
  };

  const alternarEtapa = () => {
    ancora.current = null;
    onSelectMany?.(idsVisiveis, !todosSelecionados);
  };
  // Sem cor configurada a linha fica neutra — nunca some, porque é ela que
  // separa o cabeçalho dos cards.
  const linhaDaEtapa: CSSProperties = {
    backgroundColor: stage.color ?? "var(--color-border-strong)",
  };

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-surface-elevated/70">
      <div className="group/etapa px-2.5 pt-2.5 pb-2">
        <div className="flex items-center gap-1.5">
          {/* "Selecionar a etapa inteira" é o gesto que faz a ação em lote valer a
              pena: sem ele, mover trinta cards deixa de ser trinta arrastes e vira
              trinta cliques com modificador. Fica no cabeçalho porque é ali que a
              etapa é um objeto — o mesmo lugar onde já se lê a contagem dela.
              Indeterminado quando a seleção é parcial: "alguns" e "nenhum" não
              podem ter a mesma aparência num controle que o próximo clique
              inverte. */}
          <input
            type="checkbox"
            checked={todosSelecionados}
            ref={(el) => {
              if (el) el.indeterminate = selecionadosAqui > 0 && !todosSelecionados;
            }}
            disabled={idsVisiveis.length === 0}
            onChange={alternarEtapa}
            aria-label={
              todosSelecionados
                ? `${t("Desmarcar todos em")} ${stage.name}`
                : `${t("Selecionar todos em")} ${stage.name}`
            }
            className={cn(
              "h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent transition-opacity",
              "focus:opacity-100 disabled:cursor-default",
              selecionadosAqui > 0 ? "opacity-100" : "opacity-0 group-hover/etapa:opacity-100",
            )}
          />
          <h2
            className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.08em] text-text uppercase"
            title={stage.name}
          >
            {stage.name}
          </h2>
          {selecionadosAqui > 0 && (
            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold leading-4 text-accent tabular-nums">
              {selecionadosAqui}/{leads.length}
            </span>
          )}
        </div>
        {/* "7 leads: R$ 19.700" — a contagem e a soma, uma linha, como no Kommo.
            Sem valor nenhum na coluna fica só a contagem: um "R$ 0" seria
            informação falsa com cara de número. */}
        <p className="mt-0.5 truncate pl-5 text-[11px] leading-4 text-text-muted tabular-nums">
          {leads.length} {leads.length === 1 ? t("lead") : t("leads")}
          {totalCents > 0 && (
            <>
              : <span className="font-medium text-text">{formatBRL(totalCents)}</span>
            </>
          )}
        </p>
        <div aria-hidden className="mt-2 h-[3px] rounded-full" style={linhaDaEtapa} />
      </div>

      <Droppable droppableId={stage.id} type="LEAD">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "flex flex-1 flex-col gap-1.5 px-1.5 pb-1.5 transition-colors",
              snapshot.isDraggingOver && "bg-accent/5",
            )}
          >
            {leads.map((lead, idx) => (
              <KanbanCard
                key={lead.id}
                card={buildCardInput(lead, {
                  stageName: stage.name,
                  ownerNames,
                  coolingIds,
                  reactivations,
                  canonicalTags,
                })}
                lead={lead}
                index={idx}
                pipelineId={pipelineId}
                canMove={canMove}
                isSelected={selectedLeadIds?.has(lead.id)}
                isSelecting={(selectedLeadIds?.size ?? 0) > 0}
                pulseCount={pulses?.get(lead.id) ?? 0}
                onSelect={aoSelecionar}
                onOpen={onOpen}
                onSummary={onSummary}
              />
            ))}
            {provided.placeholder}
            {leads.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-text-subtle">
                {t("vazio")}
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
