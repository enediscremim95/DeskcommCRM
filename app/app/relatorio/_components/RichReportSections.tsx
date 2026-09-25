"use client";

import { useMemo, useState } from "react";
import { DragScroll } from "@/components/ui/drag-scroll";
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
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { buildFunnelReadings, type TrafficRichCrmInsights } from "@/lib/windsor/traffic-insights";
import type { PriorityMetricColumn } from "@/lib/windsor/priority-metrics";
import { CostSignal, type CostThreshold } from "./CostThresholds";
import { useColunasAjustaveis, type ConfiguracaoColunaAjustavel } from "./colunas-ajustaveis";

type Platform = "meta_ads" | "google_ads";
type Model = "leads" | "messages" | "ecommerce";
type CreativeResizableColumnKey =
  | "creative"
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "conversions"
  | "cost_per_conversion"
  | "conversion_rate"
  | "revenue"
  | "roas";

const CREATIVE_RESIZABLE_COLUMNS: Record<CreativeResizableColumnKey, ConfiguracaoColunaAjustavel> =
  {
    creative: { larguraMinima: 180, larguraPadrao: 280 },
    spend: { larguraMinima: 104, larguraPadrao: 144 },
    impressions: { larguraMinima: 104, larguraPadrao: 144 },
    clicks: { larguraMinima: 104, larguraPadrao: 144 },
    ctr: { larguraMinima: 104, larguraPadrao: 144 },
    conversions: { larguraMinima: 104, larguraPadrao: 144 },
    cost_per_conversion: { larguraMinima: 104, larguraPadrao: 144 },
    conversion_rate: { larguraMinima: 104, larguraPadrao: 144 },
    revenue: { larguraMinima: 104, larguraPadrao: 144 },
    roas: { larguraMinima: 104, larguraPadrao: 144 },
  };

function creativePriorityColumn(
  metric: PriorityMetricColumn | "conversions",
): CreativeResizableColumnKey | null {
  if (
    metric === "leads" ||
    metric === "purchases" ||
    metric === "messaging_conversations" ||
    metric === "conversions"
  ) {
    return "conversions";
  }
  if (
    metric === "cost_per_lead" ||
    metric === "cost_per_purchase" ||
    metric === "cost_per_messaging_conversation"
  ) {
    return "cost_per_conversion";
  }
  if (metric === "link_clicks") return "clicks";
  if (metric === "spend" || metric === "impressions" || metric === "ctr") return metric;
  if (metric === "revenue" || metric === "roas") return metric;
  return null;
}

interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  conversions: number;
  leads: number;
  purchases: number;
  revenue: number;
  cost_per_conversion: number | null;
  cost_per_lead: number | null;
  ctr: number | null;
  roas: number | null;
}

interface Ad extends Metrics {
  name: string;
  thumbnail_url: string | null;
}

interface Campaign extends Metrics {
  name: string;
  platform: Platform;
  adsets: Array<Metrics & { name: string; ads: Ad[] }>;
}

export interface RichCurrencyGroup {
  currency: string;
  summary: Metrics;
  daily: Array<{
    date: string;
    spend_meta: number;
    spend_google: number;
    conversions: number;
    revenue: number;
  }>;
  platforms: Array<Metrics & { platform: Platform }>;
  campaigns: Campaign[];
}

export type Granularity = "daily" | "weekly" | "monthly";

function local(idioma: string, pt: string, es: string) {
  return idioma === "es" ? es : pt;
}

function money(value: number, currency: string, idioma: string) {
  return new Intl.NumberFormat(idioma === "es" ? "es-ES" : "pt-BR", {
    style: "currency",
    currency,
  }).format(value);
}

function number(value: number, idioma: string) {
  return new Intl.NumberFormat(idioma === "es" ? "es-ES" : "pt-BR", {
    maximumFractionDigits: 1,
  }).format(value);
}

function percent(value: number | null, idioma: string) {
  return value == null ? "" : `${number(value, idioma)}%`;
}

function weekKey(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

export function aggregateTimeline(daily: RichCurrencyGroup["daily"], granularity: Granularity) {
  const buckets = new Map<string, RichCurrencyGroup["daily"][number]>();
  for (const row of daily) {
    const key =
      granularity === "daily"
        ? row.date
        : granularity === "weekly"
          ? weekKey(row.date)
          : row.date.slice(0, 7);
    const current = buckets.get(key) ?? {
      date: key,
      spend_meta: 0,
      spend_google: 0,
      conversions: 0,
      revenue: 0,
    };
    current.spend_meta += row.spend_meta;
    current.spend_google += row.spend_google;
    current.conversions += row.conversions;
    current.revenue += row.revenue;
    buckets.set(key, current);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function flattenCreatives(group: RichCurrencyGroup) {
  return group.campaigns
    .filter((campaign) => campaign.platform === "meta_ads")
    .flatMap((campaign) =>
      campaign.adsets.flatMap((adset) =>
        adset.ads.map((ad) => ({ ...ad, campaign: campaign.name, adset: adset.name })),
      ),
    );
}

export function buildMonthlyRows(group: RichCurrencyGroup, crm: TrafficRichCrmInsights) {
  const months = new Map<
    string,
    {
      month: string;
      spend: number;
      platform_leads: number;
      crm_leads: number;
      won: number;
      revenue: number;
    }
  >();
  for (const day of group.daily) {
    const month = day.date.slice(0, 7);
    const row = months.get(month) ?? {
      month,
      spend: 0,
      platform_leads: 0,
      crm_leads: 0,
      won: 0,
      revenue: 0,
    };
    row.spend += day.spend_meta + day.spend_google;
    row.platform_leads += day.conversions;
    row.revenue += day.revenue;
    months.set(month, row);
  }
  const sales = new Map(crm.sales_timeline.map((row) => [row.period, row.count]));
  const crmLeads = new Map(crm.leads_timeline.map((row) => [row.period, row.count]));
  for (const row of months.values()) {
    row.crm_leads = crmLeads.get(row.month) ?? 0;
    row.won = sales.get(row.month) ?? 0;
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function TrafficTimeline({
  daily,
  currency,
  idioma,
}: {
  daily: RichCurrencyGroup["daily"];
  currency: string;
  idioma: string;
}) {
  const t = useT();
  const days = daily.length;
  const [selectedGranularity, setSelectedGranularity] = useState<Granularity>(
    days > 120 ? "monthly" : "daily",
  );
  const granularity =
    days > 120 && selectedGranularity === "daily" ? "monthly" : selectedGranularity;
  const data = useMemo(() => aggregateTimeline(daily, granularity), [daily, granularity]);
  return (
    <details open className="group overflow-hidden rounded-2xl border bg-card shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5">
        <h3 className="text-lg font-semibold">{t("Investimento e resultado no tempo")}</h3>
        <div className="flex gap-1" onClick={(event) => event.preventDefault()}>
          {(["daily", "weekly", "monthly"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={granularity === value ? "secondary" : "ghost"}
              disabled={value === "daily" && days > 120}
              onClick={() => setSelectedGranularity(value)}
            >
              {value === "daily" ? t("Diário") : value === "weekly" ? t("Semanal") : t("Mensal")}
            </Button>
          ))}
        </div>
      </summary>
      <div className="h-72 p-3 sm:h-80 sm:p-5">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis yAxisId="spend" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis
              yAxisId="conversion"
              orientation="right"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip
              formatter={(value, name) => [
                name === t("Conversões")
                  ? number(Number(value), idioma)
                  : money(Number(value), currency, idioma),
                name,
              ]}
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
              }}
            />
            <Area
              yAxisId="spend"
              type="monotone"
              dataKey="spend_meta"
              stackId="spend"
              fill="#1877F2"
              stroke="#1877F2"
              fillOpacity={0.45}
              name="Meta"
            />
            <Bar
              yAxisId="spend"
              dataKey="spend_google"
              stackId="spend"
              fill="#4285F4"
              name="Google"
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="conversion"
              type="monotone"
              dataKey="conversions"
              stroke="var(--primary)"
              strokeWidth={3}
              dot={false}
              name={t("Conversões")}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </details>
  );
}

export function FunnelAndSituation({
  stages,
  previousStages,
  crm,
  idioma,
}: {
  stages: Array<{ label: string; value: number }>;
  previousStages: Array<{ label: string; value: number }>;
  crm: TrafficRichCrmInsights;
  idioma: string;
}) {
  const t = useT();
  const readings = buildFunnelReadings(stages, previousStages);
  const total = crm.closed_won + crm.in_service + crm.closed_lost;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {readings.length > 0 && (
        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold">{t("Leitura do funil")}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {readings.map((reading) => (
              <li key={reading.kind}>
                {reading.kind === "lowest"
                  ? t("Menor passagem")
                  : reading.kind === "drop"
                    ? t("Maior queda contra o período anterior")
                    : t("Maior melhora")}
                {`: ${reading.from} → ${reading.to} (${reading.kind === "lowest" ? "" : reading.value > 0 ? "+" : ""}${number(reading.value, idioma)}${reading.kind === "lowest" ? "%" : " p.p."})`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {total > 0 && (
        <section className="rounded-2xl border bg-card p-5">
          <h3 className="font-semibold">{t("Situação dos leads")}</h3>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
            <div className="bg-success" style={{ width: `${(crm.closed_won / total) * 100}%` }} />
            <div className="bg-info" style={{ width: `${(crm.in_service / total) * 100}%` }} />
            <div
              className="bg-destructive"
              style={{ width: `${(crm.closed_lost / total) * 100}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span>
              {local(idioma, "Fechados", "Cerrados")} {number(crm.closed_won, idioma)}
            </span>
            <span>
              {t("Em atendimento")} {number(crm.in_service, idioma)}
            </span>
            <span>
              {local(idioma, "Perdidos", "Perdidos")} {number(crm.closed_lost, idioma)}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

export function PlatformComparison({
  group,
  crm,
  idioma,
}: {
  group: RichCurrencyGroup;
  crm: TrafficRichCrmInsights;
  idioma: string;
}) {
  const t = useT();
  const meta = group.platforms.find((row) => row.platform === "meta_ads");
  const google = group.platforms.find((row) => row.platform === "google_ads");
  if (!meta || !google || meta.spend <= 0 || google.spend <= 0) return null;
  const rows = [meta, google];
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <h3 className="px-5 py-4 text-lg font-semibold">Meta × Google</h3>
      <DragScroll className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="border-y bg-muted/35 text-left">
            <tr>
              <th className="px-4 py-3">{t("Origem")}</th>
              <th className="px-4 py-3 text-right">{t("Investimento")}</th>
              <th className="px-4 py-3 text-right">{t("Impressões")}</th>
              <th className="px-4 py-3 text-right">{t("Cliques")}</th>
              <th className="px-4 py-3 text-right">{t("Leads/Conversões")}</th>
              <th className="px-4 py-3 text-right">{t("Custo por lead")}</th>
              <th className="px-4 py-3 text-right">{t("Leads no CRM")}</th>
              <th className="px-4 py-3 text-right">{t("Vendas por origem")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const key = row.platform;
              const leads = crm.leads_by_origin[key];
              const won = crm.won_by_origin[key];
              return (
                <tr key={key}>
                  <td className="px-4 py-3 font-medium">
                    {key === "meta_ads" ? "Meta Ads" : "Google Ads"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {money(row.spend, group.currency, idioma)}
                  </td>
                  <td className="px-4 py-3 text-right">{number(row.impressions, idioma)}</td>
                  <td className="px-4 py-3 text-right">{number(row.clicks, idioma)}</td>
                  <td className="px-4 py-3 text-right">{number(row.conversions, idioma)}</td>
                  <td className="px-4 py-3 text-right">
                    {row.cost_per_conversion == null
                      ? ""
                      : money(row.cost_per_conversion, group.currency, idioma)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {leads == null ? "" : number(leads, idioma)}
                  </td>
                  <td className="px-4 py-3 text-right">{won == null ? "" : number(won, idioma)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DragScroll>
    </section>
  );
}

export function CreativePerformance({
  group,
  model,
  threshold,
  idioma,
  organizationKey,
  priorityMetric,
}: {
  group: RichCurrencyGroup;
  model: Model;
  threshold?: CostThreshold;
  idioma: string;
  organizationKey: string;
  priorityMetric: PriorityMetricColumn | "conversions";
}) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<"conversions" | "spend" | "cost">("conversions");
  const { alcaDaColuna, estiloDaColuna } = useColunasAjustaveis({
    storageKey: `traffic-report-column-widths:${organizationKey}:meta-ads-creatives`,
    colunas: CREATIVE_RESIZABLE_COLUMNS,
    traduzir: t,
  });
  const creatives = flattenCreatives(group);
  if (creatives.length === 0) return null;
  const conversionLabel = model === "ecommerce" ? t("Compras") : t("Leads");
  const compactCostLabel =
    model === "ecommerce"
      ? local(idioma, "Custo/compra", "Costo/compra")
      : local(idioma, "Custo/lead", "Costo/lead");
  // "Taxa de conv. site" e não "Cliques para leads": o número é a fatia de quem
  // clicou e virou resultado na página, então o nome que o gestor usa no dia a
  // dia é taxa de conversão do site.
  const rateLabel = local(idioma, "Taxa de conv. site", "Tasa de conv. sitio");
  const costHighlightLabel =
    model === "ecommerce"
      ? local(idioma, "Menor custo por compra", "Menor costo por compra")
      : t("Menor custo por lead");
  const rateHighlightLabel =
    model === "ecommerce"
      ? local(idioma, "Melhor cliques para compras", "Mejor clics a compras")
      : t("Melhor cliques para leads");
  const maxConversions = Math.max(...creatives.map((row) => row.conversions), 1);
  const sorted = [...creatives].sort((a, b) => {
    if (sort === "spend") return b.spend - a.spend;
    if (sort === "cost")
      return (a.cost_per_conversion ?? Infinity) - (b.cost_per_conversion ?? Infinity);
    return b.conversions - a.conversions;
  });
  const bestVolume = [...creatives].sort((a, b) => b.conversions - a.conversions)[0];
  const bestCost = creatives
    .filter((row) => row.conversions >= 20 && row.cost_per_conversion != null)
    .sort((a, b) => (a.cost_per_conversion ?? Infinity) - (b.cost_per_conversion ?? Infinity))[0];
  const bestRate = creatives
    .filter((row) => row.clicks >= 40)
    .sort(
      (a, b) =>
        (b.clicks > 0 ? b.conversions / b.clicks : 0) -
        (a.clicks > 0 ? a.conversions / a.clicks : 0),
    )[0];
  const priorityColumn = creativePriorityColumn(priorityMetric);
  const header = (
    column: CreativeResizableColumnKey,
    label: string,
    align: "left" | "right" = "right",
  ) => {
    const priority = column === priorityColumn;
    return (
      <th
        key={column}
        scope="col"
        className={`relative overflow-hidden px-3 py-2 whitespace-nowrap ${align === "left" ? "text-left" : "text-right"} ${priority ? "bg-primary/[0.10] font-semibold text-foreground" : ""}`}
        style={estiloDaColuna(column)}
        data-priority={priority || undefined}
      >
        <span className="block truncate" title={label}>
          {label}
        </span>
        {alcaDaColuna(column, label)}
      </th>
    );
  };
  const cellClass = (column: CreativeResizableColumnKey, align = "text-right") =>
    `overflow-hidden px-3 py-2 whitespace-nowrap ${align} ${column === priorityColumn ? "bg-primary/[0.06] text-base font-semibold" : ""}`;
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <h3 className="text-lg font-semibold">{t("Criativos que mais trazem resultado")}</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {[
          [
            model === "ecommerce" ? t("Mais vendas") : t("Mais leads"),
            bestVolume,
            bestVolume ? number(bestVolume.conversions, idioma) : "",
          ],
          [
            costHighlightLabel,
            bestCost,
            bestCost?.cost_per_conversion == null
              ? t("Sem dados suficientes")
              : money(bestCost.cost_per_conversion, group.currency, idioma),
          ],
          [
            rateHighlightLabel,
            bestRate,
            bestRate
              ? percent((bestRate.conversions / bestRate.clicks) * 100, idioma)
              : t("Sem dados suficientes"),
          ],
        ]
          .filter(([, creative]) => creative && typeof creative === "object")
          .map(([label, creative, value]) => (
            <div key={String(label)} className="rounded-xl border p-4">
              <p className="text-sm text-muted-foreground">{label as string}</p>
              <p className="mt-1 font-semibold">
                {creative && typeof creative === "object"
                  ? creative.name
                  : t("Sem dados suficientes")}
              </p>
              <p className="text-sm">{value as string}</p>
            </div>
          ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t("Anúncios Meta")}</span>
        <select
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="conversions">{conversionLabel}</option>
          <option value="cost">{local(idioma, "Menor custo", "Menor costo")}</option>
          <option value="spend">{t("Investimento")}</option>
        </select>
      </div>
      <DragScroll className="mt-2 overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="border-y bg-muted/35">
            <tr>
              {header("creative", t("Criativo"), "left")}
              {header("spend", t("Investimento"))}
              {header("impressions", t("Impressões"))}
              {header("clicks", t("Cliques"))}
              {header("ctr", "CTR")}
              {header("conversions", conversionLabel)}
              {header("cost_per_conversion", compactCostLabel)}
              {header("conversion_rate", rateLabel)}
              {model === "ecommerce" && (
                <>
                  {header("revenue", t("Receita"))}
                  {header("roas", "ROAS")}
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.slice(0, showAll ? sorted.length : 10).map((row) => (
              <tr key={`${row.campaign}:${row.adset}:${row.name}`}>
                <td
                  className={cellClass("creative", "text-left")}
                  style={estiloDaColuna("creative")}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {row.thumbnail_url ? (
                      <span
                        className="size-10 shrink-0 rounded-md bg-cover bg-center"
                        style={{ backgroundImage: `url(${row.thumbnail_url})` }}
                      />
                    ) : (
                      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-xs font-bold">
                        {row.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium" title={row.name}>
                        {row.name}
                      </span>
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={`${row.campaign} › ${row.adset}`}
                      >
                        {row.campaign} › {row.adset}
                      </span>
                    </span>
                  </div>
                </td>
                <td
                  className={cellClass("spend")}
                  style={estiloDaColuna("spend")}
                  data-priority={priorityColumn === "spend" || undefined}
                >
                  {money(row.spend, group.currency, idioma)}
                </td>
                <td
                  className={cellClass("impressions")}
                  style={estiloDaColuna("impressions")}
                  data-priority={priorityColumn === "impressions" || undefined}
                >
                  {number(row.impressions, idioma)}
                </td>
                <td
                  className={cellClass("clicks")}
                  style={estiloDaColuna("clicks")}
                  data-priority={priorityColumn === "clicks" || undefined}
                >
                  {number(row.clicks, idioma)}
                </td>
                <td
                  className={cellClass("ctr")}
                  style={estiloDaColuna("ctr")}
                  data-priority={priorityColumn === "ctr" || undefined}
                >
                  {percent(row.ctr, idioma)}
                </td>
                <td
                  className={cellClass("conversions")}
                  style={estiloDaColuna("conversions")}
                  data-priority={priorityColumn === "conversions" || undefined}
                >
                  <span className="relative ml-auto block min-w-16 overflow-hidden rounded-md bg-muted/60 py-0.5">
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 bg-primary/20"
                      style={{ width: `${(row.conversions / maxConversions) * 100}%` }}
                    />
                    <span className="relative px-2 font-semibold">
                      {number(row.conversions, idioma)}
                    </span>
                  </span>
                </td>
                <td
                  className={cellClass("cost_per_conversion")}
                  style={estiloDaColuna("cost_per_conversion")}
                  data-priority={priorityColumn === "cost_per_conversion" || undefined}
                >
                  <CostSignal value={row.cost_per_conversion} threshold={threshold}>
                    {row.cost_per_conversion == null
                      ? ""
                      : money(row.cost_per_conversion, group.currency, idioma)}
                  </CostSignal>
                </td>
                <td
                  className={cellClass("conversion_rate")}
                  style={estiloDaColuna("conversion_rate")}
                  data-priority={priorityColumn === "conversion_rate" || undefined}
                >
                  {row.clicks > 0 ? percent((row.conversions / row.clicks) * 100, idioma) : ""}
                </td>
                {model === "ecommerce" && (
                  <>
                    <td
                      className={cellClass("revenue")}
                      style={estiloDaColuna("revenue")}
                      data-priority={priorityColumn === "revenue" || undefined}
                    >
                      {money(row.revenue, group.currency, idioma)}
                    </td>
                    <td
                      className={cellClass("roas")}
                      style={estiloDaColuna("roas")}
                      data-priority={priorityColumn === "roas" || undefined}
                    >
                      {row.roas == null ? "" : `${number(row.roas, idioma)}x`}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </DragScroll>
      {sorted.length > 10 && (
        <Button
          className="mt-3"
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? t("Ver menos") : t("Ver todos")}
        </Button>
      )}
    </section>
  );
}

export function CrmInsights({
  crm,
  currency,
  idioma,
}: {
  crm: TrafficRichCrmInsights;
  currency: string;
  idioma: string;
}) {
  const t = useT();
  const totalLost = crm.loss_reasons.reduce((sum, row) => sum + row.count, 0);
  const value = crm.sales_values.find((row) => row.currency === currency);
  if (crm.leads_entered === 0) return null;
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <h3 className="text-lg font-semibold">{t("Leads no CRM: etapas e perdas")}</h3>
      <DragScroll className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="border-y bg-muted/35">
            <tr>
              {[
                t("Etapa"),
                t("Volume"),
                t("Da etapa anterior"),
                t("Desde o topo"),
                t("Período anterior"),
                t("Variação"),
              ].map((label) => (
                <th key={label} className="px-3 py-2 text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {crm.stage_conversion.map((row) => (
              <tr key={row.name}>
                <td className="px-3 py-2 font-medium">
                  {row.name}
                  {row.is_won && (
                    <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success-fg">
                      {t("venda")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{number(row.volume, idioma)}</td>
                <td className="px-3 py-2">{percent(row.from_previous, idioma)}</td>
                <td className="px-3 py-2">{percent(row.from_top, idioma)}</td>
                <td className="px-3 py-2">
                  {row.previous_volume == null ? "" : number(row.previous_volume, idioma)}
                </td>
                <td className="px-3 py-2">
                  {row.variation == null
                    ? ""
                    : `${row.variation > 0 ? "+" : ""}${percent(row.variation, idioma)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DragScroll>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="font-semibold">{t("Motivos de perda")}</h4>
          <ul className="mt-3 space-y-2">
            {crm.loss_reasons.map((row) => (
              <li key={row.reason}>
                <div className="flex justify-between text-sm">
                  <span>{row.reason}</span>
                  <span>
                    {number(row.count, idioma)} ·{" "}
                    {totalLost > 0 ? percent((row.count / totalLost) * 100, idioma) : ""}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive"
                    style={{ width: `${totalLost > 0 ? (row.count / totalLost) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold">{t("Vendas fechadas no tempo")}</h4>
          {value && (
            <div className="mt-2 flex gap-4 text-sm">
              <span>
                {t("Valor vendido")}:{" "}
                <strong>{money(value.total_cents / 100, value.currency, idioma)}</strong>
              </span>
              <span>
                {t("Ticket médio")}:{" "}
                <strong>{money(value.average_cents / 100, value.currency, idioma)}</strong>
              </span>
            </div>
          )}
          <ul className="mt-3 space-y-2">
            {crm.sales_timeline.map((row) => (
              <li key={row.period} className="flex justify-between border-b pb-1 text-sm">
                <span>{row.period}</span>
                <span>
                  {number(row.count, idioma)} · {t("Acumulado")} {number(row.accumulated, idioma)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function MonthByMonth({
  group,
  crm,
  model,
  idioma,
}: {
  group: RichCurrencyGroup;
  crm: TrafficRichCrmInsights;
  model: Model;
  idioma: string;
}) {
  const t = useT();
  const rows = buildMonthlyRows(group, crm);
  if (rows.length < 2) return null;
  const total = rows.reduce(
    (sum, row) => ({
      month: t("Total"),
      spend: sum.spend + row.spend,
      platform_leads: sum.platform_leads + row.platform_leads,
      crm_leads: sum.crm_leads + row.crm_leads,
      won: sum.won + row.won,
      revenue: sum.revenue + row.revenue,
    }),
    { month: t("Total"), spend: 0, platform_leads: 0, crm_leads: 0, won: 0, revenue: 0 },
  );
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <h3 className="px-5 py-4 text-lg font-semibold">{t("Mês a mês")}</h3>
      <DragScroll className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="border-y bg-muted/35">
            <tr>
              {[
                t("Mês"),
                t("Investimento"),
                t("Leads"),
                t("Entraram no CRM"),
                t("Vendas fechadas"),
                t("Custo por lead"),
                t("Custo por venda"),
                ...(model === "ecommerce" ? [t("Receita"), "ROAS"] : []),
              ].map((label) => (
                <th key={label} className="px-3 py-2 text-right first:text-left">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {[...rows, total].map((row) => (
              <tr
                key={row.month}
                className={row.month === t("Total") ? "bg-muted/35 font-semibold" : ""}
              >
                <td className="px-3 py-2">{row.month}</td>
                <td className="px-3 py-2 text-right">{money(row.spend, group.currency, idioma)}</td>
                <td className="px-3 py-2 text-right">{number(row.platform_leads, idioma)}</td>
                <td className="px-3 py-2 text-right">{number(row.crm_leads, idioma)}</td>
                <td className="px-3 py-2 text-right">{number(row.won, idioma)}</td>
                <td className="px-3 py-2 text-right">
                  {row.platform_leads > 0
                    ? money(row.spend / row.platform_leads, group.currency, idioma)
                    : ""}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.won > 0 ? money(row.spend / row.won, group.currency, idioma) : ""}
                </td>
                {model === "ecommerce" && (
                  <>
                    <td className="px-3 py-2 text-right">
                      {money(row.revenue, group.currency, idioma)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.spend > 0 ? `${number(row.revenue / row.spend, idioma)}x` : ""}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </DragScroll>
    </section>
  );
}
