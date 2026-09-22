"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { Lead } from "@/lib/types/leads";
import { cn } from "@/lib/utils";

interface Props {
  lead: Lead;
  canEdit: boolean;
  compact?: boolean;
  onUpdated?: (lead: Lead) => void;
}

export function LeadQualification({ lead, canEdit, compact = false, onUpdated }: Props) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState<number | null>(lead.qualification);
  const [saving, setSaving] = useState(false);

  async function update(next: number) {
    if (!canEdit || saving || next === value) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      const response = await apiClient.patch<{ data: Lead }>(`/api/v1/leads/${lead.id}`, {
        qualification: next,
      });
      setValue(response.data.qualification);
      onUpdated?.(response.data);
      await queryClient.invalidateQueries({ queryKey: ["board", lead.pipeline_id] });
      await queryClient.invalidateQueries({ queryKey: ["contact-leads"] });
    } catch (error) {
      setValue(previous);
      showApiError(error);
    } finally {
      setSaving(false);
    }
  }

  const label = `★ ${value ?? "–"}`;
  if (!canEdit) {
    return (
      <span
        className="inline-flex min-h-6 items-center rounded-md border border-border px-2 text-xs text-text-muted"
        aria-label={`${t("Qualificação")}: ${value ?? t("Não informado")}`}
      >
        {label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex items-center justify-center rounded-md border border-border bg-surface px-2 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text",
            compact ? "min-h-11 sm:min-h-6" : "min-h-11",
          )}
          aria-label={`${t("Qualificação")}: ${value ?? t("Não informado")}`}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(event) => event.stopPropagation()}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <DropdownMenuItem key={rating} onSelect={() => void update(rating)}>
            {"★".repeat(rating)} <span className="ml-2">{rating}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
