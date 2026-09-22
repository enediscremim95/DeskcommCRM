"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

export type AdPlatform = "meta_ads" | "google_ads";

export interface CostThreshold {
  platform: AdPlatform;
  good_until: number;
  acceptable_until: number;
}

export function costTone(
  value: number | null,
  threshold: CostThreshold | null | undefined,
): "none" | "good" | "warning" | "high" {
  if (value == null || !threshold) return "none";
  if (value <= threshold.good_until) return "good";
  if (value <= threshold.acceptable_until) return "warning";
  return "high";
}

export function CostSignal({
  value,
  threshold,
  children,
}: {
  value: number | null;
  threshold?: CostThreshold | null;
  children: ReactNode;
}) {
  const tone = costTone(value, threshold);
  const classes = {
    none: "",
    good: "rounded-md bg-success/15 px-1.5 py-0.5 font-semibold text-success-fg",
    warning: "rounded-md bg-warning/15 px-1.5 py-0.5 font-semibold text-warning-fg",
    high: "rounded-md bg-destructive/15 px-1.5 py-0.5 font-semibold text-destructive",
  };
  return <span className={classes[tone]}>{children}</span>;
}

export function CostThresholdControl({
  initial,
  canManage,
  onSaved,
}: {
  initial: CostThreshold[];
  canManage: boolean;
  onSaved: (rows: CostThreshold[]) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canManage) return null;

  const value = (platform: AdPlatform, key: "good_until" | "acceptable_until") =>
    rows.find((row) => row.platform === platform)?.[key] ?? "";
  const change = (platform: AdPlatform, key: "good_until" | "acceptable_until", raw: string) => {
    const current = rows.find((row) => row.platform === platform);
    const parsed = raw === "" ? null : Number(raw);
    setRows((previous) => {
      const without = previous.filter((row) => row.platform !== platform);
      if (parsed == null && !current) return without;
      const next: CostThreshold = {
        platform,
        good_until: key === "good_until" ? (parsed ?? 0) : (current?.good_until ?? 0),
        acceptable_until:
          key === "acceptable_until" ? (parsed ?? 0) : (current?.acceptable_until ?? 0),
      };
      return [...without, next];
    });
  };

  async function save() {
    if (rows.some((row) => row.acceptable_until < row.good_until)) {
      setError(t("O limite aceitável deve ser maior ou igual ao limite bom."));
      return;
    }
    const complete = rows;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/reports/traffic", {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ cost_thresholds: complete }),
      });
      const body = (await response.json()) as {
        data?: { cost_thresholds?: CostThreshold[] };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? t("Não foi possível salvar."));
      const saved = body.data?.cost_thresholds ?? complete;
      setRows(saved);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Não foi possível salvar."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="rounded-xl border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{t("Limites de custo")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(["meta_ads", "google_ads"] as const).map((platform) => (
          <fieldset key={platform} className="grid grid-cols-2 gap-2 rounded-lg border p-3">
            <legend className="px-1 font-medium">
              {platform === "meta_ads" ? "Meta Ads" : "Google Ads"}
            </legend>
            <Label>
              {t("Bom até")}
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="0.01"
                value={value(platform, "good_until")}
                onChange={(event) => change(platform, "good_until", event.target.value)}
              />
            </Label>
            <Label>
              {t("Aceitável até")}
              <Input
                className="mt-1"
                type="number"
                min="0"
                step="0.01"
                value={value(platform, "acceptable_until")}
                onChange={(event) => change(platform, "acceptable_until", event.target.value)}
              />
            </Label>
            <Button
              className="col-span-2 justify-self-start"
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setRows((current) => current.filter((row) => row.platform !== platform))
              }
            >
              {t("Remover limites")}
            </Button>
          </fieldset>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? t("Salvando…") : t("Salvar limites")}
        </Button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </details>
  );
}
