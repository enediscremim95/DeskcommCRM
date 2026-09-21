"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import type { CampaignMetricColumn } from "@/lib/windsor/types";
import type { TrafficColumnPreset } from "@/lib/windsor/column-presets";
import { ColumnPresetMenu } from "./ColumnPresetMenu";
import { buildTrafficFunnelStages, ConversionFunnel, type FunnelStage } from "./ConversionFunnel";

interface Metrics {
  budget: number | null;
  budget_type: "daily" | "lifetime" | null;
  spend: number;
  conversions: number;
  leads: number;
  landing_page_views: number;
  cost_per_landing_page_view: number | null;
  add_to_cart: number;
  cost_per_add_to_cart: number | null;
  initiate_checkout: number;
  cost_per_initiate_checkout: number | null;
  purchases: number;
  cost_per_purchase: number | null;
  messaging_conversations: number;
  cost_per_messaging_conversation: number | null;
  revenue: number;
  impressions: number;
  reach: number | null;
  frequency: number | null;
  clicks: number;
  link_clicks: number;
  cost_per_conversion: number | null;
  cost_per_lead: number | null;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  conversion_rate: number | null;
  roas: number | null;
  average_order_value: number | null;
  video_views: number;
  video_p25: number;
  video_p50: number;
  video_p75: number;
  video_p95: number;
  landing_page_views_available: boolean;
  add_to_cart_available: boolean;
  initiate_checkout_available: boolean;
  purchases_available: boolean;
  messaging_conversations_available: boolean;
}
interface Campaign extends Metrics {
  name: string;
  platform: "meta_ads" | "google_ads";
  campaign_status: string | null;
  adsets: Array<
    Metrics & {
      name: string;
      ads: Array<
        Metrics & {
          name: string;
          thumbnail_url: string | null;
          story_id: string | null;
        }
      >;
    }
  >;
}
interface CurrencyGroup {
  currency: string;
  summary: Metrics;
  comparison: Metrics | null;
  daily: Array<{
    date: string;
    spend_meta: number;
    spend_google: number;
    conversions: number;
    revenue: number;
  }>;
  platforms: Array<Metrics & { platform: "meta_ads" | "google_ads" }>;
  campaigns: Campaign[];
}
interface ReportResponse {
  data: {
    model: "leads" | "messages" | "ecommerce";
    organization_key: string;
    viewer_key: string;
    default_columns: CampaignMetricColumn[];
    default_preset_id: string | null;
    column_presets: TrafficColumnPreset[];
    can_manage_defaults: boolean;
    sync: { status: string; last_succeeded_at: string | null; error: string | null };
    crm: {
      leads_entered: number;
      in_service: number;
      closed_won: number;
      previous?: { leads_entered: number; in_service: number; closed_won: number };
    };
    currencies: CurrencyGroup[];
  };
  error?: { message?: string };
}

// Data local (fuso do navegador), não UTC: `toISOString()` virava o dia seguinte
// depois das 21h no Brasil e o período pedido não batia com o mostrado.
function iso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function range(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}
function thisMonth(): { from: string; to: string } {
  const now = new Date();
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}
function money(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}
function number(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}
function percent(value: number | null): string {
  return value == null ? "—" : `${number(value)}%`;
}

export function metricDelta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function useAnimatedNumber(value: number): number {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      const timeout = window.setTimeout(() => setDisplay(value), 0);
      return () => window.clearTimeout(timeout);
    }
    const startedAt = performance.now();
    const duration = 650;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return display;
}

function Sparkline({
  values,
  active,
  label,
}: {
  values: number[];
  active: boolean;
  label: string;
}) {
  const maximum = Math.max(...values, 1);
  const points =
    values.length > 1
      ? values
          .map((value, index) => {
            const x = (index / (values.length - 1)) * 100;
            const y = 28 - (value / maximum) * 24;
            return `${x},${y}`;
          })
          .join(" ")
      : `0,24 100,24`;
  return (
    <svg viewBox="0 0 100 32" className="h-9 w-full" role="img" aria-label={label}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 3 : 2}
        vectorEffect="non-scaling-stroke"
        className="text-primary"
      />
    </svg>
  );
}

function HeroMetric({
  label,
  value,
  previous,
  sparkline,
  formatter,
  active,
  onSelect,
  comparisonLabel,
}: {
  label: string;
  value: number;
  previous?: number | null;
  sparkline: number[];
  formatter: (value: number) => string;
  active: boolean;
  onSelect: () => void;
  comparisonLabel: string;
}) {
  const animated = useAnimatedNumber(value);
  const delta = metricDelta(value, previous);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`group relative min-w-0 overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden motion-reduce:transition-none sm:p-5 ${
        active
          ? "border-primary/50 bg-primary/[0.09] shadow-[0_16px_48px_-28px_var(--primary)]"
          : "border-border/80 bg-card/90 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card"
      }`}
    >
      <span className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/70 to-transparent" />
      <span className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="mt-2 block truncate text-2xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">
        {formatter(animated)}
      </span>
      <span className="mt-2 flex min-h-5 items-center gap-1.5 text-xs">
        {delta == null ? (
          <span className="text-muted-foreground">{comparisonLabel}</span>
        ) : (
          <span
            className={
              delta >= 0
                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                : "font-semibold text-red-600 dark:text-red-400"
            }
          >
            {delta >= 0 ? "↑" : "↓"} {number(Math.abs(delta))}%
          </span>
        )}
        {delta != null && <span className="text-muted-foreground">{comparisonLabel}</span>}
      </span>
      <span className="mt-1 block opacity-75 transition-opacity group-hover:opacity-100">
        <Sparkline values={sparkline} active={active} label={`${label}: ${comparisonLabel}`} />
      </span>
    </button>
  );
}

const MONEY_COLUMNS = new Set<CampaignMetricColumn>([
  "spend",
  "cpm",
  "cpc",
  "cost_per_landing_page_view",
  "cost_per_lead",
  "cost_per_add_to_cart",
  "cost_per_initiate_checkout",
  "cost_per_purchase",
  "revenue",
  "cost_per_messaging_conversation",
]);
const META_ONLY_COLUMNS = new Set<CampaignMetricColumn>([
  "budget",
  "reach",
  "landing_page_views",
  "cost_per_landing_page_view",
  "add_to_cart",
  "cost_per_add_to_cart",
  "initiate_checkout",
  "cost_per_initiate_checkout",
  "purchases",
  "cost_per_purchase",
  "messaging_conversations",
  "cost_per_messaging_conversation",
]);

function localText(idioma: string, pt: string, es: string): string {
  return idioma === "es" ? es : pt;
}

function columnLabel(column: CampaignMetricColumn, idioma: string): string {
  const labels: Record<CampaignMetricColumn, [pt: string, es: string]> = {
    budget: ["Orçamento", "Presupuesto"],
    spend: ["Valor gasto", "Importe gastado"],
    reach: ["Alcance", "Alcance"],
    impressions: ["Impressões", "Impresiones"],
    cpm: ["CPM", "CPM"],
    ctr: ["CTR", "CTR"],
    link_clicks: ["Cliques no link", "Clics en el enlace"],
    cpc: ["CPC", "CPC"],
    landing_page_views: ["Visualizações da página", "Visitas a la página"],
    cost_per_landing_page_view: ["Custo por visualização", "Costo por visita"],
    leads: ["Leads", "Leads"],
    cost_per_lead: ["Custo por lead", "Costo por lead"],
    add_to_cart: ["Carrinhos", "Añadidos al carrito"],
    cost_per_add_to_cart: ["Custo por carrinho", "Costo por carrito"],
    initiate_checkout: ["Finalizações", "Inicios de pago"],
    cost_per_initiate_checkout: ["Custo por finalização", "Costo por inicio de pago"],
    purchases: ["Vendas", "Ventas"],
    cost_per_purchase: ["Custo por venda", "Costo por venta"],
    revenue: ["Valor de conversão", "Valor de conversión"],
    roas: ["ROAS", "ROAS"],
    messaging_conversations: ["Conversas iniciadas", "Conversaciones iniciadas"],
    cost_per_messaging_conversation: ["Custo por conversa", "Costo por conversación"],
  };
  return idioma === "es" ? labels[column][1] : labels[column][0];
}

function metricValue(
  metrics: Metrics,
  column: CampaignMetricColumn,
  currency: string,
  platform: "meta_ads" | "google_ads",
): string {
  if (platform === "google_ads" && META_ONLY_COLUMNS.has(column)) return "—";
  if (column === "budget") {
    if (metrics.budget == null) return "—";
    return `${money(metrics.budget, currency)}${metrics.budget_type === "daily" ? "/dia" : " total"}`;
  }
  const value = metrics[column];
  if (typeof value !== "number") return "—";
  if (MONEY_COLUMNS.has(column)) return money(value, currency);
  if (column === "ctr") return percent(value);
  if (column === "roas") return `${number(value)}x`;
  return number(value);
}

type CampaignStatusFilter = "all" | "active" | "paused";
type CampaignSortKey = "name" | CampaignMetricColumn;
type SortDirection = "ascending" | "descending";

const CAMPAIGN_STATUS: Record<
  string,
  {
    label: string;
    category: Exclude<CampaignStatusFilter, "all"> | "other";
    variant: "success" | "warning" | "error" | "info" | "neutral";
  }
> = {
  ACTIVE: { label: "Ativa", category: "active", variant: "success" },
  ENABLED: { label: "Ativa", category: "active", variant: "success" },
  PAUSED: { label: "Pausada", category: "paused", variant: "neutral" },
  CAMPAIGN_PAUSED: { label: "Pausada", category: "paused", variant: "neutral" },
  ADSET_PAUSED: { label: "Pausada", category: "paused", variant: "neutral" },
  DELETED: { label: "Encerrada", category: "other", variant: "neutral" },
  REMOVED: { label: "Encerrada", category: "other", variant: "neutral" },
  ARCHIVED: { label: "Encerrada", category: "other", variant: "neutral" },
  IN_PROCESS: { label: "Em processamento", category: "other", variant: "info" },
  PENDING_REVIEW: { label: "Em análise", category: "other", variant: "info" },
  IN_REVIEW: { label: "Em análise", category: "other", variant: "info" },
  PREAPPROVED: { label: "Pré-aprovada", category: "other", variant: "info" },
  PENDING_BILLING_INFO: {
    label: "Aguardando dados de cobrança",
    category: "other",
    variant: "warning",
  },
  WITH_ISSUES: { label: "Com problemas", category: "other", variant: "error" },
  DISAPPROVED: { label: "Reprovada", category: "other", variant: "error" },
};

function campaignStatus(status: string | null | undefined) {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) {
    return {
      label: "Não informada",
      category: "other" as const,
      variant: "neutral" as const,
      known: false,
    };
  }
  const found = CAMPAIGN_STATUS[normalized];
  if (found) return { ...found, known: true };
  return {
    label: "Outro estado",
    category: "other" as const,
    variant: "neutral" as const,
    known: true,
  };
}

function compareCampaigns(
  first: Campaign,
  second: Campaign,
  key: CampaignSortKey,
  direction: SortDirection,
  idioma: string,
): number {
  if (key === "name") {
    const result = first.name.localeCompare(second.name, idioma, { sensitivity: "base" });
    return direction === "ascending" ? result : -result;
  }
  const firstValue = first[key];
  const secondValue = second[key];
  const firstNumber = typeof firstValue === "number" ? firstValue : null;
  const secondNumber = typeof secondValue === "number" ? secondValue : null;
  if (firstNumber == null && secondNumber == null) return first.name.localeCompare(second.name);
  if (firstNumber == null) return 1;
  if (secondNumber == null) return -1;
  const result = firstNumber - secondNumber;
  if (result === 0) {
    return first.name.localeCompare(second.name, idioma, { sensitivity: "base" });
  }
  return direction === "ascending" ? result : -result;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PlatformMark({ platform }: { platform: "meta_ads" | "google_ads" }) {
  if (platform === "meta_ads") {
    return (
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-border"
      >
        <svg viewBox="0 0 48 32" className="h-5 w-8">
          <path
            fill="none"
            stroke="#0081FB"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 22c0-8 4-17 9-17 7 0 13 22 20 22 5 0 9-6 9-12S40 5 35 5c-6 0-13 22-21 22-6 0-9-2-9-5z"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-border"
    >
      <svg viewBox="0 0 48 48" className="size-6">
        <path
          fill="#EA4335"
          d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17z"
        />
        <path
          fill="#FBBC05"
          d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5 2.4-8.7 2.4-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"
        />
      </svg>
    </span>
  );
}

function CampaignTable({
  campaigns,
  currency,
  total,
  platform,
  labels,
  columns,
  idioma,
}: {
  campaigns: Campaign[];
  currency: string;
  total: Metrics;
  platform: "meta_ads" | "google_ads";
  columns: CampaignMetricColumn[];
  idioma: string;
  labels: {
    campaign: string;
    total: string;
    openMedia: string;
    conversions: string;
  };
}) {
  const t = useT();
  const isMeta = platform === "meta_ads";
  const storageKey = `traffic-campaign-status-filter:${platform}`;
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>("all");
  const [sortKey, setSortKey] = useState<CampaignSortKey>("spend");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Antes da primeira sincronização que traz o status, nenhuma campanha o conhece.
  // Nesse caso a coluna e o filtro somem em vez de mostrar "Não informada" em tudo.
  const showStatus = campaigns.some((campaign) => campaignStatus(campaign.campaign_status).known);
  const activeFilter = showStatus ? statusFilter : "all";
  const columnCount = columns.length + (showStatus ? 2 : 1);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "all" || stored === "active" || stored === "paused") {
      const timeout = window.setTimeout(() => setStatusFilter(stored), 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [storageKey]);

  const visibleCampaigns = useMemo(
    () =>
      campaigns
        .filter(
          (campaign) =>
            activeFilter === "all" ||
            campaignStatus(campaign.campaign_status).category === activeFilter,
        )
        .sort((first, second) =>
          compareCampaigns(first, second, sortKey, sortDirection, idioma),
        ),
    [activeFilter, campaigns, idioma, sortDirection, sortKey],
  );

  const changeSort = (key: CampaignSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) =>
        current === "descending" ? "ascending" : "descending",
      );
      return;
    }
    setSortKey(key);
    setSortDirection("descending");
  };

  const changeStatusFilter = (filter: CampaignStatusFilter) => {
    setStatusFilter(filter);
    window.localStorage.setItem(storageKey, filter);
  };

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Um único estilo para todo cabeçalho. O <button> de ordenar repete as classes
  // de texto para não depender do que o navegador reseta em botões.
  const headerText = "text-xs font-semibold tracking-[0.08em] uppercase";
  const headerCell = `${headerText} px-4 py-3 whitespace-nowrap`;

  const sortableHeader = (key: CampaignSortKey, label: string, align: "left" | "right") => {
    const active = sortKey === key;
    // A seta ocupa o mesmo espaço sempre (invisível quando inativa) e fica do lado
    // de dentro da coluna: à direita do nome e à esquerda dos números, para o
    // texto não sair do alinhamento quando a ordenação troca de coluna.
    const arrow = (
      <span
        aria-hidden="true"
        className={`w-3 shrink-0 text-center text-[9px] ${active ? "" : "opacity-0"}`}
      >
        {sortDirection === "descending" ? "▼" : "▲"}
      </span>
    );
    return (
      <th
        key={key}
        scope="col"
        className={`${headerCell} ${align === "right" ? "text-right" : "text-left"} ${active ? "text-foreground" : "text-muted-foreground"}`}
        aria-sort={active ? sortDirection : "none"}
      >
        <button
          type="button"
          className={`${headerText} inline-flex w-full items-center gap-1 rounded-sm text-inherit hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden ${align === "right" ? "justify-end" : "justify-start"}`}
          onClick={() => changeSort(key)}
          aria-label={`${t("Ordenar por")} ${label}`}
        >
          {align === "right" && arrow}
          <span>{label}</span>
          {align === "left" && arrow}
        </button>
      </th>
    );
  };

  const metricCell = (metrics: Metrics, column: CampaignMetricColumn, className = "") => (
    <td
      key={column}
      className={`px-4 py-3 text-right whitespace-nowrap tabular-nums ${className}`}
    >
      {metricValue(metrics, column, currency, platform)}
    </td>
  );

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {showStatus && (
        <div
          role="group"
          aria-label={t("Filtrar campanhas por status")}
          className="flex flex-wrap items-center gap-1 border-b px-3 py-2"
        >
          <span className="mr-1 text-xs font-medium text-muted-foreground">{t("Status")}</span>
          {([
            ["all", t("Todas")],
            ["active", t("Ativas")],
            ["paused", t("Pausadas")],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={statusFilter === value ? "secondary" : "ghost"}
              aria-pressed={statusFilter === value}
              onClick={() => changeStatusFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="border-b bg-muted/35">
            <tr>
              {sortableHeader("name", labels.campaign, "left")}
              {showStatus && (
                <th scope="col" className={`${headerCell} text-left text-muted-foreground`}>
                  {t("Status")}
                </th>
              )}
              {columns.map((column) =>
                sortableHeader(column, columnLabel(column, idioma), "right"),
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibleCampaigns.map((campaign) => {
              const key = `${campaign.platform}:${campaign.name}`;
              const status = campaignStatus(campaign.campaign_status);
              const isOpen = isMeta && expanded.has(key);
              return (
                <Fragment key={key}>
                  <tr className="hover:bg-muted/35">
                    <td className="max-w-md px-4 py-3 font-medium">
                      {isMeta ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => toggleExpanded(key)}
                          className={`inline-flex max-w-full items-center gap-2 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden ${isOpen ? "text-[#1877F2]" : ""}`}
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                          >
                            <path
                              d="M6 3.5 10.5 8 6 12.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span className="truncate">{campaign.name}</span>
                        </button>
                      ) : (
                        <span className="block truncate">{campaign.name}</span>
                      )}
                    </td>
                    {showStatus && (
                      <td className="px-4 py-3">
                        <Badge
                          variant={status.variant}
                          className="px-2 py-0 text-[11px] leading-5 whitespace-nowrap"
                        >
                          {t(status.label)}
                        </Badge>
                      </td>
                    )}
                    {columns.map((column) => metricCell(campaign, column, "text-muted-foreground"))}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={columnCount} className="bg-muted/15 px-4 py-2">
                        {campaign.adsets.map((adset) => (
                          <details key={adset.name} className="border-b last:border-b-0">
                            <summary className="cursor-pointer py-2 text-sm font-medium">
                              {adset.name}
                            </summary>
                            <div className="space-y-1 pb-3 pl-3 sm:pl-5">
                              {adset.ads.map((ad) => (
                                <div
                                  key={ad.name}
                                  className="grid grid-cols-[minmax(220px,1fr)_120px_100px] items-center gap-3 py-1.5 text-xs text-muted-foreground"
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    {ad.thumbnail_url && (
                                      <a
                                        href={ad.thumbnail_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`${labels.openMedia}: ${ad.name}`}
                                        className="size-9 shrink-0 rounded-md border bg-cover bg-center shadow-xs"
                                        style={{ backgroundImage: `url(${ad.thumbnail_url})` }}
                                      />
                                    )}
                                    {ad.story_id ? (
                                      <a
                                        href={`https://www.facebook.com/${encodeURIComponent(ad.story_id)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="truncate hover:underline"
                                      >
                                        {ad.name}
                                      </a>
                                    ) : (
                                      <span className="truncate">{ad.name}</span>
                                    )}
                                  </span>
                                  <span className="text-right tabular-nums">
                                    {money(ad.spend, currency)}
                                  </span>
                                  <span className="text-right tabular-nums">
                                    {number(ad.conversions)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/45 font-semibold">
              <td className="px-4 py-3">{labels.total}</td>
              {showStatus && <td className="px-4 py-3" />}
              {columns.map((column) => metricCell(total, column))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function TrafficDashboard() {
  const t = useT();
  const idioma = useIdioma();
  const [preset, setPreset] = useState("30");
  const [window, setWindow] = useState(() => range(30));
  const [report, setReport] = useState<ReportResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<CampaignMetricColumn[]>([]);
  const [activeMetric, setActiveMetric] = useState<"spend" | "conversions" | "revenue">(
    "conversions",
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch(`/api/v1/reports/traffic?from=${window.from}&to=${window.to}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json()) as ReportResponse;
        if (!response.ok)
          throw new Error(body.error?.message ?? t("Não foi possível carregar o relatório."));
        if (active) setReport(body.data);
      })
      .catch((cause: unknown) => {
        if (active && (cause as { name?: string }).name !== "AbortError") {
          setError(
            cause instanceof Error ? cause.message : t("Não foi possível carregar o relatório."),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [window, t]);

  const updatedAt = useMemo(
    () =>
      report?.sync.last_succeeded_at
        ? new Date(report.sync.last_succeeded_at).toLocaleString(
            idioma === "es" ? "es-ES" : "pt-BR",
          )
        : null,
    [idioma, report],
  );

  function changePreset(value: string) {
    setPreset(value);
    setLoading(true);
    setError(null);
    setReport(null);
    if (value === "month") setWindow(thisMonth());
    else if (value !== "custom") setWindow(range(Number(value)));
  }

  function changeWindow(next: { from: string; to: string }) {
    setLoading(true);
    setError(null);
    setReport(null);
    setWindow(next);
  }

  async function downloadSummary() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const query = new URLSearchParams({
        from: window.from,
        to: window.to,
        language: idioma,
      });
      const response = await fetch(`/api/v1/reports/traffic/pdf?${query.toString()}`, {
        headers: { accept: "application/pdf" },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? t("Não foi possível baixar o relatório."));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const link = document.createElement("a");
      link.href = url;
      link.download = match?.[1] ?? `relatorio-resumido-${window.from}-a-${window.to}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDownloadError(
        cause instanceof Error ? cause.message : t("Não foi possível baixar o relatório."),
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {t("Relatório de desempenho")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {updatedAt
              ? `${t("Última atualização")}: ${updatedAt}`
              : t("Aguardando a primeira sincronização.")}
          </p>
        </div>
        {/* Fixa no lugar que o dono escolheu arrastando (21/09/2026): alinhada ao
            título e um pouco afastada da borda direita. O arrasto saiu. */}
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-3 shadow-sm lg:mr-20">
          <div className="space-y-1">
            <Label htmlFor="traffic-period">{t("Período")}</Label>
            <Select value={preset} onValueChange={changePreset}>
              <SelectTrigger id="traffic-period" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">{t("Este mês")}</SelectItem>
                <SelectItem value="7">{t("Últimos 7 dias")}</SelectItem>
                <SelectItem value="14">{t("Últimos 14 dias")}</SelectItem>
                <SelectItem value="30">{t("Últimos 30 dias")}</SelectItem>
                <SelectItem value="90">{t("Últimos 90 dias")}</SelectItem>
                <SelectItem value="custom">{t("Personalizado")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={downloadSummary}
            disabled={!report || loading || downloading}
          >
            {downloading ? t("Preparando PDF…") : t("Baixar relatório")}
          </Button>
          {preset === "custom" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="traffic-from">{t("De")}</Label>
                <Input
                  id="traffic-from"
                  type="date"
                  value={window.from}
                  onChange={(event) => changeWindow({ ...window, from: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="traffic-to">{t("Até")}</Label>
                <Input
                  id="traffic-to"
                  type="date"
                  value={window.to}
                  onChange={(event) => changeWindow({ ...window, to: event.target.value })}
                />
              </div>
            </>
          )}
          {report && (
            <ColumnPresetMenu
              organizationKey={report.organization_key}
              viewerKey={report.viewer_key}
              model={report.model}
              initialPresets={report.column_presets}
              defaultPresetId={report.default_preset_id}
              defaultColumns={report.default_columns}
              canManage={report.can_manage_defaults}
              columnLabel={columnLabel}
              onColumnsChange={setSelectedColumns}
            />
          )}
        </div>
      </header>

      {report?.sync.status === "failed" && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          <p className="font-medium">{t("A atualização mais recente falhou.")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("O último dado confirmado foi preservado. Avise quem administra a plataforma.")}
          </p>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          {error}
        </div>
      )}
      {downloadError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          {downloadError}
        </div>
      )}
      {loading && <p className="text-sm text-muted-foreground">{t("Carregando relatório…")}</p>}
      {!loading && report?.currencies.length === 0 && (
        <div className="rounded-xl border bg-card p-6 text-sm">
          <p className="font-medium">{t("Ainda não há dados para este período.")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("Confira as contas escolhidas ou rode uma sincronização no admin.")}
          </p>
        </div>
      )}

      {report?.currencies.map((group) => {
        const meta = group.platforms.find((item) => item.platform === "meta_ads");
        const google = group.platforms.find((item) => item.platform === "google_ads");
        const metaCampaigns = group.campaigns.filter((item) => item.platform === "meta_ads");
        const googleCampaigns = group.campaigns.filter((item) => item.platform === "google_ads");
        const conversionLabel = report.model === "ecommerce" ? t("Compras") : t("Conversões");
        const visibleColumns = selectedColumns.length ? selectedColumns : report.default_columns;
        const campaignLabels = {
          campaign: t("Campanha"),
          total: t("Total"),
          conversions: conversionLabel,
          openMedia: t("Abrir mídia"),
        };
        const trafficStages = buildTrafficFunnelStages(group.summary, report.model, idioma);
        const lastTrafficValue = trafficStages.at(-1)?.value ?? 0;
        const funnelStages: FunnelStage[] = [
          ...trafficStages,
          {
            key: "crm-entered",
            label: localText(idioma, "Entraram no CRM", "Ingresaron al CRM"),
            value: report.crm.leads_entered,
            rate: lastTrafficValue > 0 ? (report.crm.leads_entered / lastTrafficValue) * 100 : null,
            cost:
              report.crm.leads_entered > 0 ? group.summary.spend / report.crm.leads_entered : null,
          },
          {
            key: "crm-service",
            label: localText(idioma, "Em atendimento", "En atención"),
            value: report.crm.in_service,
            rate:
              report.crm.leads_entered > 0
                ? (report.crm.in_service / report.crm.leads_entered) * 100
                : null,
            cost: report.crm.in_service > 0 ? group.summary.spend / report.crm.in_service : null,
          },
          {
            key: "crm-won",
            label: localText(idioma, "Vendas fechadas", "Ventas cerradas"),
            value: report.crm.closed_won,
            rate:
              report.crm.in_service > 0
                ? (report.crm.closed_won / report.crm.in_service) * 100
                : null,
            cost: report.crm.closed_won > 0 ? group.summary.spend / report.crm.closed_won : null,
          },
        ];
        const costPerClosed =
          report.crm.closed_won > 0 ? group.summary.spend / report.crm.closed_won : null;
        const spendTrend = group.daily.map((day) => day.spend_meta + day.spend_google);
        const conversionTrend = group.daily.map((day) => day.conversions);
        const revenueTrend = group.daily.map((day) => day.revenue);
        const costTrend = group.daily.map((day) =>
          day.conversions > 0 ? (day.spend_meta + day.spend_google) / day.conversions : 0,
        );
        const previous = group.comparison;
        const heroMetrics =
          report.model === "ecommerce"
            ? [
                {
                  key: "revenue" as const,
                  label: t("Faturamento"),
                  value: group.summary.revenue,
                  previous: previous?.revenue,
                  sparkline: revenueTrend,
                  formatter: (value: number) => money(value, group.currency),
                },
                {
                  key: "revenue" as const,
                  label: "ROAS",
                  value: group.summary.roas ?? 0,
                  previous: previous?.roas,
                  sparkline: revenueTrend,
                  formatter: (value: number) => `${number(value)}x`,
                },
                {
                  key: "conversions" as const,
                  label: localText(idioma, "Vendas", "Ventas"),
                  value: group.summary.purchases || group.summary.conversions,
                  previous: previous?.purchases || previous?.conversions,
                  sparkline: conversionTrend,
                  formatter: number,
                },
                {
                  key: "conversions" as const,
                  label: localText(idioma, "Fechadas no CRM", "Cerradas en el CRM"),
                  value: report.crm.closed_won,
                  previous: report.crm.previous?.closed_won,
                  sparkline: conversionTrend,
                  formatter: number,
                },
              ]
            : report.model === "messages"
              ? [
                  {
                    key: "spend" as const,
                    label: t("Investimento"),
                    value: group.summary.spend,
                    previous: previous?.spend,
                    sparkline: spendTrend,
                    formatter: (value: number) => money(value, group.currency),
                  },
                  {
                    key: "conversions" as const,
                    label: localText(idioma, "Conversas iniciadas", "Conversaciones iniciadas"),
                    value: group.summary.messaging_conversations,
                    previous: previous?.messaging_conversations,
                    sparkline: conversionTrend,
                    formatter: number,
                  },
                  {
                    key: "spend" as const,
                    label: localText(idioma, "Custo por conversa", "Costo por conversación"),
                    value: group.summary.cost_per_messaging_conversation ?? 0,
                    previous: previous?.cost_per_messaging_conversation,
                    sparkline: costTrend,
                    formatter: (value: number) => money(value, group.currency),
                  },
                  {
                    key: "conversions" as const,
                    label: localText(idioma, "Fechadas no CRM", "Cerradas en el CRM"),
                    value: report.crm.closed_won,
                    previous: report.crm.previous?.closed_won,
                    sparkline: conversionTrend,
                    formatter: number,
                  },
                ]
              : [
                  {
                    key: "spend" as const,
                    label: t("Investimento"),
                    value: group.summary.spend,
                    previous: previous?.spend,
                    sparkline: spendTrend,
                    formatter: (value: number) => money(value, group.currency),
                  },
                  // Ordem pedida pelo dono (21/09/2026): investimento, alcance, leads, custo
                  // por lead. Vendas fechadas seguem no funil logo abaixo.
                  {
                    key: "spend" as const,
                    label: localText(idioma, "Alcance", "Alcance"),
                    value: group.summary.reach ?? 0,
                    previous: previous?.reach,
                    // Não há alcance diário (alcance não soma dia a dia), então sem minigráfico.
                    sparkline: [],
                    formatter: number,
                  },
                  {
                    key: "conversions" as const,
                    label: t("Leads"),
                    value: group.summary.leads,
                    previous: previous?.leads,
                    sparkline: conversionTrend,
                    formatter: number,
                  },
                  {
                    key: "spend" as const,
                    label: localText(idioma, "Custo por lead", "Costo por lead"),
                    value: group.summary.cost_per_lead ?? 0,
                    previous: previous?.cost_per_lead,
                    sparkline: costTrend,
                    formatter: (value: number) => money(value, group.currency),
                  },
                ];

        return (
          <section key={group.currency} className="space-y-6">
            <div className="relative overflow-hidden rounded-3xl border bg-card/70 p-3 shadow-[0_24px_80px_-48px_var(--primary)] backdrop-blur sm:p-5">
              <div className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full bg-primary/10 blur-3xl" />
              <div className="relative mb-4 flex items-center justify-between gap-3 px-1">
                <div>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight">
                    {report.currencies.length > 1
                      ? group.currency
                      : localText(idioma, "O que move o resultado", "Lo que mueve el resultado")}
                  </h2>
                </div>
              </div>
              <div className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {heroMetrics.map(({ key: series, ...metric }, index) => (
                  <HeroMetric
                    key={`${metric.label}-${index}`}
                    {...metric}
                    active={activeMetric === series}
                    onSelect={() => setActiveMetric(series)}
                    comparisonLabel={t("Período anterior")}
                  />
                ))}
              </div>
            </div>

            <ConversionFunnel
              eyebrow={t("Funil de desempenho")}
              title={localText(
                idioma,
                "Do alcance à venda fechada",
                "Del alcance a la venta cerrada",
              )}
              stages={funnelStages}
              idioma={idioma}
              currency={group.currency}
              summary={[
                { label: t("Investimento"), value: money(group.summary.spend, group.currency) },
                {
                  label: localText(idioma, "Vendas fechadas", "Ventas cerradas"),
                  value: number(report.crm.closed_won),
                  emphasis: true,
                },
                {
                  label: localText(idioma, "Custo por venda fechada", "Costo por venta cerrada"),
                  value: costPerClosed == null ? "—" : money(costPerClosed, group.currency),
                  emphasis: true,
                },
              ]}
            />

            <details open className="group overflow-hidden rounded-2xl border bg-card shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b px-4 py-4 sm:px-5">
                <div>
                  <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                    {t("Período")}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">
                    {t("Investimento")} · {t("Conversões")}
                  </h3>
                </div>
                <span
                  className="text-sm text-muted-foreground group-open:rotate-180"
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </summary>
              <div className="h-72 p-3 sm:h-80 sm:p-5">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={group.daily}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      yAxisId="spend"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      yAxisId="conversion"
                      orientation="right"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <Tooltip
                      labelFormatter={(label) =>
                        new Date(`${String(label)}T12:00:00`).toLocaleDateString(
                          idioma === "es" ? "es-ES" : "pt-BR",
                        )
                      }
                      formatter={(value, name) => [
                        name === t("Conversões")
                          ? number(Number(value))
                          : money(Number(value), group.currency),
                        name,
                      ]}
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 14,
                        boxShadow: "0 18px 50px -28px var(--foreground)",
                      }}
                    />
                    <Area
                      yAxisId="spend"
                      type="monotone"
                      dataKey="spend_meta"
                      stackId="spend"
                      fill="#1877F2"
                      stroke="#1877F2"
                      fillOpacity={activeMetric === "spend" ? 0.55 : 0.16}
                      name="Meta"
                    />
                    <Bar
                      yAxisId="spend"
                      dataKey="spend_google"
                      stackId="spend"
                      fill="#4285F4"
                      opacity={activeMetric === "spend" ? 0.8 : 0.25}
                      name="Google"
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      yAxisId="conversion"
                      type="monotone"
                      dataKey={activeMetric === "revenue" ? "revenue" : "conversions"}
                      stroke="var(--primary)"
                      strokeWidth={activeMetric === "spend" ? 2 : 3.5}
                      dot={false}
                      name={activeMetric === "revenue" ? t("Faturamento") : t("Conversões")}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </details>

            {meta && (
              <details
                open
                className="group overflow-hidden rounded-2xl border border-[#1877F2]/30 bg-card shadow-sm"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 border-b border-[#1877F2]/20 bg-[#1877F2]/[0.06] px-4 py-4 sm:px-5">
                  <PlatformMark platform="meta_ads" />
                  <div>
                    <h3 id={`meta-${group.currency}`} className="text-xl font-semibold">
                      Meta Ads
                    </h3>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-xs text-muted-foreground">{t("Investimento")}</p>
                    <p className="font-semibold">{money(meta.spend, group.currency)}</p>
                  </div>
                  <span className="text-muted-foreground group-open:rotate-180" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="space-y-5 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <Kpi
                      label={t("Alcance")}
                      value={meta.reach == null ? "—" : number(meta.reach)}
                    />
                    <Kpi label={t("Impressões")} value={number(meta.impressions)} />
                    <Kpi
                      label={t("Frequência")}
                      value={meta.frequency == null ? "—" : `${number(meta.frequency)}x`}
                    />
                    <Kpi
                      label="CPM"
                      value={meta.cpm == null ? "—" : money(meta.cpm, group.currency)}
                    />
                    <Kpi label="CTR" value={percent(meta.ctr)} />
                    <Kpi label={t("Cliques no link")} value={number(meta.link_clicks)} />
                    <Kpi
                      label="CPC"
                      value={meta.cpc == null ? "—" : money(meta.cpc, group.currency)}
                    />
                    <Kpi label={conversionLabel} value={number(meta.conversions)} />
                    <Kpi
                      label={t("Custo por conversão")}
                      value={
                        meta.cost_per_conversion == null
                          ? "—"
                          : money(meta.cost_per_conversion, group.currency)
                      }
                    />
                    <Kpi label={t("Investimento")} value={money(meta.spend, group.currency)} />
                  </div>
                  {meta.video_views > 0 && (
                    <div className="rounded-xl border bg-muted/20 p-4">
                      <h4 className="font-semibold">{t("Retenção de vídeo")}</h4>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                        {[
                          [t("Visualizações"), meta.video_views],
                          ["25%", meta.video_p25],
                          ["50%", meta.video_p50],
                          ["75%", meta.video_p75],
                          ["95%", meta.video_p95],
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <p className="text-muted-foreground">{label}</p>
                            <p className="font-semibold">{number(Number(value))}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <CampaignTable
                    campaigns={metaCampaigns}
                    currency={group.currency}
                    total={meta}
                    platform="meta_ads"
                    labels={campaignLabels}
                    columns={visibleColumns}
                    idioma={idioma}
                  />
                </div>
              </details>
            )}

            {google && (
              <details open className="group overflow-hidden rounded-2xl border bg-card shadow-sm">
                <summary className="flex cursor-pointer list-none items-center gap-3 border-b px-4 py-4 sm:px-5">
                  <PlatformMark platform="google_ads" />
                  <div>
                    <h3 id={`google-${group.currency}`} className="text-xl font-semibold">
                      Google Ads
                    </h3>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-xs text-muted-foreground">{t("Investimento")}</p>
                    <p className="font-semibold">{money(google.spend, group.currency)}</p>
                  </div>
                  <span className="text-muted-foreground group-open:rotate-180" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="space-y-5 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Kpi label={t("Impressões")} value={number(google.impressions)} />
                    <Kpi label={t("Cliques no link")} value={number(google.clicks)} />
                    <Kpi label="CTR" value={percent(google.ctr)} />
                    <Kpi
                      label="CPC"
                      value={google.cpc == null ? "—" : money(google.cpc, group.currency)}
                    />
                    <Kpi label={t("Investimento")} value={money(google.spend, group.currency)} />
                    <Kpi label={conversionLabel} value={number(google.conversions)} />
                    <Kpi
                      label="CPA"
                      value={
                        google.cost_per_conversion == null
                          ? "—"
                          : money(google.cost_per_conversion, group.currency)
                      }
                    />
                    <Kpi label="CVR" value={percent(google.conversion_rate)} />
                  </div>
                  <CampaignTable
                    campaigns={googleCampaigns}
                    currency={group.currency}
                    total={google}
                    platform="google_ads"
                    labels={campaignLabels}
                    columns={visibleColumns}
                    idioma={idioma}
                  />
                </div>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
