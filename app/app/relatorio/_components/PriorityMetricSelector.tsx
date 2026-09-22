"use client";

import { useState } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { GripVertical, Settings2, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import {
  PRIORITY_METRIC_COLUMNS,
  PRIORITY_METRIC_META,
  defaultPriorityMetrics,
  type PriorityMetricColumn,
} from "@/lib/windsor/priority-metrics";
import type { DashboardModel } from "@/lib/windsor/types";

interface PriorityMetricSelectorProps {
  model: DashboardModel;
  initial: PriorityMetricColumn[];
  canManage: boolean;
  onSaved: (metrics: PriorityMetricColumn[]) => void;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function reorderPriorityMetrics(
  metrics: PriorityMetricColumn[],
  from: number,
  to: number,
): PriorityMetricColumn[] {
  if (from === to || from < 0 || to < 0 || from >= metrics.length || to >= metrics.length) {
    return metrics;
  }
  const next = [...metrics];
  const [moved] = next.splice(from, 1);
  if (!moved) return metrics;
  next.splice(to, 0, moved);
  return next;
}

export function PriorityMetricSelector({
  model,
  initial,
  canManage,
  onSaved,
}: PriorityMetricSelectorProps) {
  const t = useT();
  const idioma = useIdioma();
  const [metrics, setMetrics] = useState(initial);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const label = (metric: PriorityMetricColumn) => {
    const meta = PRIORITY_METRIC_META[metric];
    return idioma === "es" ? meta.labelEs : meta.label;
  };

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    setMetrics((current) =>
      reorderPriorityMetrics(current, result.source.index, result.destination!.index),
    );
  }

  async function persist(priorityMetrics: PriorityMetricColumn[] | null) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/reports/traffic", {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ priority_metrics: priorityMetrics }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t("Não foi possível salvar."));
      }
      const saved = priorityMetrics ?? defaultPriorityMetrics(model);
      setMetrics(saved);
      onSaved(saved);
      setMessage(
        priorityMetrics == null
          ? t("Padrão restaurado para esta organização.")
          : t("Métricas prioritárias salvas."),
      );
      setOpen(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const available = PRIORITY_METRIC_COLUMNS.filter(
    (metric) =>
      !metrics.includes(metric) &&
      normalized(label(metric)).includes(normalized(search.trim())),
  );

  if (!canManage) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium"
        >
          <Settings2 className="size-3.5" aria-hidden="true" />
          {t("Escolher métricas")}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl p-5">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("Métricas prioritárias")}</DialogTitle>
        </DialogHeader>
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="priority-metrics">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="mt-3 space-y-2">
                {metrics.map((metric, index) => (
                  <Draggable key={metric} draggableId={metric} index={index}>
                    {(dragProvided) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className="flex items-center gap-2 rounded-lg border bg-background px-2 py-2 text-sm"
                      >
                        <button
                          type="button"
                          aria-label={`${t("Arrastar")}: ${label(metric)}`}
                          className="cursor-grab rounded-md p-1 text-muted-foreground active:cursor-grabbing"
                          {...dragProvided.dragHandleProps}
                        >
                          <GripVertical className="size-4" />
                        </button>
                        <span className="flex-1">{label(metric)}</span>
                        <button
                          type="button"
                          aria-label={`${t("Remover")}: ${label(metric)}`}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                          disabled={metrics.length === 1}
                          onClick={() => setMetrics(metrics.filter((item) => item !== metric))}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        <Input
          className="mt-4 h-8 text-xs"
          aria-label={t("Buscar métrica prioritária")}
          placeholder={t("Buscar métrica prioritária")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
          {available.map((metric) => (
            <button
              key={metric}
              type="button"
              aria-label={`${t("Adicionar métrica prioritária")}: ${label(metric)}`}
              className="rounded-full border px-2.5 py-1 text-xs hover:border-primary/50 hover:bg-primary/10 disabled:opacity-40"
              disabled={metrics.length >= 6}
              onClick={() => setMetrics([...metrics, metric])}
            >
              + {label(metric)}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            aria-label={t("Salvar métricas prioritárias")}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={busy || metrics.length < 1 || metrics.length > 6}
            onClick={() => persist(metrics)}
          >
            {busy ? t("Salvando…") : t("Salvar")}
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => persist(null)}
          >
            {t("Restaurar padrão")}
          </button>
        </div>
        {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
