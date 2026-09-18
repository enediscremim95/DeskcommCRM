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

interface Metrics {
  spend: number;
  conversions: number;
  revenue: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  cost_per_conversion: number | null;
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
}: {
  campaigns: Campaign[];
  currency: string;
  total: Metrics;
  platform: "meta_ads" | "google_ads";
  labels: {
    campaign: string;
    total: string;
    investment: string;
    conversions: string;
    cpa: string;
    openMedia: string;
  };
}) {
  const isMeta = platform === "meta_ads";
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="border-b bg-muted/35 text-left text-xs tracking-[0.08em] text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">{labels.campaign}</th>
              <th className="px-4 py-3 text-right font-semibold">{labels.investment}</th>
              <th className="px-4 py-3 text-right font-semibold">{labels.conversions}</th>
              <th className="px-4 py-3 text-right font-semibold">{labels.cpa}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-muted/45 font-semibold">
              <td className="px-4 py-3">{labels.total}</td>
              <td className="px-4 py-3 text-right">{money(total.spend, currency)}</td>
              <td className="px-4 py-3 text-right">{number(total.conversions)}</td>
              <td className="px-4 py-3 text-right">
                {total.cost_per_conversion == null
                  ? "—"
                  : money(total.cost_per_conversion, currency)}
              </td>
            </tr>
            {campaigns.map((campaign) => (
              <tr key={`${campaign.platform}:${campaign.name}`} className="align-top">
                <td colSpan={4} className="p-0">
                  {isMeta ? (
                    <details className="group">
                      <summary className="grid cursor-pointer grid-cols-[minmax(240px,1fr)_120px_100px_120px] items-center gap-3 px-4 py-3 hover:bg-muted/35">
                        <span className="font-medium group-open:text-[#1877F2]">
                          {campaign.name}
                        </span>
                        <span className="text-right">{money(campaign.spend, currency)}</span>
                        <span className="text-right">{number(campaign.conversions)}</span>
                        <span className="text-right text-muted-foreground">
                          {campaign.cost_per_conversion == null
                            ? "—"
                            : money(campaign.cost_per_conversion, currency)}
                        </span>
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
                    <div className="grid grid-cols-[minmax(240px,1fr)_120px_100px_120px] items-center gap-3 px-4 py-3 hover:bg-muted/35">
                      <span className="font-medium">{campaign.name}</span>
                      <span className="text-right">{money(campaign.spend, currency)}</span>
                      <span className="text-right">{number(campaign.conversions)}</span>
                      <span className="text-right text-muted-foreground">
                        {campaign.cost_per_conversion == null
                          ? "—"
                          : money(campaign.cost_per_conversion, currency)}
                      </span>
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
          investment: t("Investimento"),
          conversions: conversionLabel,
          cpa: t("Custo por conversão"),
          openMedia: t("Abrir mídia"),
        };
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
                    <Kpi label={t("Alcance")} value={number(meta.reach)} />
                    <Kpi label={t("Impressões")} value={number(meta.impressions)} />
                    <Kpi
                      label={t("Frequência")}
                      value={meta.reach > 0 ? `${number(meta.impressions / meta.reach)}x` : "—"}
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
