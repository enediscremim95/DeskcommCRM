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

function currencySymbol(currency: string | undefined) {
  if (!currency) return "";
  try {
    return (
      new Intl.NumberFormat("pt-BR", { style: "currency", currency })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block size-2.5 shrink-0 rounded-full ${className}`} />;
}

export function CostThresholdControl({
  initial,
  canManage,
  onSaved,
  model,
  currency,
}: {
  initial: CostThreshold[];
  canManage: boolean;
  onSaved: (rows: CostThreshold[]) => void;
  model?: string;
  currency?: string;
}) {
  const t = useT();
  const perResult = model === "ecommerce" ? t("Custo por venda") : t("Custo por lead");
  const symbol = currencySymbol(currency);
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

  const invalid = rows.some((row) => row.acceptable_until < row.good_until);
  const money = (amount: number) =>
    `${symbol} ${amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

  return (
    <details className="rounded-xl border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">
        {t("Cores do custo na tabela")}
        <span className="ml-2 inline-flex items-center gap-1 align-middle">
          <Dot className="bg-success" />
          <Dot className="bg-warning" />
          <Dot className="bg-destructive" />
        </span>
      </summary>
      <p className="mt-2 text-muted-foreground">
        {t("Defina até quanto o custo é bom e até quanto ainda é aceitável. A coluna")}{" "}
        <strong className="text-foreground">{perResult}</strong>{" "}
        {t("da tabela fica verde, amarela ou vermelha.")}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(["meta_ads", "google_ads"] as const).map((platform) => {
          const row = rows.find((item) => item.platform === platform);
          const rowInvalid = row != null && row.acceptable_until < row.good_until;
          return (
            <fieldset key={platform} className="grid grid-cols-2 gap-2 rounded-lg border p-3">
              <legend className="px-1 font-medium">
                {platform === "meta_ads" ? "Meta Ads" : "Google Ads"}
              </legend>
              <Label className="flex-col items-start gap-1">
                <span className="flex items-center gap-1.5">
                  <Dot className="bg-success" />
                  {t("Verde até")}
                </span>
                <div className="relative w-full">
                  {symbol && (
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                      {symbol}
                    </span>
                  )}
                  <Input
                    className={symbol ? "pl-10" : undefined}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("ex.: 30")}
                    value={value(platform, "good_until")}
                    onChange={(event) => change(platform, "good_until", event.target.value)}
                  />
                </div>
              </Label>
              <Label className="flex-col items-start gap-1">
                <span className="flex items-center gap-1.5">
                  <Dot className="bg-warning" />
                  {t("Amarelo até")}
                </span>
                <div className="relative w-full">
                  {symbol && (
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                      {symbol}
                    </span>
                  )}
                  <Input
                    className={symbol ? "pl-10" : undefined}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("ex.: 50")}
                    aria-invalid={rowInvalid || undefined}
                    value={value(platform, "acceptable_until")}
                    onChange={(event) => change(platform, "acceptable_until", event.target.value)}
                  />
                </div>
              </Label>
              <p className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
                <Dot className="bg-destructive" />
                {row && !rowInvalid
                  ? `${t("Vermelho acima de")} ${money(row.acceptable_until)}`
                  : t("Vermelho acima do valor amarelo")}
              </p>
              {rowInvalid && (
                <p className="col-span-2 text-destructive">
                  {t("O valor do amarelo precisa ser maior que o do verde.")}
                </p>
              )}
              {!row && (
                <p className="col-span-2 text-muted-foreground">
                  {t("Sem valores, essa coluna fica sem cor.")}
                </p>
              )}
              {row && (
                <Button
                  className="col-span-2 justify-self-start"
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setRows((current) => current.filter((item) => item.platform !== platform))
                  }
                >
                  {t("Tirar as cores")}
                </Button>
              )}
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={saving || invalid}>
          {saving ? t("Salvando…") : t("Salvar cores")}
        </Button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </details>
  );
}
