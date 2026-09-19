"use client";

import { useEffect, useRef, useState } from "react";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { GripVertical, Pencil, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import {
  CAMPAIGN_METRIC_COLUMNS,
  type CampaignMetricColumn,
  type DashboardModel,
} from "@/lib/windsor/types";
import type { TrafficColumnPreset } from "@/lib/windsor/column-presets";

interface ColumnPresetMenuProps {
  organizationKey: string;
  viewerKey: string;
  model: DashboardModel;
  initialPresets: TrafficColumnPreset[];
  defaultPresetId: string | null;
  defaultColumns: CampaignMetricColumn[];
  canManage: boolean;
  columnLabel: (column: CampaignMetricColumn, idioma: string) => string;
  onColumnsChange: (columns: CampaignMetricColumn[]) => void;
}

interface PresetResponse {
  data?: { preset?: TrafficColumnPreset };
  error?: { message?: string };
}

export function reorderColumns(
  columns: CampaignMetricColumn[],
  from: number,
  to: number,
): CampaignMetricColumn[] {
  if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) {
    return columns;
  }
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  if (!moved) return columns;
  next.splice(to, 0, moved);
  return next;
}

export function ColumnPresetMenu({
  organizationKey,
  viewerKey,
  model,
  initialPresets,
  defaultPresetId,
  defaultColumns,
  canManage,
  columnLabel,
  onColumnsChange,
}: ColumnPresetMenuProps) {
  const t = useT();
  const idioma = useIdioma();
  const [presets, setPresets] = useState(initialPresets);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [columns, setColumns] = useState(defaultColumns);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const initializedFor = useRef<string | null>(null);
  const identity = `${organizationKey}:${viewerKey}:${model}`;
  const presetStorageKey = `traffic-campaign-preset:${identity}`;
  const columnsStorageKey = `traffic-campaign-columns:${identity}`;

  useEffect(() => {
    if (initializedFor.current === identity) return;
    initializedFor.current = identity;
    setPresets(initialPresets);
    const storedPresetId = localStorage.getItem(presetStorageKey);
    const selected =
      initialPresets.find((preset) => preset.id === storedPresetId) ??
      initialPresets.find((preset) => preset.id === defaultPresetId) ??
      initialPresets[0] ??
      null;
    let nextColumns = selected?.columns ?? defaultColumns;
    if (!selected) {
      try {
        const stored = JSON.parse(localStorage.getItem(columnsStorageKey) ?? "null") as unknown;
        if (Array.isArray(stored)) {
          const allowed = new Set<string>(CAMPAIGN_METRIC_COLUMNS);
          const valid = stored.filter(
            (column): column is CampaignMetricColumn =>
              typeof column === "string" && allowed.has(column),
          );
          if (valid.length > 0) nextColumns = valid;
        }
      } catch {
        // Preferência local inválida volta ao padrão da organização.
      }
    }
    setActivePresetId(selected?.id ?? null);
    setColumns(nextColumns);
    onColumnsChange(nextColumns);
  }, [
    columnsStorageKey,
    defaultColumns,
    defaultPresetId,
    identity,
    initialPresets,
    onColumnsChange,
    presetStorageKey,
  ]);

  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null;

  function chooseColumns(next: CampaignMetricColumn[]) {
    setColumns(next);
    onColumnsChange(next);
    localStorage.setItem(columnsStorageKey, JSON.stringify(next));
  }

  function choosePreset(id: string) {
    const selected = presets.find((preset) => preset.id === id);
    if (!selected) return;
    setActivePresetId(selected.id);
    chooseColumns(selected.columns);
    localStorage.setItem(presetStorageKey, selected.id);
    setMessage(null);
    setRenaming(false);
    setCreating(false);
  }

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return;
    chooseColumns(reorderColumns(columns, result.source.index, result.destination.index));
  }

  async function requestPreset(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json()) as PresetResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? t("Não foi possível salvar."));
    }
    return payload.data?.preset;
  }

  async function saveColumns() {
    if (!activePreset) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await requestPreset(
        `/api/v1/reports/traffic/column-presets/${activePreset.id}`,
        "PATCH",
        { columns },
      );
      if (updated) {
        setPresets((current) =>
          current.map((preset) =>
            preset.id === updated.id ? { ...updated, is_default: preset.is_default } : preset,
          ),
        );
      }
      setMessage(t("Predefinição salva."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createPreset() {
    const name = nameDraft.trim();
    if (!name) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await requestPreset("/api/v1/reports/traffic/column-presets", "POST", {
        name,
        columns,
      });
      if (created) {
        setPresets((current) => [...current, created]);
        setActivePresetId(created.id);
        localStorage.setItem(presetStorageKey, created.id);
      }
      setCreating(false);
      setNameDraft("");
      setMessage(t("Nova predefinição salva."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function renamePreset() {
    if (!activePreset || !nameDraft.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await requestPreset(
        `/api/v1/reports/traffic/column-presets/${activePreset.id}`,
        "PATCH",
        { name: nameDraft.trim() },
      );
      if (updated) {
        setPresets((current) =>
          current.map((preset) =>
            preset.id === updated.id ? { ...updated, is_default: preset.is_default } : preset,
          ),
        );
      }
      setRenaming(false);
      setNameDraft("");
      setMessage(t("Nome atualizado."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault() {
    if (!activePreset) return;
    setBusy(true);
    setMessage(null);
    try {
      await requestPreset(`/api/v1/reports/traffic/column-presets/${activePreset.id}`, "PATCH", {
        make_default: true,
      });
      setPresets((current) =>
        current.map((preset) => ({ ...preset, is_default: preset.id === activePreset.id })),
      );
      setMessage(t("Padrão salvo para esta organização."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deletePreset() {
    if (!activePreset) return;
    const confirmed = window.confirm(`${t("Excluir a predefinição")}: ${activePreset.name}?`);
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await requestPreset(`/api/v1/reports/traffic/column-presets/${activePreset.id}`, "DELETE");
      const remaining = presets.filter((preset) => preset.id !== activePreset.id);
      setPresets(remaining);
      const next = remaining.find((preset) => preset.is_default) ?? remaining[0] ?? null;
      setActivePresetId(next?.id ?? null);
      chooseColumns(next?.columns ?? defaultColumns);
      if (next) localStorage.setItem(presetStorageKey, next.id);
      else localStorage.removeItem(presetStorageKey);
      setMessage(t("Predefinição excluída."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="relative">
      <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm font-medium">
        {t("Colunas")} ({columns.length})
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(92vw,34rem)] rounded-xl border bg-card p-4 shadow-xl">
        <p className="text-sm font-semibold">
          {t("Personalizar colunas")}
        </p>
        {presets.length > 0 ? (
          <label className="mt-3 block text-xs font-medium text-muted-foreground">
            {t("Predefinição")}
            <select
              aria-label={t("Predefinição de colunas")}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground"
              value={activePresetId ?? ""}
              onChange={(event) => choosePreset(event.target.value)}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                  {preset.is_default ? ` · ${t("padrão")}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Nenhuma predefinição foi liberada. O padrão anterior continua em uso.")}
          </p>
        )}

        {activePreset && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/45 px-3 py-2">
            {renaming ? (
              <>
                <Input
                  aria-label={t("Nome da predefinição")}
                  maxLength={80}
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                  disabled={busy || !nameDraft.trim()}
                  onClick={renamePreset}
                >
                  {t("Salvar nome")}
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {activePreset.name}
                </span>
                {canManage && (
                  <button
                    type="button"
                    aria-label={t("Renomear predefinição")}
                    className="rounded-md p-1.5 hover:bg-muted"
                    onClick={() => {
                      setNameDraft(activePreset.name);
                      setRenaming(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {canManage && (
          <>
            <p className="mt-4 text-xs font-medium text-muted-foreground">
              {t("Colunas selecionadas")}
            </p>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="traffic-column-preset">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="mt-2 space-y-2"
                  >
                    {columns.map((column, index) => (
                      <Draggable key={column} draggableId={column} index={index}>
                        {(dragProvided) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className="flex items-center gap-2 rounded-lg border bg-background px-2 py-2 text-sm"
                          >
                            <button
                              type="button"
                              aria-label={`${t("Arrastar")}: ${columnLabel(column, idioma)}`}
                              className="cursor-grab rounded-md p-1 text-muted-foreground active:cursor-grabbing"
                              {...dragProvided.dragHandleProps}
                            >
                              <GripVertical className="size-4" />
                            </button>
                            <span className="flex-1">{columnLabel(column, idioma)}</span>
                            <button
                              type="button"
                              aria-label={`${t("Remover")}: ${columnLabel(column, idioma)}`}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                              disabled={columns.length === 1}
                              onClick={() =>
                                chooseColumns(columns.filter((item) => item !== column))
                              }
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

            <p className="mt-4 text-xs font-medium text-muted-foreground">
              {t("Adicionar métrica")}
            </p>
            <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
              {CAMPAIGN_METRIC_COLUMNS.filter((column) => !columns.includes(column)).map(
                (column) => (
                  <button
                    key={column}
                    type="button"
                    className="rounded-full border px-2.5 py-1 text-xs hover:border-primary/50 hover:bg-primary/10"
                    onClick={() => chooseColumns([...columns, column])}
                  >
                    + {columnLabel(column, idioma)}
                  </button>
                ),
              )}
            </div>

            {creating && (
              <div className="mt-4 flex gap-2">
                <Input
                  autoFocus
                  aria-label={t("Nome da nova predefinição")}
                  maxLength={80}
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder={t("Ex.: Captação de leads")}
                />
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
                  disabled={busy || !nameDraft.trim()}
                  onClick={createPreset}
                >
                  {t("Salvar nova")}
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={busy || !activePreset}
                onClick={saveColumns}
              >
                {busy
                  ? t("Salvando…")
                  : t("Salvar")}
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm font-medium"
                disabled={busy}
                onClick={() => {
                  setNameDraft("");
                  setCreating(true);
                  setRenaming(false);
                }}
              >
                {t("Salvar como nova")}
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                disabled={busy || !activePreset || activePreset.is_default}
                onClick={makeDefault}
              >
                {activePreset?.is_default
                  ? t("Padrão")
                  : t("Marcar como padrão")}
              </button>
              <button
                type="button"
                className="rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50"
                disabled={busy || !activePreset}
                onClick={deletePreset}
              >
                {t("Excluir")}
              </button>
            </div>
          </>
        )}
        {!canManage && presets.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("Escolha uma predefinição liberada para esta organização.")}
          </p>
        )}
        {message && <p className="mt-3 text-xs text-muted-foreground">{message}</p>}
      </div>
    </details>
  );
}
