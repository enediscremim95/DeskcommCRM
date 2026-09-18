"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";

interface Metrics {
  spend: number; conversions: number; revenue: number; impressions: number; reach: number;
  clicks: number; link_clicks: number; cost_per_conversion: number | null; cpm: number | null;
  ctr: number | null; cpc: number | null; conversion_rate: number | null;
  roas: number | null; average_order_value: number | null;
  video_views: number; video_p25: number; video_p50: number; video_p75: number; video_p95: number;
}
interface Campaign extends Metrics {
  name: string; platform: "meta_ads" | "google_ads";
  adsets: Array<Metrics & { name: string; ads: Array<Metrics & {
    name: string; thumbnail_url: string | null; story_id: string | null;
  }> }>;
}
interface CurrencyGroup {
  currency: string; summary: Metrics;
  daily: Array<{ date: string; spend_meta: number; spend_google: number; conversions: number; revenue: number }>;
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

function iso(date: Date): string { return date.toISOString().slice(0, 10); }
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
function percent(value: number | null): string { return value == null ? "—" : `${number(value)}%`; }

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
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
      signal: controller.signal, headers: { accept: "application/json" },
    })
      .then(async (response) => {
        const body = await response.json() as ReportResponse;
        if (!response.ok) throw new Error(body.error?.message ?? t("Não foi possível carregar o relatório."));
        setReport(body.data);
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name !== "AbortError") {
          setError(cause instanceof Error ? cause.message : t("Não foi possível carregar o relatório."));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [window, t]);

  const updatedAt = useMemo(() => report?.sync.last_succeeded_at
    ? new Date(report.sync.last_succeeded_at).toLocaleString(idioma === "es" ? "es-ES" : "pt-BR") : null,
  [idioma, report]);

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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t("Mídia e vendas")}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("Relatório de desempenho")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {updatedAt ? `${t("Última atualização")}: ${updatedAt}` : t("Aguardando a primeira sincronização.")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor="traffic-period">{t("Período")}</Label>
            <Select value={preset} onValueChange={changePreset}>
              <SelectTrigger id="traffic-period" className="w-48"><SelectValue /></SelectTrigger>
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
              <div className="space-y-1"><Label htmlFor="traffic-from">{t("De")}</Label>
                <Input id="traffic-from" type="date" value={window.from}
                  onChange={(event) => changeWindow({ ...window, from: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="traffic-to">{t("Até")}</Label>
                <Input id="traffic-to" type="date" value={window.to}
                  onChange={(event) => changeWindow({ ...window, to: event.target.value })} /></div>
            </>
          )}
        </div>
      </header>

      {report?.sync.status === "failed" && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium">{t("A atualização mais recente falhou.")}</p>
          <p className="mt-1 text-muted-foreground">
            {t("O último dado confirmado foi preservado. Avise quem administra a plataforma.")}
          </p>
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</div>}
      {loading && <p className="text-sm text-muted-foreground">{t("Carregando relatório…")}</p>}
      {!loading && report?.currencies.length === 0 && (
        <div className="rounded-xl border bg-card p-6 text-sm">
          <p className="font-medium">{t("Ainda não há dados para este período.")}</p>
          <p className="mt-1 text-muted-foreground">{t("Confira as contas escolhidas ou rode uma sincronização no admin.")}</p>
        </div>
      )}

      {report?.currencies.map((group) => (
        <section key={group.currency} className="space-y-4">
          {report.currencies.length > 1 && (
            <h2 className="text-lg font-semibold">{t("Moeda")}: {group.currency}</h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label={t("Investimento")} value={money(group.summary.spend, group.currency)} />
            <Kpi label={report.model === "ecommerce" ? t("Compras") : t("Conversões")}
              value={number(group.summary.conversions)}
              hint={group.summary.cost_per_conversion == null ? undefined :
                `${t("Custo por conversão")}: ${money(group.summary.cost_per_conversion, group.currency)}`} />
            {report.model === "ecommerce" ? (
              <>
                <Kpi label={t("Faturamento")} value={money(group.summary.revenue, group.currency)} />
                <Kpi label="ROAS" value={group.summary.roas == null ? "—" : `${number(group.summary.roas)}x`}
                  hint={group.summary.average_order_value == null ? undefined :
                    `${t("Ticket médio")}: ${money(group.summary.average_order_value, group.currency)}`} />
              </>
            ) : (
              <>
                <Kpi label={t("Impressões")} value={number(group.summary.impressions)} />
                <Kpi label={t("Cliques no link")} value={number(group.summary.link_clicks)}
                  hint={`CTR: ${percent(group.summary.ctr)}`} />
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3" aria-label={t("Funil de desempenho")}>
            {[
              [t("Pessoas alcançadas"), group.summary.reach],
              [t("Cliques no link"), group.summary.link_clicks],
              [report.model === "ecommerce" ? t("Compras") : t("Conversões"), group.summary.conversions],
            ].map(([label, value], index) => (
              <div key={String(label)} className="relative overflow-hidden rounded-xl border bg-card p-4">
                <span className="text-xs font-medium text-muted-foreground">{index + 1}. {label}</span>
                <p className="mt-2 text-xl font-semibold">{number(Number(value))}</p>
                <div className="absolute inset-x-0 bottom-0 h-1 bg-primary/20">
                  <div className="h-full bg-primary" style={{ width: `${Math.max(4, 100 - index * 28)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="h-80 rounded-xl border bg-card p-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={group.daily}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <YAxis yAxisId="spend" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <YAxis yAxisId="conversion" orientation="right" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10 }} />
                <Area yAxisId="spend" type="monotone" dataKey="spend_meta" stackId="spend"
                  fill="var(--primary)" stroke="var(--primary)" fillOpacity={0.5} name="Meta" />
                <Bar yAxisId="spend" dataKey="spend_google" stackId="spend"
                  fill="var(--accent-foreground)" opacity={0.55} name="Google" />
                <Line yAxisId="conversion" type="monotone" dataKey="conversions"
                  stroke="var(--foreground)" strokeWidth={2.5} dot={false} name={t("Conversões")} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {group.platforms.map((platform) => (
              <div key={platform.platform} className="rounded-xl border bg-card p-4">
                <h3 className="font-semibold">{platform.platform === "meta_ads" ? "Meta Ads" : "Google Ads"}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-muted-foreground">{t("Investimento")}</dt><dd>{money(platform.spend, group.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">{t("Conversões")}</dt><dd>{number(platform.conversions)}</dd></div>
                  <div><dt className="text-muted-foreground">CPC</dt><dd>{platform.cpc == null ? "—" : money(platform.cpc, group.currency)}</dd></div>
                  <div><dt className="text-muted-foreground">CTR</dt><dd>{percent(platform.ctr)}</dd></div>
                </dl>
              </div>
            ))}
          </div>

          {group.summary.video_views > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <h3 className="font-semibold">{t("Retenção de vídeo")}</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                {[
                  [t("Visualizações"), group.summary.video_views],
                  ["25%", group.summary.video_p25], ["50%", group.summary.video_p50],
                  ["75%", group.summary.video_p75], ["95%", group.summary.video_p95],
                ].map(([label, value]) => (
                  <div key={String(label)}><p className="text-muted-foreground">{label}</p><p className="font-semibold">{number(Number(value))}</p></div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b px-4 py-3"><h3 className="font-semibold">{t("Campanhas")}</h3></div>
            <div className="divide-y">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-muted/40 px-4 py-3 text-sm font-semibold">
                <span>{t("Total")}</span><span>{money(group.summary.spend, group.currency)}</span>
                <span>{number(group.summary.conversions)} {t("conversões")}</span>
              </div>
              {group.campaigns.map((campaign) => (
                <details key={`${campaign.platform}:${campaign.name}`} className="group">
                  <summary className="grid cursor-pointer grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                    <span className="font-medium">{campaign.name}</span>
                    <span>{money(campaign.spend, group.currency)}</span>
                    <span className="text-muted-foreground">{number(campaign.conversions)} {t("conversões")}</span>
                  </summary>
                  <div className="border-t bg-muted/20 px-4 py-2">
                    {campaign.adsets.map((adset) => (
                      <details key={adset.name}>
                        <summary className="cursor-pointer py-2 text-sm font-medium">{adset.name}</summary>
                        <div className="space-y-1 pb-2 pl-4">
                          {adset.ads.map((ad) => (
                            <div key={ad.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex min-w-0 items-center gap-2">
                                {ad.thumbnail_url && <a href={ad.thumbnail_url} target="_blank" rel="noopener noreferrer"
                                  className="shrink-0 rounded-md border px-2 py-1 text-[10px] hover:bg-muted">{t("Abrir mídia")}</a>}
                                {ad.story_id && <a href={`https://www.facebook.com/${encodeURIComponent(ad.story_id)}`}
                                  target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{ad.name}</a>}
                                {!ad.story_id && <span className="truncate">{ad.name}</span>}
                              </span><span>{money(ad.spend, group.currency)}</span>
                              <span>{number(ad.conversions)}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
