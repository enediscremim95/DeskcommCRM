"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/followup/graph-schema";
import type { ComponentType } from "react";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUAL_LIST } from "./nodes/nodeVisuals";

interface CustomPaletteItem {
  type: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  chipClassName: string;
}

interface Props {
  onAdd: (type: NodeType) => void;
  /** "mobile" = mesmo conteúdo dentro do Sheet que `FlowCanvas` abre abaixo de
   * `lg` — a barra fixa de 224px não cabia perto do canvas num celular. */
  variant?: "desktop" | "mobile";
  items?: CustomPaletteItem[];
  onSelect?: (type: string) => void;
  title?: string;
  draggable?: boolean;
}

/** Sidebar palette — click to add. Native HTML5 drag-and-drop wired in FlowCanvas (increment 3). */
export function NodePalette({ onAdd, variant = "desktop", items, onSelect, title = "Adicionar nó", draggable = true }: Props) {
  const t = useT();
  const isMobile = variant === "mobile";
  return (
    <aside
      className={cn(
        "flex flex-col gap-1.5 overflow-y-auto p-3",
        isMobile
          ? "h-full w-full"
          : "hidden w-56 shrink-0 border-r border-border bg-surface lg:flex",
      )}
      data-testid="node-palette"
    >
      <h2 className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
        {t(title)}
      </h2>
      {(items ?? NODE_VISUAL_LIST.map((visual) => ({
        type: visual.type,
        label: visual.paletteLabel,
        icon: visual.icon,
        chipClassName: visual.chipClassName,
      }))).map((visual) => {
        const Icon = visual.icon;
        return (
          <Button
            key={visual.type}
            type="button"
            variant="secondary"
            size="sm"
            className="justify-start gap-2"
            draggable={draggable}
            onDragStart={(e) => {
              if (!draggable) return;
              e.dataTransfer.setData("application/x-followup-node-type", visual.type);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onSelect ? onSelect(visual.type) : onAdd(visual.type as NodeType)}
            data-testid={`palette-add-${visual.type}`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${visual.chipClassName}`}
            >
              <Icon size={14} aria-hidden />
            </span>
            {t(visual.label)}
          </Button>
        );
      })}
    </aside>
  );
}
