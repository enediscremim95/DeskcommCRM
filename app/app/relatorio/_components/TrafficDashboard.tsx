"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import {
  CAMPAIGN_METRIC_COLUMNS,
  type CampaignMetricColumn,
} from "@/lib/windsor/types";

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
}
interface Campaign extends Metrics {
  name: string;
  platform: "meta_ads" | "google_ads";
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
    can_manage_defaults: boolean;
    sync: { status: string; last_succeeded_at: string | null; error: string | null };
    currencies: CurrencyGroup[];
  };
  error?: { message?: string };
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
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

const MONEY_COLUMNS = new Set<CampaignMetricColumn>([
  "spend", "cpm", "cpc", "cost_per_landing_page_view", "cost_per_lead",
  "cost_per_add_to_cart", "cost_per_initiate_checkout", "cost_per_purchase",
  "revenue", "cost_per_messaging_conversation",
]);
const META_ONLY_COLUMNS = new Set<CampaignMetricColumn>([
  "budget", "reach", "landing_page_views", "cost_per_landing_page_view",
  "add_to_cart", "cost_per_add_to_cart", "initiate_checkout",
  "cost_per_initiate_checkout", "purchases", "cost_per_purchase",
  "messaging_conversations", "cost_per_messaging_conversation",
]);

function localText(idioma: string, pt: string, es: string): string {
  return idioma === "es" ? es : pt;
}

function columnLabel(column: CampaignMetricColumn, idioma: string): string {
  const labels: Record<CampaignMetricColumn, [pt: string, es: string]> = {
    budget: ["Orçamento", "Presupuesto"], spend: ["Valor gasto", "Importe gastado"],
    reach: ["Alcance", "Alcance"], impressions: ["Impressões", "Impresiones"],
    cpm: ["CPM", "CPM"], ctr: ["CTR", "CTR"],
    link_clicks: ["Cliques no link", "Clics en el enlace"], cpc: ["CPC", "CPC"],
    landing_page_views: ["Visualizações da página", "Visitas a la página"],
    cost_per_landing_page_view: ["Custo por visualização", "Costo por visita"],
    leads: ["Leads", "Leads"], cost_per_lead: ["Custo por lead", "Costo por lead"],
    add_to_cart: ["Carrinhos", "Añadidos al carrito"],
    cost_per_add_to_cart: ["Custo por carrinho", "Costo por carrito"],
    initiate_checkout: ["Finalizações", "Inicios de pago"],
    cost_per_initiate_checkout: ["Custo por finalização", "Costo por inicio de pago"],
    purchases: ["Vendas", "Ventas"], cost_per_purchase: ["Custo por venda", "Costo por venta"],
    revenue: ["Valor de conversão", "Valor de conversión"], roas: ["ROAS", "ROAS"],
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

function savedColumns(report: ReportResponse["data"]): CampaignMetricColumn[] {
  const key = `traffic-campaign-columns:${report.organization_key}:${report.viewer_key}:${report.model}`;
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    if (Array.isArray(stored)) {
      const allowed = new Set<string>(CAMPAIGN_METRIC_COLUMNS);
      const valid = stored.filter(
        (column): column is CampaignMetricColumn => typeof column === "string" && allowed.has(column),
      );
      if (valid.length > 0) return valid;
    }
  } catch {
    // Preferência local inválida volta ao padrão da organização.
  }
  return report.default_columns;
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
        className="grid size-10 place-items-center rounded-xl bg-[#1877F2] text-lg font-bold text-white shadow-sm"
      >
        M
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="relative grid size-10 place-items-center overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border"
    >
      <span className="absolute inset-x-0 top-0 h-1 bg-[#4285F4]" />
      <span className="absolute inset-y-0 right-0 w-1 bg-[#34A853]" />
      <span className="absolute inset-x-0 bottom-0 h-1 bg-[#FBBC05]" />
      <span className="absolute inset-y-0 left-0 w-1 bg-[#EA4335]" />
      <span className="font-semibold text-foreground">G</span>
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
  const isMeta = platform === "meta_ads";
  const gridTemplateColumns = `minmax(240px, 1fr) repeat(${columns.length}, minmax(120px, auto))`;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="border-b bg-muted/35 text-left text-xs tracking-[0.08em] text-muted-foreground uppercase">
            <tr>
              <th className="min-w-60 px-4 py-3 font-semibold">{labels.campaign}</th>
              {columns.map((column) => (
                <th key={column} className="min-w-30 px-4 py-3 text-right font-semibold">
                  {columnLabel(column, idioma)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-muted/45 font-semibold">
              <td className="px-4 py-3">{labels.total}</td>
              {columns.map((column) => (
                <td key={column} className="px-4 py-3 text-right">
                  {metricValue(total, column, currency, platform)}
                </td>
              ))}
            </tr>
            {campaigns.map((campaign) => (
              <tr key={`${campaign.platform}:${campaign.name}`} className="align-top">
                <td colSpan={columns.length + 1} className="p-0">
                  {isMeta ? (
                    <details className="group">
                      <summary
                        className="grid cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/35"
                        style={{ gridTemplateColumns }}
                      >
                        <span className="font-medium group-open:text-[#1877F2]">
                          {campaign.name}
                        </span>
                        {columns.map((column) => (
                          <span key={column} className="text-right text-muted-foreground">
                            {metricValue(campaign, column, currency, platform)}
                          </span>
                        ))}
                      </summary>
                      <div className="border-t bg-muted/15 px-4 py-2">
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
                                  <span className="text-right">{money(ad.spend, currency)}</span>
                                  <span className="text-right">{number(ad.conversions)}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <div
                      className="grid items-center gap-3 px-4 py-3 hover:bg-muted/35"
                      style={{ gridTemplateColumns }}
                    >
                      <span className="font-medium">{campaign.name}</span>
                      {columns.map((column) => (
                        <span key={column} className="text-right text-muted-foreground">
                          {metricValue(campaign, column, currency, platform)}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
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
  const [selectedColumns, setSelectedColumns] = useState<CampaignMetricColumn[]>([]);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [columnMessage, setColumnMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/reports/traffic?from=${window.from}&to=${window.to}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json()) as ReportResponse;
        if (!response.ok)
          throw new Error(body.error?.message ?? t("Não foi possível carregar o relatório."));
        setReport(body.data);
        setSelectedColumns(savedColumns(body.data));
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name !== "AbortError") {
          setError(
            cause instanceof Error ? cause.message : t("Não foi possível carregar o relatório."),
          );
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
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
    if (value === "month") setWindow(thisMonth());
    else if (value !== "custom") setWindow(range(Number(value)));
  }

  function changeWindow(next: { from: string; to: string }) {
    setLoading(true);
    setError(null);
    setWindow(next);
  }

  function toggleColumn(column: CampaignMetricColumn) {
    if (!report) return;
    setColumnMessage(null);
    setSelectedColumns((current) => {
      const next = current.includes(column)
        ? current.filter((item) => item !== column)
        : CAMPAIGN_METRIC_COLUMNS.filter((item) => current.includes(item) || item === column);
      if (next.length === 0) return current;
      localStorage.setItem(
        `traffic-campaign-columns:${report.organization_key}:${report.viewer_key}:${report.model}`,
        JSON.stringify(next),
      );
      return next;
    });
  }

  async function saveDefaultColumns() {
    if (!report || selectedColumns.length === 0) return;
    setSavingDefaults(true);
    setColumnMessage(null);
    try {
      const response = await fetch("/api/v1/reports/traffic", {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ columns: selectedColumns }),
      });
      const body = (await response.json()) as ReportResponse;
      if (!response.ok) throw new Error(body.error?.message ?? localText(idioma, "Não foi possível salvar o padrão.", "No fue posible guardar el valor predeterminado."));
      setReport((current) => current ? { ...current, default_columns: selectedColumns } : current);
      setColumnMessage(localText(idioma, "Padrão salvo para esta organização.", "Valor predeterminado guardado para esta organización."));
    } catch (cause) {
      setColumnMessage(cause instanceof Error ? cause.message : localText(idioma, "Não foi possível salvar o padrão.", "No fue posible guardar el valor predeterminado."));
    } finally {
      setSavingDefaults(false);
    }
  }

  const columnUi = {
    title: localText(idioma, "Métricas da tabela", "Métricas de la tabla"),
    localHint: localText(
      idioma,
      "Sua escolha fica somente neste navegador.",
      "Tu selección queda solamente en este navegador.",
    ),
    saveDefault: localText(
      idioma,
      "Salvar como padrão da organização",
      "Guardar como predeterminado de la organización",
    ),
  };

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            {t("Mídia e vendas")}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {t("Relatório de desempenho")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {updatedAt
              ? `${t("Última atualização")}: ${updatedAt}`
              : t("Aguardando a primeira sincronização.")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
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
            <details className="relative">
              <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm font-medium">
                {localText(idioma, "Colunas", "Columnas")} ({selectedColumns.length || report.default_columns.length})
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-[min(92vw,32rem)] rounded-xl border bg-card p-4 shadow-xl">
                <p className="text-sm font-semibold">{columnUi.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {columnUi.localHint}
                </p>
                <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                  {CAMPAIGN_METRIC_COLUMNS.map((column) => (
                    <label key={column} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={(selectedColumns.length ? selectedColumns : report.default_columns).includes(column)}
                        onChange={() => toggleColumn(column)}
                      />
                      <span>{columnLabel(column, idioma)}</span>
                    </label>
                  ))}
                </div>
                {report.can_manage_defaults && (
                  <button
                    type="button"
                    className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                    disabled={savingDefaults}
                    onClick={saveDefaultColumns}
                  >
                    {savingDefaults
                      ? localText(idioma, "Salvando…", "Guardando…")
                      : columnUi.saveDefault}
                  </button>
                )}
                {columnMessage && <p className="mt-2 text-xs text-muted-foreground">{columnMessage}</p>}
              </div>
            </details>
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
        const metaCampaigns = group.campaigns.filter(
          (campaign) => campaign.platform === "meta_ads",
        );
        const googleCampaigns = group.campaigns.filter(
          (campaign) => campaign.platform === "google_ads",
        );
        const conversionLabel = report.model === "ecommerce" ? t("Compras") : t("Conversões");
        const campaignLabels = {
          campaign: t("Campanha"),
          total: t("Total"),
          conversions: conversionLabel,
          openMedia: t("Abrir mídia"),
        };
        const visibleColumns = selectedColumns.length ? selectedColumns : report.default_columns;
        return (
          <section key={group.currency} className="space-y-6">
            {report.currencies.length > 1 && (
              <h2 className="text-lg font-semibold">
                {t("Moeda")}: {group.currency}
              </h2>
            )}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  {t("Mídia e vendas")}
                </p>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label={t("Investimento")} value={money(group.summary.spend, group.currency)} />
                <Kpi label={conversionLabel} value={number(group.summary.conversions)} />
                <Kpi
                  label={t("Custo por conversão")}
                  value={
                    group.summary.cost_per_conversion == null
                      ? "—"
                      : money(group.summary.cost_per_conversion, group.currency)
                  }
                />
                <Kpi label={t("Impressões")} value={number(group.summary.impressions)} />
              </div>
            </div>

            <div className="h-72 rounded-xl border bg-card p-3 sm:h-80 sm:p-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={group.daily}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <YAxis yAxisId="spend" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <YAxis
                    yAxisId="conversion"
                    orientation="right"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                    }}
                  />
                  <Area
                    yAxisId="spend"
                    type="monotone"
                    dataKey="spend_meta"
                    stackId="spend"
                    fill="var(--primary)"
                    stroke="var(--primary)"
                    fillOpacity={0.5}
                    name="Meta"
                  />
                  <Bar
                    yAxisId="spend"
                    dataKey="spend_google"
                    stackId="spend"
                    fill="var(--accent-foreground)"
                    opacity={0.55}
                    name="Google"
                  />
                  <Line
                    yAxisId="conversion"
                    type="monotone"
                    dataKey="conversions"
                    stroke="var(--foreground)"
                    strokeWidth={2.5}
                    dot={false}
                    name={t("Conversões")}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {meta && (
              <section
                aria-labelledby={`meta-${group.currency}`}
                className="overflow-hidden rounded-2xl border border-[#1877F2]/30 bg-card shadow-sm"
              >
                <div className="border-b border-[#1877F2]/20 bg-[#1877F2]/[0.06] px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-3">
                    <PlatformMark platform="meta_ads" />
                    <div>
                      <p className="text-xs font-semibold tracking-[0.14em] text-[#1877F2] uppercase">
                        {t("Mídia e vendas")}
                      </p>
                      <h3 id={`meta-${group.currency}`} className="text-xl font-semibold">
                        Meta Ads
                      </h3>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-xs text-muted-foreground">{t("Investimento")}</p>
                      <p className="font-semibold">{money(meta.spend, group.currency)}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-5 p-4 sm:p-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <Kpi label={t("Alcance")} value={meta.reach == null ? "—" : number(meta.reach)} />
                    <Kpi label={t("Impressões")} value={number(meta.impressions)} />
                    <Kpi
                      label={t("Frequência")}
                      value={meta.reach != null && meta.reach > 0 ? `${number(meta.impressions / meta.reach)}x` : "—"}
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

                  <div className="grid gap-3 sm:grid-cols-3" aria-label={t("Funil de desempenho")}>
                    {[
                      [t("Pessoas alcançadas"), meta.reach],
                      [t("Cliques no link"), meta.link_clicks],
                      [conversionLabel, meta.conversions],
                    ].map(([label, value], index) => (
                      <div
                        key={String(label)}
                        className="relative overflow-hidden rounded-xl border bg-card p-4"
                      >
                        <span className="text-xs font-medium text-muted-foreground">
                          {index + 1}. {label}
                        </span>
                        <p className="mt-2 text-xl font-semibold">{number(Number(value))}</p>
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-[#1877F2]/15">
                          <div
                            className="h-full bg-[#1877F2]"
                            style={{ width: `${Math.max(4, 100 - index * 28)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {meta.video_views > 0 && (
                    <div className="rounded-xl border bg-card p-4">
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
                            <p className="font-semibold">
                              {value == null ? "—" : number(Number(value))}
                            </p>
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
              </section>
            )}

            {google && (
              <section
                aria-labelledby={`google-${group.currency}`}
                className="overflow-hidden rounded-2xl border bg-card shadow-sm"
              >
                <div className="grid h-1 grid-cols-4" aria-hidden="true">
                  <span className="bg-[#4285F4]" />
                  <span className="bg-[#EA4335]" />
                  <span className="bg-[#FBBC05]" />
                  <span className="bg-[#34A853]" />
                </div>
                <div className="border-b px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-3">
                    <PlatformMark platform="google_ads" />
                    <div>
                      <p className="text-xs font-semibold tracking-[0.14em] text-[#4285F4] uppercase">
                        {t("Mídia e vendas")}
                      </p>
                      <h3 id={`google-${group.currency}`} className="text-xl font-semibold">
                        Google Ads
                      </h3>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-xs text-muted-foreground">{t("Investimento")}</p>
                      <p className="font-semibold">{money(google.spend, group.currency)}</p>
                    </div>
                  </div>
                </div>
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
              </section>
            )}
          </section>
        );
      })}
    </div>
  );
}
