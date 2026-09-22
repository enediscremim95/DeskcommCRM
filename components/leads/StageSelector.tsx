"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import type { Stage } from "@/lib/kanban/types";
import { Check, CaretDown } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface StageSelectorProps {
  stages: Stage[];
  stageId: string;
  canEdit: boolean;
  isPending?: boolean;
  onSelect: (stage: Stage) => void;
}

export function StageSelector({
  stages,
  stageId,
  canEdit,
  isPending = false,
  onSelect,
}: StageSelectorProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ordered = useMemo(() => [...stages].sort((a, b) => a.position - b.position), [stages]);
  const currentIndex = ordered.findIndex((stage) => stage.id === stageId);
  const current = ordered[currentIndex] ?? null;

  if (ordered.length === 0) return null;

  const choose = (stage: Stage) => {
    if (!canEdit || isPending || stage.id === stageId) return;
    setOpen(false);
    onSelect(stage);
  };

  return (
    <div className="mt-3" data-testid="lead-stage-selector">
      <ol
        className="hidden min-w-0 gap-1 md:grid md:grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]"
        aria-label={t("Etapas do funil")}
      >
        {ordered.map((stage, index) => {
          const active = stage.id === stageId;
          const completed = currentIndex >= 0 && index < currentIndex;
          return (
            <li key={stage.id} className="flex">
              <button
                type="button"
                onClick={() => choose(stage)}
                disabled={!canEdit || isPending || active}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex min-h-12 w-full items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-center text-xs leading-4 font-medium whitespace-normal break-words transition-colors",
                  active && "border-accent bg-accent-soft text-text",
                  completed && !active && "border-success/40 bg-success/10 text-text",
                  !active && !completed && "border-border bg-surface text-text-muted",
                  canEdit && !active && "cursor-pointer hover:border-accent/60 hover:text-text",
                  !canEdit && "cursor-default",
                )}
              >
                {completed ? <Check size={14} aria-hidden className="shrink-0 text-success" /> : null}
                <span>{stage.name}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="md:hidden">
        {canEdit ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full justify-between whitespace-normal text-left"
                disabled={isPending}
              >
                <span>{t("Etapa")}: {current?.name ?? t("Não informada")}</span>
                <CaretDown size={16} aria-hidden className="shrink-0" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl p-5">
              <DialogHeader>
                <DialogTitle>{t("Escolher etapa")}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-2">
                {ordered.map((stage) => {
                  const active = stage.id === stageId;
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => choose(stage)}
                      disabled={active || isPending}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm",
                        active
                          ? "border-accent bg-accent-soft font-semibold text-text"
                          : "border-border bg-surface text-text hover:border-accent/60",
                      )}
                    >
                      <span className="whitespace-normal break-words">{stage.name}</span>
                      {active ? <Check size={16} aria-hidden className="shrink-0 text-accent" /> : null}
                    </button>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <div className="flex min-h-11 w-full items-center rounded-md border border-border bg-surface px-3 text-sm text-text">
            {t("Etapa")}: {current?.name ?? t("Não informada")}
          </div>
        )}
      </div>
    </div>
  );
}
