"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { DragScroll } from "@/components/ui/drag-scroll";
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
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { tagDeIdioma } from "@/lib/i18n/datas";
import {
  CAMPAIGN_METRIC_COLUMNS,
  campaignMetricColumnsForPlatform,
  type AdPlatform,
  type CampaignMetricColumn,
} from "@/lib/windsor/types";
import type { TrafficColumnPreset } from "@/lib/windsor/column-presets";
import type { TrafficRichCrmInsights } from "@/lib/windsor/traffic-insights";
import {
  PRIORITY_METRIC_META,
  defaultPriorityMetrics,
  priorityMetricValue,
  type PriorityMetricColumn,
} from "@/lib/windsor/priority-metrics";
import { ColumnPresetMenu } from "./ColumnPresetMenu";
import { buildTrafficFunnelStages, ConversionFunnel, type FunnelStage } from "./ConversionFunnel";
import { CostSignal, CostThresholdControl, type CostThreshold } from "./CostThresholds";
import { PriorityMetricSelector } from "./PriorityMetricSelector";
import { CreativePerformance, TrafficTimeline } from "./RichReportSections";
import { useColunasAjustaveis, type ConfiguracaoColunaAjustavel } from "./colunas-ajustaveis";

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
  /** Chave única da campanha (plataforma + id); nomes se repetem entre campanhas. */
  id?: string;
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
    default_columns: CampaignMetricColumn[] | Record<AdPlatform, CampaignMetricColumn[]>;
    default_preset_id?: string | null;
    default_preset_ids?: Record<AdPlatform, string | null>;
    column_presets: TrafficColumnPreset[] | Record<AdPlatform, TrafficColumnPreset[]>;
    can_manage_defaults: boolean;
    priority_metrics?: PriorityMetricColumn[];
    cost_thresholds?: CostThreshold[];
    sync: { status: string; last_succeeded_at: string | null; error: string | null };
    crm: Partial<TrafficRichCrmInsights> &
      Pick<TrafficRichCrmInsights, "leads_entered" | "in_service" | "closed_won"> & {
        previous?: Partial<TrafficRichCrmInsights> &
          Pick<TrafficRichCrmInsights, "leads_entered" | "in_service" | "closed_won">;
      };
    currencies: CurrencyGroup[];
  };
  error?: { message?: string };
}

function columnsForPlatform(
  report: ReportResponse["data"],
  platform: AdPlatform,
): CampaignMetricColumn[] {
  const raw = Array.isArray(report.default_columns)
    ? report.default_columns
    : report.default_columns[platform];
  const allowed = new Set(campaignMetricColumnsForPlatform(platform));
  const compatible = raw.filter((column) => allowed.has(column));
  return compatible.length > 0 ? compatible : campaignMetricColumnsForPlatform(platform);
}

function presetsForPlatform(
  report: ReportResponse["data"],
  platform: AdPlatform,
): TrafficColumnPreset[] {
  if (Array.isArray(report.column_presets)) return report.column_presets;
  return report.column_presets[platform];
}

function defaultPresetForPlatform(
  report: ReportResponse["data"],
  platform: AdPlatform,
): string | null {
  return report.default_preset_ids?.[platform] ?? report.default_preset_id ?? null;
}

function normalizeCrm(
  crm: Partial<TrafficRichCrmInsights> &
    Pick<TrafficRichCrmInsights, "leads_entered" | "in_service" | "closed_won">,
): TrafficRichCrmInsights {
  return {
    leads_entered: crm.leads_entered,
    in_service: crm.in_service,
    closed_won: crm.closed_won,
    closed_lost: crm.closed_lost ?? 0,
    stages: crm.stages ?? [],
    loss_reasons: crm.loss_reasons ?? [],
    stage_conversion: crm.stage_conversion ?? [],
    leads_timeline: crm.leads_timeline ?? [],
    sales_timeline: crm.sales_timeline ?? [],
    sales_values: crm.sales_values ?? [],
    leads_by_origin: crm.leads_by_origin ?? { meta_ads: null, google_ads: null },
    won_by_origin: crm.won_by_origin ?? { meta_ads: null, google_ads: null },
  };
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
// Valor vazio nunca vira travessão (regra do dono): quem chama diz o que mostrar.
function percent(value: number | null, blank = ""): string {
  return value == null ? blank : `${number(value)}%`;
}

/**
 * Descrição leiga embaixo do nome da campanha, derivada do próprio nome
 * (regra `_desc_map` do painel antigo da Veritas). Nome que não bate em
 * nenhuma chave fica sem descrição: não se inventa o que a campanha faz.
 */
const CAMPAIGN_DESCRIPTIONS: Array<[needle: string, description: string]> = [
  ["RMKT", "Remarketing: quem já viu"],
  ["REMARKETING", "Remarketing: quem já viu"],
  ["CONVERSÃO", "Conversão: busca o resultado direto"],
  ["CONVERSAO", "Conversão: busca o resultado direto"],
  ["DISTRIBUIÇÃO", "Alcance para público novo"],
  ["DISTRIBUICAO", "Alcance para público novo"],
  ["PESQUISA", "Pesquisa no Google"],
  ["ADVANTAGE", "Advantage+: público escolhido pela Meta"],
  ["CATÁLOGO", "Catálogo de produtos"],
  ["CATALOGO", "Catálogo de produtos"],
];
export function campaignDescription(name: string): string | null {
  const upper = name.toUpperCase();
  return CAMPAIGN_DESCRIPTIONS.find(([needle]) => upper.includes(needle))?.[1] ?? null;
}

/**
 * O `story_id` do Meta vem como `pageId_postId`; o painel antigo montava
 * `https://www.facebook.com/{pageId}/posts/{postId}/` para abrir o post.
 * Sem o `_` fica o endereço curto, que o Facebook também resolve.
 */
export function postUrl(storyId: string): string {
  const [pageId, postId] = storyId.split("_");
  if (pageId && postId) {
    return `https://www.facebook.com/${encodeURIComponent(pageId)}/posts/${encodeURIComponent(postId)}/`;
  }
  return `https://www.facebook.com/${encodeURIComponent(storyId)}`;
}

/** Iniciais para a miniatura quando o anúncio não tem imagem (painel antigo). */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
  return letters || "?";
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
  hint,
  value,
  previous,
  sparkline,
  formatter,
  active,
  onSelect,
  comparisonLabel,
  betterWhen = "up",
}: {
  label: string;
  /** Frase de uma linha em linguagem simples ("pessoas únicas que viram"). */
  hint: string;
  value: number;
  previous?: number | null;
  sparkline: number[];
  formatter: (value: number) => string;
  active: boolean;
  onSelect: () => void;
  comparisonLabel: string;
  /** Custo caindo é bom: a cor da variação segue "melhor quando", não o sinal. */
  betterWhen?: "up" | "down";
}) {
  const animated = useAnimatedNumber(value);
  const delta = metricDelta(value, previous);
  const improved = delta != null && (betterWhen === "up" ? delta >= 0 : delta <= 0);
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
      <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      <span className="mt-2 flex min-h-5 items-center gap-1.5 text-xs">
        {delta == null ? (
          <span className="text-muted-foreground">{comparisonLabel}</span>
        ) : (
          <span
            className={improved ? "font-semibold text-success-fg" : "font-semibold text-error-fg"}
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
  // Célula sem dado fica vazia; travessão nunca (regra do dono).
  if (platform === "google_ads" && META_ONLY_COLUMNS.has(column)) return "";
  if (column === "budget") {
    if (metrics.budget == null) return "";
    return `${money(metrics.budget, currency)}${metrics.budget_type === "daily" ? "/dia" : " total"}`;
  }
  const value = metrics[column];
  if (typeof value !== "number") return "";
  if (MONEY_COLUMNS.has(column)) return money(value, currency);
  if (column === "ctr") return percent(value);
  if (column === "roas") return `${number(value)}x`;
  return number(value);
}

type CampaignStatusFilter = "all" | "active" | "paused";
type CampaignSortKey = "name" | CampaignMetricColumn;
type SortDirection = "ascending" | "descending";
type ResizableColumnKey = "name" | "status" | CampaignMetricColumn;

const CAMPAIGN_RESIZABLE_COLUMNS = Object.fromEntries(
  (["name", "status", ...CAMPAIGN_METRIC_COLUMNS] as ResizableColumnKey[]).map((column) => [
    column,
    column === "name"
      ? { larguraMinima: 180, larguraPadrao: 280 }
      : column === "status"
        ? { larguraMinima: 112, larguraPadrao: 132 }
        : { larguraMinima: 104, larguraPadrao: 144 },
  ]),
) as Record<ResizableColumnKey, ConfiguracaoColunaAjustavel>;

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

function summarizeCampaigns(campaigns: Campaign[]): Metrics {
  const sum = (key: keyof Metrics) =>
    campaigns.reduce((total, campaign) => {
      const value = campaign[key];
      return total + (typeof value === "number" ? value : 0);
    }, 0);
  const spend = sum("spend");
  const conversions = sum("conversions");
  const leads = sum("leads");
  const landingPageViews = sum("landing_page_views");
  const addToCart = sum("add_to_cart");
  const initiateCheckout = sum("initiate_checkout");
  const purchases = sum("purchases");
  const messagingConversations = sum("messaging_conversations");
  const revenue = sum("revenue");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const linkClicks = sum("link_clicks");
  const reaches = campaigns
    .map((campaign) => campaign.reach)
    .filter((value): value is number => value != null);
  const reach = reaches.length ? reaches.reduce((total, value) => total + value, 0) : null;
  const budgetTypes = new Set(
    campaigns.map((campaign) => campaign.budget_type).filter((value) => value != null),
  );
  const budgets = campaigns
    .map((campaign) => campaign.budget)
    .filter((value): value is number => value != null);
  const budgetType = budgetTypes.size === 1 ? [...budgetTypes][0]! : null;
  const budget =
    budgetType && budgets.length ? budgets.reduce((total, value) => total + value, 0) : null;

  return {
    budget,
    budget_type: budgetType,
    spend,
    conversions,
    leads,
    landing_page_views: landingPageViews,
    cost_per_landing_page_view: landingPageViews > 0 ? spend / landingPageViews : null,
    add_to_cart: addToCart,
    cost_per_add_to_cart: addToCart > 0 ? spend / addToCart : null,
    initiate_checkout: initiateCheckout,
    cost_per_initiate_checkout: initiateCheckout > 0 ? spend / initiateCheckout : null,
    purchases,
    cost_per_purchase: purchases > 0 ? spend / purchases : null,
    messaging_conversations: messagingConversations,
    cost_per_messaging_conversation:
      messagingConversations > 0 ? spend / messagingConversations : null,
    revenue,
    impressions,
    reach,
    frequency: reach && reach > 0 ? impressions / reach : null,
    clicks,
    link_clicks: linkClicks,
    cost_per_conversion: conversions > 0 ? spend / conversions : null,
    cost_per_lead: leads > 0 ? spend / leads : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    ctr: impressions > 0 ? (linkClicks / impressions) * 100 : null,
    cpc: linkClicks > 0 ? spend / linkClicks : null,
    conversion_rate: linkClicks > 0 ? (conversions / linkClicks) * 100 : null,
    roas: spend > 0 ? revenue / spend : null,
    average_order_value: conversions > 0 ? revenue / conversions : null,
    video_views: sum("video_views"),
    video_p25: sum("video_p25"),
    video_p50: sum("video_p50"),
    video_p75: sum("video_p75"),
    video_p95: sum("video_p95"),
    landing_page_views_available: campaigns.some(
      (campaign) => campaign.landing_page_views_available,
    ),
    add_to_cart_available: campaigns.some((campaign) => campaign.add_to_cart_available),
    initiate_checkout_available: campaigns.some((campaign) => campaign.initiate_checkout_available),
    purchases_available: campaigns.some((campaign) => campaign.purchases_available),
    messaging_conversations_available: campaigns.some(
      (campaign) => campaign.messaging_conversations_available,
    ),
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

/** Custo por resultado no período: gasto ÷ conversões. */
function costPerResult(metrics: Pick<Metrics, "spend" | "conversions">): number | null {
  return metrics.conversions > 0 ? metrics.spend / metrics.conversions : null;
}

function costColumnValue(metrics: Metrics, column: CampaignMetricColumn): number | null {
  if (column === "cost_per_lead") return metrics.cost_per_lead;
  if (column === "cost_per_purchase") return metrics.cost_per_purchase;
  if (column === "cost_per_messaging_conversation") return metrics.cost_per_messaging_conversation;
  return null;
}

function AdThumbnail({
  ad,
  label,
}: {
  ad: Campaign["adsets"][number]["ads"][number];
  label: string;
}) {
  const frame =
    "grid size-13 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted text-xs font-bold text-muted-foreground shadow-xs";
  const content = ad.thumbnail_url ? (
    <span
      aria-hidden="true"
      className="size-full bg-cover bg-center"
      style={{ backgroundImage: `url(${ad.thumbnail_url})` }}
    />
  ) : (
    <span aria-hidden="true">{initials(ad.name)}</span>
  );
  if (!ad.story_id) return <span className={frame}>{content}</span>;
  return (
    <a
      href={postUrl(ad.story_id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}: ${ad.name}`}
      className={`${frame} focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden`}
    >
      {content}
    </a>
  );
}

function CampaignTable({
  campaigns,
  currency,
  platform,
  organizationKey,
  viewerKey,
  labels,
  columns,
  idioma,
  priorityMetric,
  threshold,
  columnMenu,
}: {
  campaigns: Campaign[];
  currency: string;
  platform: "meta_ads" | "google_ads";
  organizationKey: string;
  viewerKey: string;
  columns: CampaignMetricColumn[];
  idioma: string;
  priorityMetric: PriorityMetricColumn | "conversions";
  threshold?: CostThreshold;
  columnMenu: ReactNode;
  labels: {
    campaign: string;
    total: string;
    conversions: string;
  };
}) {
  const t = useT();
  const isMeta = platform === "meta_ads";
  const storageKey = `traffic-campaign-status-filter:${platform}`;
  const widthsStorageKey = `traffic-report-column-widths:${organizationKey}:${platform}`;
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>("all");
  const [sortKey, setSortKey] = useState<CampaignSortKey>("spend");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedAdsets, setExpandedAdsets] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [onlySelected, setOnlySelected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputId = useId();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const statusChangedByUser = useRef(false);
  // Antes da primeira sincronização que traz o status, nenhuma campanha o conhece.
  // Nesse caso a coluna e o filtro somem em vez de mostrar "Não informada" em tudo.
  const showStatus = campaigns.some((campaign) => campaignStatus(campaign.campaign_status).known);
  const activeFilter = showStatus ? statusFilter : "all";
  const columnCount = columns.length + (showStatus ? 2 : 1);
  const defaultColumnOrder = useMemo(
    () => ["name", ...(showStatus ? ["status" as const] : []), ...columns] as ResizableColumnKey[],
    [columns, showStatus],
  );
  const campaignsWithKeys = useMemo(
    () => campaigns.map((campaign, index) => ({
      campaign,
      key: campaign.id ?? `${campaign.platform}:${campaign.name}:${index}`,
    })),
    [campaigns],
  );

  useEffect(() => {
    statusChangedByUser.current = false;
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "all" || stored === "active" || stored === "paused") {
      const timeout = window.setTimeout(() => {
        if (!statusChangedByUser.current) setStatusFilter(stored);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [storageKey]);

  const {
    alcaDaColuna: resizeHandle,
    estiloDaColuna: columnStyle,
    ordemDasColunas: columnOrder,
    propriedadesDeArraste: reorderProps,
    classeDoIndicadorDeQueda: dropIndicatorClass,
    restaurarOrdemPadrao: resetColumnOrder,
    ordemFoiAlterada: columnOrderChanged,
  } = useColunasAjustaveis({
    storageKey: widthsStorageKey,
    colunas: CAMPAIGN_RESIZABLE_COLUMNS,
    traduzir: t,
    ordem: {
      storageKey: `traffic-report-column-order:${organizationKey}:${viewerKey}:${platform}`,
      padrao: defaultColumnOrder,
      fixa: "name",
    },
  });

  const statusFilteredCampaigns = useMemo(
    () => campaignsWithKeys.filter(({ campaign }) =>
      activeFilter === "all" || campaignStatus(campaign.campaign_status).category === activeFilter),
    [activeFilter, campaignsWithKeys],
  );
  const normalizedSearch = useMemo(
    () => searchQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(idioma).trim(),
    [idioma, searchQuery],
  );
  const searchFilteredCampaigns = useMemo(
    () => statusFilteredCampaigns.filter(({ campaign }) =>
      campaign.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(idioma)
        .includes(normalizedSearch)),
    [idioma, normalizedSearch, statusFilteredCampaigns],
  );
  const selectableCampaigns = useMemo(
    () => searchFilteredCampaigns.filter(({ key }) => !onlySelected || selectedKeys.has(key)),
    [onlySelected, searchFilteredCampaigns, selectedKeys],
  );
  const visibleCampaigns = useMemo(
    () => [...selectableCampaigns]
      .sort((first, second) =>
        compareCampaigns(first.campaign, second.campaign, sortKey, sortDirection, idioma)),
    [idioma, selectableCampaigns, sortDirection, sortKey],
  );
  const visibleTotal = useMemo(
    () => summarizeCampaigns(visibleCampaigns.map(({ campaign }) => campaign)),
    [visibleCampaigns],
  );
  const selectedCampaigns = useMemo(
    () => campaignsWithKeys.filter(({ key }) => selectedKeys.has(key)).map(({ campaign }) => campaign),
    [campaignsWithKeys, selectedKeys],
  );
  const selectedTotal = useMemo(() => summarizeCampaigns(selectedCampaigns), [selectedCampaigns]);
  const selectedVisibleCount = selectableCampaigns.filter(({ key }) => selectedKeys.has(key)).length;
  const allVisibleSelected = selectableCampaigns.length > 0 &&
    selectedVisibleCount === selectableCampaigns.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected;
    }
  }, [allVisibleSelected, selectedVisibleCount]);

  const changeSort = (key: CampaignSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === "descending" ? "ascending" : "descending"));
      return;
    }
    setSortKey(key);
    setSortDirection("descending");
  };

  const changeStatusFilter = (filter: CampaignStatusFilter) => {
    statusChangedByUser.current = true;
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

  const toggleAdset = (key: string) => {
    setExpandedAdsets((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCampaign = (key: string) => {
    const selectionWillBeEmpty = selectedKeys.size === 1 && selectedKeys.has(key);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (selectionWillBeEmpty) setOnlySelected(false);
  };

  const toggleAllVisible = () => {
    const visibleKeys = new Set(selectableCampaigns.map(({ key }) => key));
    const selectionWillBeEmpty = allVisibleSelected &&
      [...selectedKeys].every((key) => visibleKeys.has(key));
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const { key } of selectableCampaigns) {
        if (allVisibleSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    if (selectionWillBeEmpty) setOnlySelected(false);
  };

  const clearSelection = () => {
    setSelectedKeys(new Set());
    setOnlySelected(false);
  };

  // Um único estilo para todo cabeçalho. O <button> de ordenar repete as classes
  // de texto para não depender do que o navegador reseta em botões.
  const headerText = "text-xs font-semibold tracking-[0.08em] uppercase";
  const headerCell = `${headerText} relative px-4 py-3 whitespace-nowrap`;

  const sortableHeader = (key: CampaignSortKey, label: string, align: "left" | "right") => {
    const active = sortKey === key;
    const priority = key !== "name" && key === priorityMetric;
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
        className={`${headerCell} ${dropIndicatorClass(key)} ${align === "right" ? "text-right" : "text-left"} ${priority ? "bg-primary/[0.10] text-foreground" : active ? "text-foreground" : "text-muted-foreground"}`}
        style={columnStyle(key)}
        data-priority={priority || undefined}
        aria-sort={active ? sortDirection : "none"}
        {...reorderProps(key)}
      >
        <button
          type="button"
          className={`${headerText} inline-flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-sm text-inherit hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden ${align === "right" ? "justify-end" : "justify-start"}`}
          onClick={() => changeSort(key)}
          aria-label={`${t("Ordenar por")} ${label}`}
          title={label}
        >
          {align === "right" && arrow}
          <span className="min-w-0 truncate">{label}</span>
          {align === "left" && arrow}
        </button>
        {resizeHandle(key, label)}
      </th>
    );
  };

  const metricCell = (
    metrics: Metrics,
    column: CampaignMetricColumn,
    className = "",
    trailing?: ReactNode,
  ) => {
    const priority = column === priorityMetric;
    return (
      <td
        key={column}
        className={`overflow-hidden px-4 py-3 text-right whitespace-nowrap tabular-nums ${priority ? "bg-primary/[0.06] text-base font-semibold" : ""} ${className}`}
        style={columnStyle(column)}
        data-priority={priority || undefined}
      >
        <span
          className={
            trailing ? "flex flex-col items-end gap-1" : "flex items-center justify-end"
          }
        >
          <CostSignal value={costColumnValue(metrics, column)} threshold={threshold}>
            {metricValue(metrics, column, currency, platform)}
          </CostSignal>
          {trailing}
        </span>
      </td>
    );
  };

  const childCount = (count: number, singular: string, plural: string) => (
    <span className="block truncate text-xs font-normal text-muted-foreground">
      {number(count)} {t(count === 1 ? singular : plural)}
    </span>
  );

  const chevron = (open: boolean) => (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 text-foreground transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {showStatus && (
          <div
            role="group"
            aria-label={t("Filtrar campanhas por status")}
            className="flex flex-wrap items-center gap-1"
          >
            <span className="mr-1 text-xs font-medium text-muted-foreground">{t("Status")}</span>
            {(
              [
                ["all", t("Todas")],
                ["active", t("Ativas")],
                ["paused", t("Pausadas")],
              ] as const
            ).map(([value, label]) => (
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
        <div className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-2 sm:max-w-xl">
          <Label htmlFor={searchInputId} className="sr-only">
            {t("Pesquisar campanha")}
          </Label>
          <Input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("Pesquisar campanha")}
            className="h-9 min-w-40 flex-1"
          />
          <span aria-live="polite" className="whitespace-nowrap text-xs text-muted-foreground">
            {number(visibleCampaigns.length)} {t(visibleCampaigns.length === 1
              ? "campanha encontrada" : "campanhas encontradas")}
          </span>
          {searchQuery.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setSearchQuery("")}>
              {t("Limpar pesquisa")}
            </Button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!columnOrderChanged}
            onClick={resetColumnOrder}
          >
            {t("Voltar à ordem padrão")}
          </Button>
          {columnMenu}
        </div>
      </div>
      {selectedCampaigns.length > 0 && (
        <div role="status" aria-live="polite"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-primary/[0.06] px-3 py-3 text-sm">
          <span className="font-semibold">
            {number(selectedCampaigns.length)} {t(selectedCampaigns.length === 1 ? "campanha marcada" : "campanhas marcadas")}
          </span>
          <span>{t("Investimento")}: <strong>{money(selectedTotal.spend, currency)}</strong></span>
          <span>{labels.conversions}: <strong>{number(selectedTotal.conversions)}</strong></span>
          <span>
            {t("Custo por conversão")}: <strong>{selectedTotal.cost_per_conversion == null
              ? t("sem dado") : money(selectedTotal.cost_per_conversion, currency)}</strong>
          </span>
          <span className="basis-full text-xs text-muted-foreground lg:basis-auto lg:flex-1">
            {t("Os cards do topo e o funil mostram o período inteiro.")}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={onlySelected ? "secondary" : "outline"}
              aria-pressed={onlySelected} onClick={() => setOnlySelected((current) => !current)}>
              {onlySelected ? t("Ver todas as campanhas") : t("Ver só as selecionadas")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>
              {t("Limpar seleção")}
            </Button>
          </div>
        </div>
      )}
      <DragScroll className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="border-b bg-muted/35">
            <tr>
              {columnOrder.map((column) => {
                if (column === "name") {
                  return (
                    <th key={column} scope="col" className={`${headerCell} text-left ${sortKey === "name" ? "text-foreground" : "text-muted-foreground"}`}
                      style={columnStyle("name")} aria-sort={sortKey === "name" ? sortDirection : "none"}>
                      <div className="flex min-w-0 items-center gap-3">
                        <label className="-my-2 -ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center">
                          <input ref={selectAllRef} type="checkbox"
                            className="size-5 cursor-pointer accent-primary"
                            checked={allVisibleSelected} disabled={selectableCampaigns.length === 0}
                            aria-label={t("Selecionar campanhas visíveis")} onChange={toggleAllVisible} />
                        </label>
                        <button type="button"
                          className={`${headerText} inline-flex min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-sm text-inherit hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden`}
                          onClick={() => changeSort("name")} aria-label={`${t("Ordenar por")} ${labels.campaign}`}
                          title={labels.campaign}>
                          <span className="min-w-0 truncate">{labels.campaign}</span>
                          <span aria-hidden="true"
                            className={`w-3 shrink-0 text-center text-[9px] ${sortKey === "name" ? "" : "opacity-0"}`}>
                            {sortDirection === "descending" ? "▼" : "▲"}
                          </span>
                        </button>
                      </div>
                      {resizeHandle("name", labels.campaign)}
                    </th>
                  );
                }
                if (column === "status") {
                  if (!showStatus) return null;
                  return (
                    <th
                      key={column}
                      scope="col"
                      className={`${headerCell} ${dropIndicatorClass(column)} text-left text-muted-foreground`}
                      style={columnStyle("status")}
                      {...reorderProps(column)}
                    >
                      <span className="block truncate">{t("Status")}</span>
                      {resizeHandle("status", t("Status"))}
                    </th>
                  );
                }
                return sortableHeader(column, columnLabel(column, idioma), "right");
              })}
            </tr>
          </thead>
          <tbody className="divide-y">
            {normalizedSearch.length > 0 && visibleCampaigns.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-muted-foreground">
                  {t("Nenhuma campanha corresponde à pesquisa e aos filtros.")}
                </td>
              </tr>
            )}
            {visibleCampaigns.map(({ campaign, key }) => {
              const status = campaignStatus(campaign.campaign_status);
              const description = campaignDescription(campaign.name);
              const hasAdsets = isMeta && campaign.adsets.length > 0;
              const isOpen = hasAdsets && expanded.has(key);
              const lastMetricColumn = [...columnOrder]
                .reverse()
                .find((column): column is CampaignMetricColumn =>
                  column !== "name" && column !== "status",
                );
              return (
                <Fragment key={key}>
                  <tr className="transition-colors hover:bg-muted/45">
                    {columnOrder.map((column) => {
                      if (column === "name") return (
                        <td key={column} className="max-w-md overflow-hidden px-4 py-3 font-medium" style={columnStyle("name")}>
                          <div className="flex items-start gap-3">
                            <label className="-my-2 -ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center">
                              <input type="checkbox" className="size-5 cursor-pointer accent-primary"
                                checked={selectedKeys.has(key)} aria-label={`${t("Selecionar campanha")} ${campaign.name}`}
                                onClick={(event) => event.stopPropagation()} onChange={() => toggleCampaign(key)} />
                            </label>
                            {hasAdsets ? (
                              <button
                                type="button"
                                aria-expanded={isOpen}
                                onClick={() => toggleExpanded(key)}
                                className={`group -my-2 min-w-0 flex-1 cursor-pointer rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden ${isOpen ? "text-[#1877F2]" : ""}`}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  {chevron(isOpen)}
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate">{campaign.name}</span>
                                    {childCount(campaign.adsets.length, "conjunto", "conjuntos")}
                                    {description && (
                                      <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                                        {t(description)}
                                      </span>
                                    )}
                                  </span>
                                </span>
                              </button>
                            ) : (
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{campaign.name}</span>
                                {description && <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{t(description)}</span>}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                      if (column === "status") return showStatus ? (
                        <td key={column} className="overflow-hidden px-4 py-3" style={columnStyle("status")}>
                          <Badge variant={status.variant} className="px-2 py-0 text-[11px] leading-5 whitespace-nowrap">{t(status.label)}</Badge>
                        </td>
                      ) : null;
                      return metricCell(campaign, column, "text-muted-foreground");
                    })}
                  </tr>
                  {isOpen && campaign.adsets.map((adset, adsetIndex) => {
                    const adsetKey = `${key}:adset:${adsetIndex}`;
                    const hasAds = adset.ads.length > 0;
                    const adsetOpen = hasAds && expandedAdsets.has(adsetKey);
                    return (
                      <Fragment key={adsetKey}>
                        <tr className="bg-muted/15 transition-colors hover:bg-muted/45">
                          {columnOrder.map((column) => {
                            if (column === "name") return (
                              <td key={column} className="max-w-md overflow-hidden px-4 py-2.5 font-medium" style={columnStyle("name")}>
                                <div className="flex min-w-0 items-stretch pl-4">
                                  <span aria-hidden="true" className="mr-2 w-3 shrink-0 border-b border-l border-border" />
                                  {hasAds ? (
                                    <button
                                      type="button"
                                      aria-expanded={adsetOpen}
                                      onClick={() => toggleAdset(adsetKey)}
                                      className={`group -my-1 min-w-0 flex-1 cursor-pointer rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden ${adsetOpen ? "text-[#1877F2]" : ""}`}
                                    >
                                      <span className="flex min-w-0 items-center gap-2">
                                        {chevron(adsetOpen)}
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate">{adset.name}</span>
                                          {childCount(adset.ads.length, "anúncio", "anúncios")}
                                        </span>
                                      </span>
                                    </button>
                                  ) : (
                                    <span className="min-w-0 flex-1 px-2 py-1">
                                      <span className="block truncate">{adset.name}</span>
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                            if (column === "status") return showStatus ? (
                              <td key={column} className="overflow-hidden px-4 py-2.5" style={columnStyle("status")} />
                            ) : null;
                            return metricCell(adset, column, "text-muted-foreground");
                          })}
                        </tr>
                        {adsetOpen && adset.ads.map((ad, adIndex) => {
                          const adLink = ad.story_id ? (
                            <a
                              href={postUrl(ad.story_id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                            >
                              <span aria-hidden="true">👁</span>
                              {t("Ver anúncio")}
                            </a>
                          ) : undefined;
                          return (
                            <tr key={`${adsetKey}:ad:${adIndex}`} className="bg-card transition-colors hover:bg-muted/35">
                              {columnOrder.map((column) => {
                                if (column === "name") return (
                                  <td key={column} className="max-w-md overflow-hidden px-4 py-2.5" style={columnStyle("name")}>
                                    <div className="flex min-w-0 items-center gap-2 pl-8">
                                      <span aria-hidden="true" className="h-5 w-3 shrink-0 border-b border-l border-border" />
                                      <AdThumbnail ad={ad} label={t("Ver anúncio")} />
                                      <span className="min-w-0 flex-1 truncate">{ad.name}</span>
                                      {!lastMetricColumn && adLink}
                                    </div>
                                  </td>
                                );
                                if (column === "status") return showStatus ? (
                                  <td key={column} className="overflow-hidden px-4 py-2.5" style={columnStyle("status")} />
                                ) : null;
                                return metricCell(
                                  ad,
                                  column,
                                  "text-muted-foreground",
                                  column === lastMetricColumn ? adLink : undefined,
                                );
                              })}
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/45 font-semibold">
              {columnOrder.map((column) => {
                if (column === "name") return <td key={column} className="overflow-hidden px-4 py-3" style={columnStyle("name")}>{labels.total}</td>;
                if (column === "status") return showStatus ? <td key={column} className="px-4 py-3" style={columnStyle("status")} /> : null;
                return metricCell(visibleTotal, column);
              })}
            </tr>
          </tfoot>
        </table>
      </DragScroll>
    </div>
  );
}

export function TrafficDashboard() {
  const t = useT();
  const idioma = useIdioma();
  const activeOrg = useActiveOrg();
  const [preset, setPreset] = useState("30");
  const [window, setWindow] = useState(() => range(30));
  const [report, setReport] = useState<ReportResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<
    Record<AdPlatform, CampaignMetricColumn[]>
  >({ meta_ads: [], google_ads: [] });
  const [activeMetric, setActiveMetric] = useState<PriorityMetricColumn | "conversions">("leads");
  const [visiblePriorityMetrics, setVisiblePriorityMetrics] = useState<
    PriorityMetricColumn[] | null
  >(null);

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
        if (active) {
          setReport(body.data);
          setVisiblePriorityMetrics(
            body.data.priority_metrics ?? defaultPriorityMetrics(body.data.model),
          );
          setActiveMetric(
            body.data.priority_metrics?.[0] ??
              defaultPriorityMetrics(body.data.model)[0] ??
              "spend",
          );
        }
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
  }, [activeOrg?.orgId, window, t]);

  // "Dados até dd/mm/aaaa" (painel antigo): a data da última sincronização que
  // a resposta já traz, sem hora, porque é o que o cliente quer saber.
  const dataUntil = useMemo(
    () =>
      report?.sync.last_succeeded_at
        ? new Date(report.sync.last_succeeded_at).toLocaleDateString(tagDeIdioma(idioma))
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
          {activeOrg?.name ? (
            <>
              <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                {t("Relatório de desempenho")}
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{activeOrg.name}</h1>
            </>
          ) : (
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {t("Relatório de desempenho")}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {dataUntil
              ? `${t("Dados até")} ${dataUntil}`
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
        </div>
      </header>

      {report && (
        <CostThresholdControl
          key={(report.cost_thresholds ?? [])
            .map((row) => `${row.platform}:${row.good_until}:${row.acceptable_until}`)
            .join("|")}
          initial={report.cost_thresholds ?? []}
          canManage={report.can_manage_defaults}
          model={report.model}
          currency={report.currencies[0]?.currency}
          onSaved={(costThresholds) =>
            setReport((current) =>
              current ? { ...current, cost_thresholds: costThresholds } : current,
            )
          }
        />
      )}

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
        const richCrm = normalizeCrm(report.crm);
        const previousRichCrm = report.crm.previous ? normalizeCrm(report.crm.previous) : undefined;
        const meta = group.platforms.find((item) => item.platform === "meta_ads");
        const google = group.platforms.find((item) => item.platform === "google_ads");
        const metaCampaigns = group.campaigns.filter((item) => item.platform === "meta_ads");
        const googleCampaigns = group.campaigns.filter((item) => item.platform === "google_ads");
        const metaThreshold = (report.cost_thresholds ?? []).find(
          (item) => item.platform === "meta_ads",
        );
        const googleThreshold = (report.cost_thresholds ?? []).find(
          (item) => item.platform === "google_ads",
        );
        const conversionLabel = report.model === "ecommerce" ? t("Compras") : t("Conversões");
        const metaColumns = selectedColumns.meta_ads.length
          ? selectedColumns.meta_ads
          : columnsForPlatform(report, "meta_ads");
        const googleColumns = selectedColumns.google_ads.length
          ? selectedColumns.google_ads
          : columnsForPlatform(report, "google_ads");
        const campaignLabels = {
          campaign: t("Campanha"),
          total: t("Total"),
          conversions: conversionLabel,
        };
        const trafficStages = buildTrafficFunnelStages(group.summary, report.model, idioma);
        const lastTrafficValue = trafficStages.at(-1)?.value ?? 0;
        const funnelStages: FunnelStage[] = [
          ...trafficStages,
          {
            key: "crm-entered",
            label: localText(idioma, "Entraram no CRM", "Ingresaron al CRM"),
            value: richCrm.leads_entered,
            rate: lastTrafficValue > 0 ? (richCrm.leads_entered / lastTrafficValue) * 100 : null,
            cost: richCrm.leads_entered > 0 ? group.summary.spend / richCrm.leads_entered : null,
            asSource: localText(idioma, "que entraram no CRM", "que ingresaron al CRM"),
            asTarget: localText(idioma, "entraram no CRM", "ingresaron al CRM"),
            costLabel: localText(idioma, "por lead no CRM", "por lead en el CRM"),
          },
          {
            key: "crm-service",
            label: localText(idioma, "Em atendimento", "En atención"),
            value: richCrm.in_service,
            rate:
              richCrm.leads_entered > 0 ? (richCrm.in_service / richCrm.leads_entered) * 100 : null,
            cost: richCrm.in_service > 0 ? group.summary.spend / richCrm.in_service : null,
            asSource: localText(idioma, "em atendimento", "en atención"),
            asTarget: localText(idioma, "foram atendidos", "fueron atendidos"),
            costLabel: localText(idioma, "por atendimento", "por atención"),
          },
          {
            key: "crm-won",
            label: localText(idioma, "Vendas fechadas", "Ventas cerradas"),
            value: richCrm.closed_won,
            rate: richCrm.in_service > 0 ? (richCrm.closed_won / richCrm.in_service) * 100 : null,
            cost: richCrm.closed_won > 0 ? group.summary.spend / richCrm.closed_won : null,
            asSource: localText(idioma, "que fecharam", "que cerraron"),
            asTarget: localText(idioma, "fecharam venda", "cerraron venta"),
            costLabel: localText(idioma, "por venda", "por venta"),
          },
        ];
        const costPerClosed =
          richCrm.closed_won > 0 ? group.summary.spend / richCrm.closed_won : null;
        const spendTrend = group.daily.map((day) => day.spend_meta + day.spend_google);
        const conversionTrend = group.daily.map((day) => day.conversions);
        const revenueTrend = group.daily.map((day) => day.revenue);
        const costTrend = group.daily.map((day) =>
          day.conversions > 0 ? (day.spend_meta + day.spend_google) / day.conversions : 0,
        );
        const previous = group.comparison;
        const investmentHero = {
          key: "spend" as const,
          label: t("Investimento"),
          hint: t("Meta + Google"),
          value: group.summary.spend,
          previous: previous?.spend,
          sparkline: spendTrend,
          formatter: (value: number) => money(value, group.currency),
          betterWhen: "up" as const,
        };
        const closedHero = {
          key: "conversions" as const,
          label: localText(idioma, "Fechadas no CRM", "Cerradas en el CRM"),
          hint: t("vendas fechadas no CRM"),
          value: richCrm.closed_won,
          previous: previousRichCrm?.closed_won,
          sparkline: conversionTrend,
          formatter: number,
          betterWhen: "up" as const,
        };
        const legacyHeroMetrics =
          report.model === "ecommerce"
            ? [
                {
                  key: "revenue" as const,
                  label: t("Faturamento"),
                  hint: t("receita rastreada pelos anúncios"),
                  value: group.summary.revenue,
                  previous: previous?.revenue,
                  sparkline: revenueTrend,
                  formatter: (value: number) => money(value, group.currency),
                  betterWhen: "up" as const,
                },
                {
                  key: "revenue" as const,
                  label: "ROAS",
                  hint: t("receita ÷ investimento"),
                  value: group.summary.roas ?? 0,
                  previous: previous?.roas,
                  sparkline: revenueTrend,
                  formatter: (value: number) => `${number(value)}x`,
                  betterWhen: "up" as const,
                },
                {
                  key: "conversions" as const,
                  label: localText(idioma, "Vendas", "Ventas"),
                  hint: t("compras pelos anúncios"),
                  value: group.summary.purchases || group.summary.conversions,
                  previous: previous?.purchases || previous?.conversions,
                  sparkline: conversionTrend,
                  formatter: number,
                  betterWhen: "up" as const,
                },
                closedHero,
              ]
            : report.model === "messages"
              ? [
                  investmentHero,
                  {
                    key: "conversions" as const,
                    label: localText(idioma, "Conversas iniciadas", "Conversaciones iniciadas"),
                    hint: t("conversas que começaram pelo anúncio"),
                    value: group.summary.messaging_conversations,
                    previous: previous?.messaging_conversations,
                    sparkline: conversionTrend,
                    formatter: number,
                    betterWhen: "up" as const,
                  },
                  {
                    key: "spend" as const,
                    label: localText(idioma, "Custo por conversa", "Costo por conversación"),
                    hint: t("custo por conversa"),
                    value: group.summary.cost_per_messaging_conversation ?? 0,
                    previous: previous?.cost_per_messaging_conversation,
                    sparkline: costTrend,
                    formatter: (value: number) => money(value, group.currency),
                    betterWhen: "down" as const,
                  },
                  closedHero,
                ]
              : [
                  investmentHero,
                  // Ordem pedida pelo dono (21/09/2026): investimento, alcance, leads, custo
                  // por lead. Vendas fechadas seguem no funil logo abaixo.
                  {
                    key: "spend" as const,
                    label: localText(idioma, "Alcance", "Alcance"),
                    hint: t("pessoas únicas que viram"),
                    value: group.summary.reach ?? 0,
                    previous: previous?.reach,
                    // A resposta não traz alcance por dia (alcance não soma dia a dia),
                    // então segue sem minigráfico: não se inventa série.
                    sparkline: [],
                    formatter: number,
                    betterWhen: "up" as const,
                  },
                  {
                    key: "conversions" as const,
                    label: t("Leads"),
                    hint: t("pessoas que deixaram contato"),
                    value: group.summary.leads,
                    previous: previous?.leads,
                    sparkline: conversionTrend,
                    formatter: number,
                    betterWhen: "up" as const,
                  },
                  {
                    key: "spend" as const,
                    label: localText(idioma, "Custo por lead", "Costo por lead"),
                    hint: t("custo por lead"),
                    value: group.summary.cost_per_lead ?? 0,
                    previous: previous?.cost_per_lead,
                    sparkline: costTrend,
                    formatter: (value: number) => money(value, group.currency),
                    betterWhen: "down" as const,
                  },
                ];
        const priorityMetrics =
          visiblePriorityMetrics ?? report.priority_metrics ?? defaultPriorityMetrics(report.model);
        const configuredHeroMetrics = (priorityMetrics ?? []).map((metric) => {
          const meta = PRIORITY_METRIC_META[metric];
          const value = priorityMetricValue(metric, group.summary, richCrm.closed_won) ?? 0;
          let previousValue: number | null | undefined;
          if (metric === "crm_closed_won") {
            previousValue = previousRichCrm?.closed_won;
          } else if (metric === "cost_per_crm_closed_won") {
            previousValue =
              previous && previousRichCrm
                ? priorityMetricValue(metric, previous, previousRichCrm.closed_won)
                : undefined;
          } else {
            previousValue = previous
              ? priorityMetricValue(metric, previous, previousRichCrm?.closed_won ?? 0)
              : undefined;
          }
          const sparkline = (() => {
            if (metric === "spend") return spendTrend;
            if (metric === "revenue") return revenueTrend;
            if (metric === "roas") {
              return group.daily.map((day) => {
                const spend = day.spend_meta + day.spend_google;
                return spend > 0 ? day.revenue / spend : 0;
              });
            }
            if (
              (metric === "leads" && report.model === "leads") ||
              (metric === "messaging_conversations" && report.model === "messages") ||
              (metric === "purchases" && report.model === "ecommerce")
            ) {
              return conversionTrend;
            }
            if (
              (metric === "cost_per_lead" && report.model === "leads") ||
              (metric === "cost_per_messaging_conversation" && report.model === "messages") ||
              (metric === "cost_per_purchase" && report.model === "ecommerce")
            ) {
              return costTrend;
            }
            return [];
          })();
          const formatter = (metricValue: number) => {
            if (meta.format === "money") return money(metricValue, group.currency);
            if (meta.format === "percent") return percent(metricValue, "0%");
            if (meta.format === "ratio") return `${number(metricValue)}x`;
            return number(metricValue);
          };
          return {
            key: metric,
            label: t(meta.label),
            hint: t(meta.hint),
            value,
            previous: previousValue,
            sparkline,
            formatter,
            betterWhen: meta.betterWhen,
          };
        });
        const heroMetrics = priorityMetrics ? configuredHeroMetrics : legacyHeroMetrics;
        // Retenção de vídeo, fórmulas do painel antigo (`generate_tratorval.py`,
        // linhas 783 e 804 a 808): Hook = reproduções de 3s ÷ impressões,
        // Body = quem passou de 75% ÷ impressões, e as barras 50/75/95 têm a
        // largura relativa à de 25%, que é sempre 100%. `video_views` aqui é o
        // `actions_video_view` do Windsor (3s), o mesmo campo do painel antigo.
        const videoHook =
          meta && meta.impressions > 0 ? (meta.video_views / meta.impressions) * 100 : null;
        const videoBody =
          meta && meta.impressions > 0 ? (meta.video_p75 / meta.impressions) * 100 : null;
        const videoBars = meta
          ? [
              { label: "View 25%", value: meta.video_p25, tone: "bg-success" },
              { label: "View 50%", value: meta.video_p50, tone: "bg-info" },
              { label: "View 75%", value: meta.video_p75, tone: "bg-warning" },
              { label: "View 95%", value: meta.video_p95, tone: "bg-error" },
            ].map((bar) => ({
              ...bar,
              width: meta.video_p25 > 0 ? Math.min(100, (bar.value / meta.video_p25) * 100) : 0,
            }))
          : [];

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
                <PriorityMetricSelector
                  key={`${report.organization_key}:${(
                    report.priority_metrics ?? defaultPriorityMetrics(report.model)
                  ).join("|")}`}
                  model={report.model}
                  organizationKey={report.organization_key}
                  viewerKey={report.viewer_key}
                  initial={report.priority_metrics ?? defaultPriorityMetrics(report.model)}
                  canManage={report.can_manage_defaults}
                  onSaved={(priorityMetrics) => {
                    setActiveMetric(priorityMetrics[0] ?? "spend");
                    setVisiblePriorityMetrics(priorityMetrics);
                  }}
                />
              </div>
              <div
                className={`relative grid gap-3 sm:grid-cols-2 ${
                  heroMetrics.length <= 4
                    ? "xl:grid-cols-4"
                    : heroMetrics.length === 5
                      ? "xl:grid-cols-5"
                      : "xl:grid-cols-6"
                }`}
              >
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
                  value: number(richCrm.closed_won),
                  emphasis: true,
                },
                {
                  label: localText(idioma, "Custo por venda fechada", "Costo por venta cerrada"),
                  value:
                    costPerClosed == null ? t("sem dado") : money(costPerClosed, group.currency),
                  emphasis: true,
                },
              ]}
            />

            <TrafficTimeline daily={group.daily} currency={group.currency} idioma={idioma} />

            {meta && (
              <details
                open
                className="group rounded-2xl border border-[#1877F2]/30 bg-card shadow-sm"
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
                      value={meta.reach == null ? t("sem dado") : number(meta.reach)}
                      hint={t("pessoas únicas que viram")}
                    />
                    <Kpi
                      label={t("Impressões")}
                      value={number(meta.impressions)}
                      hint={t("exibições totais")}
                    />
                    <Kpi
                      label={t("Frequência")}
                      value={meta.frequency == null ? t("sem dado") : `${number(meta.frequency)}x`}
                      hint={t("média por pessoa")}
                    />
                    <Kpi
                      label="CPM"
                      value={meta.cpm == null ? t("sem dado") : money(meta.cpm, group.currency)}
                      hint={t("custo por 1.000 exibições")}
                    />
                    <Kpi
                      label="CTR"
                      value={percent(meta.ctr, t("sem dado"))}
                      hint={t("taxa de clique")}
                    />
                    <Kpi
                      label={t("Cliques no link")}
                      value={number(meta.link_clicks)}
                      hint={t("visitas ao site")}
                    />
                    <Kpi
                      label="CPC"
                      value={meta.cpc == null ? t("sem dado") : money(meta.cpc, group.currency)}
                      hint={t("custo por clique")}
                    />
                    <Kpi
                      label={conversionLabel}
                      value={number(meta.conversions)}
                      hint={
                        report.model === "ecommerce"
                          ? t("compras pelos anúncios")
                          : report.model === "messages"
                            ? t("conversas que começaram pelo anúncio")
                            : t("pessoas que deixaram contato")
                      }
                    />
                    <Kpi
                      label={t("Custo por conversão")}
                      value={
                        meta.cost_per_conversion == null
                          ? t("sem dado")
                          : money(meta.cost_per_conversion, group.currency)
                      }
                      hint={
                        report.model === "leads" ? t("custo por lead") : t("custo por resultado")
                      }
                    />
                    <Kpi
                      label={t("Investimento")}
                      value={money(meta.spend, group.currency)}
                      hint={t("total no período")}
                    />
                  </div>
                  {meta.video_views > 0 && (
                    <div className="rounded-xl border bg-muted/20 p-4">
                      <h4 className="font-semibold">{t("Retenção de vídeo")}</h4>
                      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg border bg-card p-3">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                                Hook
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {t("3s ÷ impressões")}
                              </span>
                            </div>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-success-fg">
                              {percent(videoHook, "0%")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("pararam para assistir")}
                            </p>
                          </div>
                          <div className="rounded-lg border bg-card p-3">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                                Body
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {t("75% ÷ impressões")}
                              </span>
                            </div>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-success-fg">
                              {percent(videoBody, "0%")}
                            </p>
                            <p className="text-xs text-muted-foreground">{t("viram até o fim")}</p>
                          </div>
                        </div>
                        <ul className="space-y-2.5" aria-label={t("Retenção de vídeo")}>
                          {videoBars.map((bar) => (
                            <li key={bar.label}>
                              <div className="mb-1 flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{bar.label}</span>
                                <span className="font-semibold tabular-nums">
                                  {number(bar.value)}
                                </span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={`h-full rounded-full ${bar.tone} transition-[width] motion-reduce:transition-none`}
                                  style={{ width: `${bar.width}%` }}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  <CampaignTable
                    key={`${activeOrg?.orgId ?? report.organization_key}:${window.from}:${window.to}:meta_ads`}
                    campaigns={metaCampaigns}
                    currency={group.currency}
                    platform="meta_ads"
                    organizationKey={report.organization_key}
                    viewerKey={report.viewer_key}
                    labels={campaignLabels}
                    columns={metaColumns}
                    idioma={idioma}
                    priorityMetric={activeMetric}
                    threshold={metaThreshold}
                    columnMenu={
                      <ColumnPresetMenu
                        organizationKey={report.organization_key}
                        viewerKey={report.viewer_key}
                        model={report.model}
                        platform="meta_ads"
                        initialPresets={presetsForPlatform(report, "meta_ads")}
                        defaultPresetId={defaultPresetForPlatform(report, "meta_ads")}
                        defaultColumns={columnsForPlatform(report, "meta_ads")}
                        availableColumns={campaignMetricColumnsForPlatform("meta_ads")}
                        canManage={report.can_manage_defaults}
                        columnLabel={columnLabel}
                        onColumnsChange={(columns) =>
                          setSelectedColumns((current) => ({ ...current, meta_ads: columns }))
                        }
                      />
                    }
                  />
                </div>
              </details>
            )}

            {google && (
              <details open className="group rounded-2xl border bg-card shadow-sm">
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
                    <Kpi
                      label={t("Impressões")}
                      value={number(google.impressions)}
                      hint={t("vezes exibido")}
                    />
                    <Kpi
                      label={t("Cliques no link")}
                      value={number(google.clicks)}
                      hint={t("visitas ao site")}
                    />
                    <Kpi
                      label="CTR"
                      value={percent(google.ctr, t("sem dado"))}
                      hint={t("taxa de clique")}
                    />
                    <Kpi
                      label="CPC"
                      value={google.cpc == null ? t("sem dado") : money(google.cpc, group.currency)}
                      hint={t("custo por clique")}
                    />
                    <Kpi
                      label={t("Investimento")}
                      value={money(google.spend, group.currency)}
                      hint={t("total no período")}
                    />
                    <Kpi
                      label={conversionLabel}
                      value={number(google.conversions)}
                      hint={
                        report.model === "ecommerce"
                          ? t("compras pelos anúncios")
                          : t("resultados pelos anúncios")
                      }
                    />
                    <Kpi
                      label="CPA"
                      value={
                        google.cost_per_conversion == null
                          ? t("sem dado")
                          : money(google.cost_per_conversion, group.currency)
                      }
                      hint={t("custo por resultado")}
                    />
                    <Kpi
                      label={t("Taxa de conv. site")}
                      value={percent(google.conversion_rate, t("sem dado"))}
                      hint={t("cliques que viraram resultado")}
                    />
                  </div>
                  <CampaignTable
                    key={`${activeOrg?.orgId ?? report.organization_key}:${window.from}:${window.to}:google_ads`}
                    campaigns={googleCampaigns}
                    currency={group.currency}
                    platform="google_ads"
                    organizationKey={report.organization_key}
                    viewerKey={report.viewer_key}
                    labels={campaignLabels}
                    columns={googleColumns}
                    idioma={idioma}
                    priorityMetric={activeMetric}
                    threshold={googleThreshold}
                    columnMenu={
                      <ColumnPresetMenu
                        organizationKey={report.organization_key}
                        viewerKey={report.viewer_key}
                        model={report.model}
                        platform="google_ads"
                        initialPresets={presetsForPlatform(report, "google_ads")}
                        defaultPresetId={defaultPresetForPlatform(report, "google_ads")}
                        defaultColumns={columnsForPlatform(report, "google_ads")}
                        availableColumns={campaignMetricColumnsForPlatform("google_ads")}
                        canManage={report.can_manage_defaults}
                        columnLabel={columnLabel}
                        onColumnsChange={(columns) =>
                          setSelectedColumns((current) => ({ ...current, google_ads: columns }))
                        }
                      />
                    }
                  />
                  {googleThreshold &&
                    googleCampaigns.filter((campaign) => {
                      const cost = costPerResult(campaign);
                      return cost != null && cost > googleThreshold.acceptable_until;
                    }).length > 0 && (
                      <p className="text-sm font-medium text-destructive">
                        {t("Atenção")}:{" "}
                        {
                          googleCampaigns.filter((campaign) => {
                            const cost = costPerResult(campaign);
                            return cost != null && cost > googleThreshold.acceptable_until;
                          }).length
                        }{" "}
                        {t("campanhas com custo acima do aceitável")}
                      </p>
                    )}
                </div>
              </details>
            )}

            <CreativePerformance
              group={group}
              model={report.model}
              threshold={metaThreshold}
              idioma={idioma}
              organizationKey={report.organization_key}
              viewerKey={report.viewer_key}
              priorityMetric={activeMetric}
            />
          </section>
        );
      })}
    </div>
  );
}
