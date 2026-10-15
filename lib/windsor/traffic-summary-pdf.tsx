import {
  Circle,
  Document,
  Image,
  Line,
  Page,
  Polygon,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";

import type { MarcaDeSaida } from "@/lib/branding/saida";
import type { TrafficDelivery, TrafficDeliveryCampaign } from "@/lib/windsor/delivery";
import { paginaDestinoLimpa } from "@/lib/windsor/pagina-limpa";
import {
  fetchPdfThumbnailDataUri,
  preloadPdfThumbnails,
  type ThumbnailDependencies,
} from "@/lib/windsor/pdf-thumbnails";
import {
  PRIORITY_METRIC_META,
  priorityMetricValue,
  validPriorityMetrics,
  type PriorityMetricColumn,
  type PriorityMetricValues,
} from "@/lib/windsor/priority-metrics";
import {
  buildAutomaticAnalysis,
  buildPlatformInvestmentShares,
  defaultTrafficObjective,
  text,
  type LeadProfile,
  type TrafficMetricSnapshot,
  type TrafficSummaryLanguage,
} from "@/lib/windsor/traffic-summary-model";
import type { DashboardModel } from "@/lib/windsor/types";

type Language = TrafficSummaryLanguage;
type ReportMetrics = PriorityMetricValues & {
  reach: number | null;
  impressions: number;
  clicks: number;
  link_clicks?: number | null;
  leads?: number | null;
  cost_per_lead?: number | null;
  ctr?: number | null;
  conversion_rate?: number | null;
};
type PlatformMetrics = ReportMetrics & {
  platform: "meta_ads" | "google_ads";
  comparison?: ReportMetrics | null;
};

export type TrafficSummarySource = {
  model?: DashboardModel;
  organization_name?: string;
  /** Fase 2: persistir e editar este texto na configuração do relatório. */
  objective?: string | null;
  priority_metrics?: PriorityMetricColumn[];
  window: { from: string; to: string };
  crm: {
    leads_entered: number;
    in_service: number;
    closed_won: number;
    closed_lost?: number;
    stages?: Array<{ name: string; count: number }>;
    loss_reasons?: Array<{ reason: string; count: number }>;
    previous?: {
      leads_entered: number;
      in_service: number;
      closed_won: number;
      closed_lost?: number;
      stages?: Array<{ name: string; count: number }>;
      loss_reasons?: Array<{ reason: string; count: number }>;
    };
  };
  lead_profile?: LeadProfile | null;
  historico?: Array<{
    currency: string;
    periods: Array<{
      from: string;
      to: string;
      spend: number | null;
      leads: number | null;
      cost_per_lead: number | null;
    }>;
  }>;
  currencies: Array<{
    currency: string;
    summary: ReportMetrics;
    comparison?: ReportMetrics | null;
    platforms?: PlatformMetrics[];
    campaigns?: Array<{
      name: string;
      platform?: "meta_ads" | "google_ads";
      campaign_status?: string | null;
      leads: number;
      cost_per_lead: number | null;
      conversion_rate: number | null;
      adsets?: Array<{
        name: string;
        ads?: Array<{
          name: string;
          spend: number;
          impressions: number;
          leads: number;
          cost_per_lead: number | null;
          thumbnail_url: string | null;
          destination_urls: string[];
          first_delivery_on: string | null;
          last_delivery_on: string | null;
        }>;
      }>;
    }>;
  }>;
  delivery?: TrafficDelivery;
};

export type TrafficSummaryGroup = {
  currency: string | null;
  spend: number | null;
  reach: number | null;
  clicks: number;
  leads: number;
  costPerLead: number | null;
  mediaValue: number | null;
  mediaKind: "reach" | "impressions" | "unavailable";
  inService: number;
  closedWon: number;
  closedLost: number;
  previous: {
    spend: number | null;
    reach: number | null;
    clicks: number | null;
    leads: number | null;
    costPerLead: number | null;
    inService: number | null;
    closedWon: number | null;
    closedLost: number | null;
  };
};

export function buildTrafficSummaryGroups(source: TrafficSummarySource): TrafficSummaryGroup[] {
  const leads = source.crm.leads_entered;
  if (source.currencies.length === 0) {
    return [{
      currency: null,
      spend: null,
      reach: null,
      clicks: 0,
      leads,
      costPerLead: null,
      mediaValue: null,
      mediaKind: "unavailable",
      inService: source.crm.in_service,
      closedWon: source.crm.closed_won,
      closedLost: source.crm.closed_lost ?? 0,
      previous: {
        spend: null,
        reach: null,
        clicks: null,
        leads: source.crm.previous?.leads_entered ?? null,
        costPerLead: null,
        inService: source.crm.previous?.in_service ?? null,
        closedWon: source.crm.previous?.closed_won ?? null,
        closedLost: source.crm.previous?.closed_lost ?? null,
      },
    }];
  }
  return source.currencies.map((group) => {
    const previousLeads = source.crm.previous?.leads_entered ?? null;
    return {
      currency: group.currency,
      spend: group.summary.spend,
      reach: group.summary.reach,
      clicks: group.summary.clicks,
      leads,
      costPerLead: leads > 0 ? group.summary.spend / leads : null,
      mediaValue: group.summary.reach ?? group.summary.impressions,
      mediaKind: group.summary.reach != null ? "reach" as const : group.summary.impressions > 0 ? "impressions" as const : "unavailable" as const,
      inService: source.crm.in_service,
      closedWon: source.crm.closed_won,
      closedLost: source.crm.closed_lost ?? 0,
      previous: {
        spend: group.comparison?.spend ?? null,
        reach: group.comparison?.reach ?? null,
        clicks: group.comparison?.clicks ?? null,
        leads: previousLeads,
        costPerLead: group.comparison && previousLeads != null && previousLeads > 0 ? group.comparison.spend / previousLeads : null,
        inService: source.crm.previous?.in_service ?? null,
        closedWon: source.crm.previous?.closed_won ?? null,
        closedLost: source.crm.previous?.closed_lost ?? null,
      },
    };
  });
}

const PAGE_SIZE: [number, number] = [960, 540];
const CONTENT_WIDTH = 888;

function platformHasDelivery(platform: PlatformMetrics): boolean {
  return [
    platform.spend,
    platform.reach,
    platform.impressions,
    platform.clicks,
    platform.link_clicks,
    platform.leads,
  ].some((value) => (value ?? 0) > 0);
}

export function hasMultipleDeliveredPlatforms(source: TrafficSummarySource): boolean {
  const delivered = new Set(
    source.currencies.flatMap((currency) =>
      (currency.platforms ?? [])
        .filter(platformHasDelivery)
        .map((platform) => platform.platform),
    ),
  );
  return delivered.size >= 2;
}

function parseHex(color: string): [number, number, number] | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  return hex ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] : null;
}
function tint(color: string, amount: number): string {
  const rgb = parseHex(color) ?? [37, 99, 235];
  const channel = (value: number) => Math.round(255 - (255 - value) * amount);
  return `#${rgb.map((value) => channel(value).toString(16).padStart(2, "0")).join("")}`;
}
function formatNumber(value: number | null | undefined, language: Language): string {
  return value == null ? text(language, "Sem dado", "Sin datos") : new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", { maximumFractionDigits: 0 }).format(value);
}
function formatMoney(value: number | null | undefined, currency: string | null, language: Language): string {
  return value == null || !currency ? text(language, "Sem dado", "Sin datos") : new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function formatPercentNumber(value: number, language: Language, digits?: number): string {
  const resolvedDigits = digits ?? (Number.isInteger(value) ? 0 : 1);
  return new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", { minimumFractionDigits: resolvedDigits, maximumFractionDigits: resolvedDigits }).format(value);
}
function formatPercent(value: number, language: Language): string {
  return `${formatPercentNumber(value * 100, language, 1)}%`;
}
function formatRate(value: number | null | undefined, language: Language): string {
  return value == null ? text(language, "Sem dado", "Sin datos") : `${formatPercentNumber(value, language, 2)}%`;
}
function formatPeriod(window: TrafficSummarySource["window"], language: Language): string {
  const formatter = new Intl.DateTimeFormat(language === "es" ? "es-ES" : "pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
  const from = formatter.format(new Date(`${window.from}T12:00:00Z`));
  const to = formatter.format(new Date(`${window.to}T12:00:00Z`));
  return text(language, `${from} a ${to}`, `${from} al ${to}`);
}
function formatShortPeriod(from: string, to: string, language: Language): string {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (start.getUTCDate() === 1 && start.getUTCMonth() === end.getUTCMonth()) {
    return new Intl.DateTimeFormat(language === "es" ? "es-ES" : "pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(start);
  }
  const formatter = new Intl.DateTimeFormat(language === "es" ? "es-ES" : "pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return `${formatter.format(start)}-${formatter.format(end)}`;
}

export type TrafficAdMovement = "new" | "active" | "paused" | null;
export type TrafficAdInTest = {
  key: string;
  currency: string;
  platform: "meta_ads" | "google_ads";
  name: string;
  campaign: string;
  spend: number;
  impressions: number;
  leads: number;
  cost_per_lead: number | null;
  thumbnail_url: string | null;
  thumbnail_data_uri?: string | null;
  pages: string[];
  movement: TrafficAdMovement;
};
function adMovement(ad: { first_delivery_on: string | null; last_delivery_on: string | null }, campaignStatus: string | null | undefined, platform: "meta_ads" | "google_ads" | undefined, window: TrafficSummarySource["window"]): TrafficAdMovement {
  if (ad.first_delivery_on && ad.first_delivery_on >= window.from && ad.first_delivery_on <= window.to) return "new";
  const status = campaignStatus?.trim().toUpperCase();
  if (platform === "google_ads" ? status === "ENABLED" : status === "ACTIVE") return "active";
  if (status && ad.last_delivery_on && ad.last_delivery_on < window.to) return "paused";
  return null;
}
export function buildTrafficAdsInTest(source: TrafficSummarySource): TrafficAdInTest[] {
  const ads: TrafficAdInTest[] = [];
  source.currencies.forEach((currencyGroup, currencyIndex) => currencyGroup.campaigns?.forEach((campaign, campaignIndex) => campaign.adsets?.forEach((adset, adsetIndex) => adset.ads?.forEach((ad, adIndex) => {
    if (!(ad.spend > 0 || ad.impressions > 0)) return;
    const pages = new Map<string, string>();
    for (const raw of ad.destination_urls ?? []) {
      const page = paginaDestinoLimpa(raw);
      if (page) pages.set(page.endereco, page.endereco);
    }
    ads.push({
      key: `${currencyIndex}:${campaignIndex}:${adsetIndex}:${adIndex}`,
      currency: currencyGroup.currency,
      platform: campaign.platform ?? "meta_ads",
      name: ad.name,
      campaign: campaign.name,
      spend: ad.spend,
      impressions: ad.impressions,
      leads: ad.leads,
      cost_per_lead: ad.cost_per_lead,
      thumbnail_url: ad.thumbnail_url,
      pages: [...pages.values()],
      movement: adMovement(ad, campaign.campaign_status, campaign.platform, source.window),
    });
  }))));
  return ads.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name, "pt-BR"));
}

type TrafficCampaign = NonNullable<TrafficSummarySource["currencies"][number]["campaigns"]>[number];
export type TrafficCampaignChampion = { label: string; campaignName: string; value: string | null };
function eligibleCampaigns(campaigns: TrafficCampaign[], minimumLeads: number, metric: (campaign: TrafficCampaign) => number | null, direction: "asc" | "desc"): TrafficCampaign[] {
  return campaigns.filter((campaign) => {
    const value = metric(campaign);
    return campaign.name.trim().length > 0 && campaign.leads >= minimumLeads && value != null && Number.isFinite(value) && value >= 0;
  }).sort((a, b) => {
    const difference = direction === "asc" ? (metric(a) ?? 0) - (metric(b) ?? 0) : (metric(b) ?? 0) - (metric(a) ?? 0);
    return difference || a.name.localeCompare(b.name, "pt-BR");
  });
}
export function buildTrafficCampaignChampions(campaigns: TrafficCampaign[], currency: string | null, language: Language): TrafficCampaignChampion[] {
  const insufficient = text(language, "Sem dados suficientes", "Sin datos suficientes");
  const card = (label: string, winner: TrafficCampaign | undefined, value: (campaign: TrafficCampaign) => string) => ({ label, campaignName: winner?.name ?? insufficient, value: winner ? value(winner) : null });
  const mostLeads = eligibleCampaigns(campaigns, 0, (campaign) => campaign.leads, "desc")[0];
  const lowestCost = eligibleCampaigns(campaigns, 20, (campaign) => campaign.cost_per_lead, "asc")[0];
  const bestConversion = eligibleCampaigns(campaigns, 40, (campaign) => campaign.conversion_rate, "desc")[0];
  return [
    card(text(language, "Mais leads", "Más leads"), mostLeads, (campaign) => `${formatNumber(campaign.leads, language)} leads`),
    card(text(language, "Menor custo por lead", "Menor costo por lead"), lowestCost, (campaign) => formatMoney(campaign.cost_per_lead, currency, language)),
    card(text(language, "Melhor conversão", "Mejor conversión"), bestConversion, (campaign) => `${formatPercentNumber(campaign.conversion_rate ?? 0, language, 0)}%`),
  ];
}

export type TrafficVariation = { kind: "unavailable"; percent: null } | { kind: "new"; percent: null } | { kind: "percent"; percent: number };
export function trafficVariation(current: number | null, previous: number | null | undefined): TrafficVariation {
  if (current == null || previous == null) return { kind: "unavailable", percent: null };
  if (previous === 0) return current === 0 ? { kind: "percent", percent: 0 } : { kind: "new", percent: null };
  return { kind: "percent", percent: ((current - previous) / Math.abs(previous)) * 100 };
}
function formatVariation(current: number | null, previous: number | null | undefined, language: Language): string | null {
  const change = trafficVariation(current, previous);
  if (change.kind === "unavailable") return null;
  if (change.kind === "new") return text(language, "novo vs. período anterior", "nuevo vs. período anterior");
  return `${change.percent > 0 ? "+" : ""}${formatPercentNumber(change.percent, language)}% ${text(language, "vs. período anterior", "vs. período anterior")}`;
}
function formatVariationShort(current: number | null, previous: number | null | undefined, language: Language): string {
  const change = trafficVariation(current, previous);
  if (change.kind === "unavailable") return text(language, "sem dado anterior", "sin dato anterior");
  if (change.kind === "new") return text(language, "novo", "nuevo");
  return `${change.percent > 0 ? "+" : ""}${formatPercentNumber(change.percent, language)}%`;
}

export type TrafficPriorityMetricCard = { key: PriorityMetricColumn; label: string; value: string; comparison: string | null };
export function buildTrafficPriorityMetricCards(source: TrafficSummarySource, currencyIndex: number, language: Language): TrafficPriorityMetricCard[] {
  const model = source.model ?? "leads";
  const currentSummary = source.currencies[currencyIndex]?.summary;
  const previousSummary = source.currencies[currencyIndex]?.comparison ?? null;
  return validPriorityMetrics(source.priority_metrics, model).map((metric) => {
    const meta = PRIORITY_METRIC_META[metric];
    const current = currentSummary ? priorityMetricValue(metric, currentSummary, source.crm.closed_won) : metric === "crm_closed_won" ? source.crm.closed_won : null;
    const previous = metric === "crm_closed_won" ? source.crm.previous?.closed_won : previousSummary ? priorityMetricValue(metric, previousSummary, source.crm.previous?.closed_won ?? 0) : null;
    const currency = source.currencies[currencyIndex]?.currency ?? null;
    const value = meta.format === "money" ? formatMoney(current, currency, language) : meta.format === "percent" ? `${formatPercentNumber(current ?? 0, language, 0)}%` : meta.format === "ratio" ? `${formatNumber(current, language)}x` : formatNumber(current, language);
    return { key: metric, label: language === "es" ? meta.labelEs : meta.label, value, comparison: formatVariation(current, previous, language) };
  });
}

const DELIVERY_LIMIT = 10;
export type TrafficDeliverySection = { title: string; items: string[] };
function campaignPlatform(platform: TrafficDeliveryCampaign["platform"]): string { return platform === "meta_ads" ? "Meta" : "Google"; }
function limitedItems(items: string[], language: Language): string[] {
  const visible = items.slice(0, DELIVERY_LIMIT);
  const remaining = items.length - visible.length;
  return remaining > 0 ? [...visible, text(language, `e mais ${remaining}`, `y ${remaining} más`)] : visible;
}
export function buildTrafficDeliverySections(delivery: TrafficDelivery | undefined, language: Language): TrafficDeliverySection[] {
  const active = delivery?.active_campaigns ?? [];
  const invested = delivery?.invested_campaigns ?? [];
  const pages = delivery?.pages ?? [];
  const campaignItems = (campaigns: TrafficDeliveryCampaign[]) => limitedItems(campaigns.map((campaign) => `${campaign.name} · ${campaignPlatform(campaign.platform)}`), language);
  return [
    { title: text(language, `Hoje: ${active.length} ${active.length === 1 ? "campanha ativa" : "campanhas ativas"}`, `Hoy: ${active.length} ${active.length === 1 ? "campaña activa" : "campañas activas"}`), items: campaignItems(active) },
    ...(invested.length > 0 ? [{ title: text(language, `${invested.length} ${invested.length === 1 ? "campanha com investimento no período" : "campanhas com investimento no período"}`, `${invested.length} ${invested.length === 1 ? "campaña con inversión en el período" : "campañas con inversión en el período"}`), items: campaignItems(invested) }] : []),
    { title: text(language, `${pages.length} ${pages.length === 1 ? "página em teste" : "páginas em teste"}`, `${pages.length} ${pages.length === 1 ? "página en prueba" : "páginas en prueba"}`), items: limitedItems(pages, language) },
  ];
}
export function buildImprovementPoints(group: TrafficSummaryGroup, pagesInTest: number, language: Language): string[] {
  const points: string[] = [];
  const pct = (part: number, total: number) => `${formatPercentNumber((part / total) * 100, language)}%`;
  if (group.clicks >= 50 && group.leads / group.clicks < 0.1) {
    const rate = pct(group.leads, group.clicks);
    points.push(pagesInTest >= 2 ? text(language, `Conversão de clique em lead está em ${rate}. Estamos testando ${pagesInTest} páginas para aumentar.`, `La conversión de clic en lead está en ${rate}. Estamos probando ${pagesInTest} páginas para aumentarla.`) : text(language, `Conversão de clique em lead está em ${rate}. Próximo passo: testar outra página.`, `La conversión de clic en lead está en ${rate}. Próximo paso: probar otra página.`));
  }
  if (group.mediaValue && group.mediaValue >= 1000 && group.clicks / group.mediaValue < 0.01) {
    const rate = pct(group.clicks, group.mediaValue);
    points.push(text(language, `Taxa de clique está em ${rate}. Próximo passo: testar novos criativos.`, `La tasa de clic está en ${rate}. Próximo paso: probar nuevos creativos.`));
  }
  if (group.leads >= 20 && group.closedWon / group.leads < 0.05) {
    const rate = pct(group.closedWon, group.leads);
    points.push(text(language, `Conversão de lead em venda está em ${rate} (${formatNumber(group.closedWon, language)} de ${formatNumber(group.leads, language)}). Próximo passo: revisar o atendimento dos leads.`, `La conversión de lead en venta está en ${rate} (${formatNumber(group.closedWon, language)} de ${formatNumber(group.leads, language)}). Próximo paso: revisar la atención de los leads.`));
  }
  return points.slice(0, 3);
}
export function separarPlataforma(item: string): { nome: string; plataforma: string | null } {
  const cut = item.lastIndexOf(" · ");
  return cut < 0 ? { nome: item, plataforma: null } : { nome: item.slice(0, cut), plataforma: item.slice(cut + 3) };
}
export function limparNomeParaPdf(name: string): string {
  return name.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, "").replace(/\s+/g, " ").replace(/^[\s\-|·]+/, "").trim();
}

function changeSentence(language: Language, labelPt: string, labelEs: string, current: number, previous: number): string {
  const change = trafficVariation(current, previous);
  const label = text(language, labelPt, labelEs);
  if (change.kind === "new") return text(language, `${label}: ${formatNumber(current, language)}, sem ocorrência no período anterior.`, `${label}: ${formatNumber(current, language)}, sin ocurrencias en el período anterior.`);
  const percent = change.kind === "percent" ? change.percent : 0;
  if (percent === 0) return text(language, `${label} permaneceu em ${formatNumber(current, language)}.`, `${label} se mantuvo en ${formatNumber(current, language)}.`);
  const signed = `${percent > 0 ? "+" : "-"}${formatPercentNumber(Math.abs(percent), language)}%`;
  return text(language, `${label}: ${signed}, de ${formatNumber(previous, language)} para ${formatNumber(current, language)}.`, `${label}: ${signed}, de ${formatNumber(previous, language)} a ${formatNumber(current, language)}.`);
}
export function buildTrafficHighlights(source: TrafficSummarySource, groups: TrafficSummaryGroup[], language: Language): string[] {
  const highlights: string[] = [];
  if (source.crm.previous) highlights.push(changeSentence(language, "Entrada de leads", "Entrada de leads", source.crm.leads_entered, source.crm.previous.leads_entered));
  const primary = [...groups].filter((group) => group.currency && group.spend != null).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];
  if (primary?.costPerLead != null && primary.previous.costPerLead != null) {
    const change = trafficVariation(primary.costPerLead, primary.previous.costPerLead);
    if (change.kind === "percent" && change.percent !== 0) highlights.push(text(language, `Custo por lead ${change.percent < 0 ? "melhorou" : "aumentou"} ${formatPercentNumber(Math.abs(change.percent), language)}%, para ${formatMoney(primary.costPerLead, primary.currency, language)}.`, `El costo por lead ${change.percent < 0 ? "mejoró" : "aumentó"} ${formatPercentNumber(Math.abs(change.percent), language)}%, a ${formatMoney(primary.costPerLead, primary.currency, language)}.`));
  }
  if (source.crm.previous) highlights.push(changeSentence(language, "Vendas ganhas", "Ventas ganadas", source.crm.closed_won, source.crm.previous.closed_won));
  const topLoss = source.crm.loss_reasons?.[0];
  if (topLoss && (source.crm.closed_lost ?? 0) > 0) highlights.push(text(language, `Principal motivo de perda: ${topLoss.reason}, ${formatPercent(topLoss.count / (source.crm.closed_lost ?? 1), language)} das perdas.`, `Principal motivo de pérdida: ${topLoss.reason}, ${formatPercent(topLoss.count / (source.crm.closed_lost ?? 1), language)} de las pérdidas.`));
  return highlights.slice(0, 4);
}
export function buildTrafficFunnelReading(groups: TrafficSummaryGroup[], language: Language): string[] {
  const primary = [...groups].filter((group) => group.mediaValue != null || group.leads > 0).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];
  if (!primary) return [];
  const mediaLabel = primary.mediaKind === "reach" ? text(language, "visualização do anúncio", "visualización del anuncio") : text(language, "impressão", "impresión");
  const transitions = [
    { from: primary.mediaValue, to: primary.clicks, fromLabel: mediaLabel, toLabel: text(language, "clique", "clic") },
    { from: primary.clicks, to: primary.leads, fromLabel: text(language, "clique", "clic"), toLabel: "lead" },
    { from: primary.leads, to: primary.closedWon, fromLabel: "lead", toLabel: text(language, "venda", "venta") },
  ].filter((item): item is { from: number; to: number; fromLabel: string; toLabel: string } => item.from != null && item.from > 0).map((item) => ({ ...item, rate: item.to / item.from }));
  const bottleneck = [...transitions].sort((a, b) => a.rate - b.rate)[0];
  const readings: string[] = [];
  if (bottleneck) readings.push(text(language, `Maior estreitamento: ${bottleneck.fromLabel} para ${bottleneck.toLabel}, com ${formatPercent(bottleneck.rate, language)} de passagem.`, `Mayor estrechamiento: ${bottleneck.fromLabel} a ${bottleneck.toLabel}, con ${formatPercent(bottleneck.rate, language)} de paso.`));
  if (primary.leads > 0) readings.push(text(language, `Conversão de lead em venda: ${formatPercent(primary.closedWon / primary.leads, language)} (${formatNumber(primary.closedWon, language)} de ${formatNumber(primary.leads, language)}).`, `Conversión de lead en venta: ${formatPercent(primary.closedWon / primary.leads, language)} (${formatNumber(primary.closedWon, language)} de ${formatNumber(primary.leads, language)}).`));
  return readings;
}

const styles = StyleSheet.create({
  page: { width: 960, height: 540, paddingHorizontal: 36, paddingVertical: 28, fontFamily: "Helvetica", fontSize: 10, color: "#17211a", backgroundColor: "#ffffff" },
  cover: { padding: 0, backgroundColor: "#111713" },
  coverAccent: { width: 18, height: 540, position: "absolute", left: 0, top: 0 },
  coverContent: { marginLeft: 70, marginTop: 150, width: 650 },
  coverEyebrow: { fontSize: 18, fontWeight: "bold", marginBottom: 10 },
  coverClient: { color: "#ffffff", fontSize: 48, fontWeight: "bold", lineHeight: 1.05 },
  coverPeriod: { color: "#dfe6e1", fontSize: 18, marginTop: 16 },
  coverLogo: { position: "absolute", right: 54, top: 44, width: 140, height: 70, objectFit: "contain" },
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  pageTitle: { fontSize: 27, fontWeight: "bold" },
  pageSubtitle: { color: "#66736a", marginTop: 4, fontSize: 9 },
  brandName: { fontSize: 9, fontWeight: "bold", maxWidth: 180, textAlign: "right" },
  brandLogo: { width: 90, height: 32, objectFit: "contain" },
  objective: { marginTop: 24, padding: 18, borderRadius: 10, backgroundColor: "#f4f7f5" },
  objectiveLabel: { fontSize: 8, fontWeight: "bold", letterSpacing: 1.2, textTransform: "uppercase" },
  objectiveText: { marginTop: 7, fontSize: 16, fontWeight: "bold", lineHeight: 1.25 },
  sharesRow: { flexDirection: "row", gap: 18, marginTop: 20 },
  shareCard: { flex: 1, alignItems: "center", padding: 8 },
  shareCircle: { width: 104, height: 104, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  sharePercent: { fontSize: 21, fontWeight: "bold" },
  sharePlatform: { marginTop: 8, fontSize: 12, fontWeight: "bold" },
  shareSpend: { marginTop: 3, color: "#66736a", fontSize: 8 },
  currencyLabel: { marginTop: 14, fontSize: 9, color: "#66736a", fontWeight: "bold" },
  ratesRow: { flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 4, marginBottom: 18 },
  rateCard: { width: 220, padding: 10, borderRadius: 8, backgroundColor: "#f4f7f5", alignItems: "center" },
  rateValue: { fontSize: 17, fontWeight: "bold" },
  ratePrevious: { marginTop: 3, color: "#66736a", fontSize: 8 },
  arrows: { flexDirection: "row", width: CONTENT_WIDTH, height: 92 },
  arrow: { position: "relative", width: 177.6, height: 92, alignItems: "center" },
  arrowSvg: { position: "absolute", top: 0, left: 0 },
  arrowLabel: { marginTop: 16, fontSize: 8, fontWeight: "bold", textTransform: "uppercase" },
  arrowValue: { marginTop: 5, fontSize: 13, fontWeight: "bold" },
  arrowVariation: { marginTop: 19, fontSize: 8, fontWeight: "bold" },
  analysis: { marginTop: 22, borderLeftWidth: 4, paddingLeft: 14 },
  analysisTitle: { fontSize: 12, fontWeight: "bold", marginBottom: 6 },
  analysisItem: { fontSize: 10, lineHeight: 1.35, marginTop: 4 },
  chart: { height: 200, marginTop: 2 },
  legend: { flexDirection: "row", gap: 18, justifyContent: "center", marginTop: 2 },
  legendItem: { flexDirection: "row", gap: 5, alignItems: "center", fontSize: 8 },
  legendSwatch: { width: 14, height: 4 },
  table: { marginTop: 10, borderWidth: 1, borderColor: "#dce4de" },
  tableRow: { flexDirection: "row", minHeight: 24, borderBottomWidth: 1, borderColor: "#e8ede9", alignItems: "center" },
  tableLabel: { width: 120, paddingHorizontal: 7, fontSize: 8, fontWeight: "bold" },
  tableCell: { flex: 1, paddingHorizontal: 4, fontSize: 7.5, textAlign: "center" },
  crmGrid: { flexDirection: "row", gap: 20 },
  crmMetrics: { width: 260, gap: 9 },
  metric: { borderWidth: 1, borderColor: "#dce4de", borderRadius: 7, padding: 9 },
  metricLabel: { color: "#66736a", fontSize: 7.5, textTransform: "uppercase" },
  metricValue: { marginTop: 3, fontSize: 17, fontWeight: "bold" },
  metricComparison: { marginTop: 2, color: "#66736a", fontSize: 7 },
  funnel: { flex: 1, alignItems: "center", gap: 4 },
  funnelStage: { width: 390, minHeight: 50, borderRadius: 8, padding: 8, alignItems: "center", justifyContent: "center" },
  funnelValue: { fontSize: 16, fontWeight: "bold" },
  funnelLabel: { marginTop: 2, fontSize: 7 },
  deliveryColumns: { flexDirection: "row", gap: 16 },
  deliverySection: { flex: 1, borderWidth: 1, borderColor: "#dce4de", borderRadius: 8, padding: 12 },
  deliverySectionTitle: { fontSize: 10, fontWeight: "bold", marginBottom: 8 },
  deliveryRow: { flexDirection: "row", justifyContent: "space-between", gap: 7, paddingVertical: 4, borderBottomWidth: 1, borderColor: "#eef2ef" },
  deliveryName: { flex: 1, fontSize: 8 },
  deliveryPlatform: { color: "#66736a", fontSize: 7, textTransform: "uppercase" },
  improvement: { marginTop: 18, padding: 13, borderRadius: 8, backgroundColor: "#f4f7f5" },
  improvementTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 5 },
  improvementItem: { fontSize: 8.5, marginTop: 4 },
  creativeGrid: { flexDirection: "row", gap: 18, marginTop: 8 },
  creativeCard: { flex: 1, borderWidth: 1, borderColor: "#dce4de", borderRadius: 9, overflow: "hidden" },
  creativeImage: { width: 272, height: 210, objectFit: "cover" },
  creativeFallback: { height: 210, alignItems: "center", justifyContent: "center", padding: 15, backgroundColor: "#f4f7f5" },
  creativeName: { fontSize: 10, fontWeight: "bold", textAlign: "center" },
  creativeBody: { padding: 10 },
  creativeMetrics: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  creativeValue: { fontSize: 12, fontWeight: "bold" },
  creativeLabel: { color: "#66736a", fontSize: 7 },
  creativePage: { color: "#66736a", fontSize: 7, marginTop: 8 },
  adsHeader: { flexDirection: "row", paddingVertical: 6, backgroundColor: "#f4f7f5", borderBottomWidth: 1, borderColor: "#dce4de" },
  adsHeaderText: { color: "#66736a", fontSize: 6.5, fontWeight: "bold", textTransform: "uppercase" },
  adRow: { flexDirection: "row", alignItems: "center", minHeight: 49, paddingVertical: 4, borderBottomWidth: 1, borderColor: "#eef2ef" },
  adCreative: { width: 58, paddingRight: 6 },
  adThumbnail: { width: 42, height: 42, objectFit: "cover", borderRadius: 4 },
  adIdentity: { flex: 1, paddingRight: 6 },
  adName: { fontSize: 8, lineHeight: 1.1, fontWeight: "bold", maxLines: 2, textOverflow: "ellipsis" },
  adCampaign: { marginTop: 1, fontSize: 6.5, lineHeight: 1.1, color: "#66736a", maxLines: 2, textOverflow: "ellipsis" },
  adMovement: { marginTop: 1, fontSize: 6.5, lineHeight: 1.1, fontWeight: "bold" },
  adPage: { width: 190, paddingRight: 6, fontSize: 6.5, lineHeight: 1.1, maxLines: 2, textOverflow: "ellipsis" },
  adMoney: { width: 82, textAlign: "right", paddingRight: 6, fontSize: 7 },
  adLeads: { width: 50, textAlign: "right", paddingRight: 6, fontSize: 7 },
  adsPage: { paddingTop: 120 },
  adsPageHeader: { position: "absolute", top: 28, left: 36, right: 36, marginBottom: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  adsTableHeader: { position: "absolute", top: 92, left: 36, right: 36 },
  adsTableRow: { height: 52, minHeight: 52, flexShrink: 0 },
  adCreativeFallback: { fontSize: 6.5, lineHeight: 1.1, maxLines: 2, textOverflow: "ellipsis" },
  profileIntro: { color: "#66736a", fontSize: 10, marginBottom: 24 },
  profileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  profileCard: { width: 204, minHeight: 145, borderRadius: 10, padding: 16, backgroundColor: "#f4f7f5" },
  profilePercent: { fontSize: 30, fontWeight: "bold" },
  profileValue: { marginTop: 10, fontSize: 12, fontWeight: "bold", lineHeight: 1.25 },
  profileLabel: { marginTop: 6, color: "#66736a", fontSize: 8 },
});

function BrandMark({ brand, logoDataUri }: { brand: MarcaDeSaida; logoDataUri?: string | null }) {
  return logoDataUri ? <Image src={logoDataUri} style={styles.brandLogo} /> : <Text style={styles.brandName}>{brand.nome}</Text>;
}
function PageHeader({ title, subtitle, brand, logoDataUri }: { title: string; subtitle?: string; brand: MarcaDeSaida; logoDataUri?: string | null }) {
  return <View style={styles.pageHeader} fixed><View><Text style={styles.pageTitle}>{title}</Text>{subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}</View><BrandMark brand={brand} logoDataUri={logoDataUri} /></View>;
}
function RateCard({ label, current, previous, language }: { label: string; current: number | null | undefined; previous: number | null | undefined; language: Language }) {
  return <View style={styles.rateCard}><Text style={styles.rateValue}>{label} = {formatRate(current, language)}</Text><Text style={styles.ratePrevious}>{text(language, "período anterior", "período anterior")}: {formatRate(previous, language)}</Text></View>;
}
function clickValue(metrics: ReportMetrics, platform?: "meta_ads" | "google_ads"): number {
  return platform === "google_ads" ? metrics.clicks : (metrics.link_clicks ?? metrics.clicks);
}
function ArrowStrip({ current, previous, currency, platform, brand, language }: { current: ReportMetrics; previous?: ReportMetrics | null; currency: string; platform?: "meta_ads" | "google_ads"; brand: MarcaDeSaida; language: Language }) {
  const metrics = [
    { label: text(language, "Investimento", "Inversión"), value: formatMoney(current.spend, currency, language), current: current.spend, previous: previous?.spend ?? null, goodUp: false },
    { label: text(language, "Impressões", "Impresiones"), value: formatNumber(current.impressions, language), current: current.impressions, previous: previous?.impressions ?? null, goodUp: false },
    { label: text(language, "Cliques", "Clics"), value: formatNumber(clickValue(current, platform), language), current: clickValue(current, platform), previous: previous ? clickValue(previous, platform) : null, goodUp: false },
    { label: "Leads", value: formatNumber(current.leads, language), current: current.leads ?? null, previous: previous?.leads ?? null, goodUp: true },
    { label: "CPL", value: formatMoney(current.cost_per_lead, currency, language), current: current.cost_per_lead ?? null, previous: previous?.cost_per_lead ?? null, goodUp: false },
  ];
  return <View style={styles.arrows}>{metrics.map((metric, index) => {
    const change = trafficVariation(metric.current, metric.previous);
    const color = metric.goodUp && change.kind === "percent" ? change.percent > 0 ? "#18794e" : change.percent < 0 ? "#c43d3d" : "#526158" : "#526158";
    return <View key={metric.label} style={styles.arrow}>
      <Svg style={styles.arrowSvg} width={177.6} height={64} viewBox="0 0 178 64"><Polygon points="0,0 151,0 178,32 151,64 0,64 25,32" fill={tint(brand.accent, index % 2 === 0 ? 0.94 : 0.78)} /></Svg>
      <Text style={[styles.arrowLabel, { color: brand.accentFg }]}>{metric.label}</Text>
      <Text style={[styles.arrowValue, { color: brand.accentFg }]}>{metric.value}</Text>
      <Text style={[styles.arrowVariation, { color }]}>{formatVariationShort(metric.current, metric.previous, language)}</Text>
    </View>;
  })}</View>;
}
function MetricsPage({ title, subtitle, current, previous, currency, platform, brand, logoDataUri, language }: { title: string; subtitle?: string; current: ReportMetrics; previous?: ReportMetrics | null; currency: string; platform?: "meta_ads" | "google_ads"; brand: MarcaDeSaida; logoDataUri?: string | null; language: Language }) {
  const analysis = buildAutomaticAnalysis({ current: current as TrafficMetricSnapshot, previous: previous as TrafficMetricSnapshot | null, currency, language });
  return <Page size={PAGE_SIZE} style={styles.page}>
    <PageHeader title={title} subtitle={subtitle} brand={brand} logoDataUri={logoDataUri} />
    <View style={styles.ratesRow}><RateCard label="CTR" current={current.ctr} previous={previous?.ctr} language={language} /><RateCard label={text(language, "Clique para lead", "Clic a lead")} current={current.conversion_rate} previous={previous?.conversion_rate} language={language} /></View>
    <ArrowStrip current={current} previous={previous} currency={currency} platform={platform} brand={brand} language={language} />
    <View style={[styles.analysis, { borderLeftColor: brand.accent }]}><Text style={styles.analysisTitle}>{text(language, "Análise", "Análisis")}</Text>{analysis.map((sentence) => <Text key={sentence} style={styles.analysisItem}>• {sentence}</Text>)}</View>
  </Page>;
}

function FunnelDrawing({ group, brand, language }: { group: TrafficSummaryGroup; brand: MarcaDeSaida; language: Language }) {
  const mediaLabel = group.mediaKind === "reach" ? text(language, "pessoas viram o anúncio", "personas vieron el anuncio") : group.mediaKind === "impressions" ? text(language, "vezes o anúncio apareceu", "veces apareció el anuncio") : text(language, "sem dados de mídia", "sin datos de medios");
  const stages = [
    { value: group.mediaValue, label: mediaLabel },
    { value: group.clicks, label: text(language, "clicaram no anúncio", "hicieron clic en el anuncio") },
    { value: group.leads, label: text(language, "viraram leads no CRM", "se volvieron leads en el CRM") },
    { value: group.closedWon, label: text(language, "fecharam a venda", "cerraron la venta") },
  ];
  return <View style={styles.funnel}>{stages.map((stage, index) => <View key={stage.label} style={[styles.funnelStage, { width: 390 - index * 55, backgroundColor: tint(brand.accent, [0.2, 0.45, 0.72, 1][index] ?? 1) }]}><Text style={[styles.funnelValue, { color: index >= 2 ? brand.accentFg : "#17211a" }]}>{formatNumber(stage.value, language)}</Text><Text style={[styles.funnelLabel, { color: index >= 2 ? brand.accentFg : "#17211a" }]}>{stage.label}</Text></View>)}</View>;
}

function HistoricoPage({ series, brand, logoDataUri, language }: { series: NonNullable<TrafficSummarySource["historico"]>[number]; brand: MarcaDeSaida; logoDataUri?: string | null; language: Language }) {
  const width = 830;
  const top = 10;
  const bottom = 175;
  const slot = width / series.periods.length;
  const maxSpend = Math.max(1, ...series.periods.map((period) => period.spend ?? 0));
  const maxLeads = Math.max(1, ...series.periods.map((period) => period.leads ?? 0));
  const maxCpl = Math.max(1, ...series.periods.map((period) => period.cost_per_lead ?? 0));
  const y = (value: number, max: number) => bottom - (value / max) * (bottom - top);
  return <Page size={PAGE_SIZE} style={styles.page}>
    <PageHeader title={text(language, "Evolução", "Evolución")} subtitle={series.currency} brand={brand} logoDataUri={logoDataUri} />
    <View style={styles.chart}><Svg width={width} height={190} viewBox={`0 0 ${width} 190`}>
      <Line x1={0} y1={bottom} x2={width} y2={bottom} stroke="#cad4cd" strokeWidth={1} />
      {series.periods.map((period, index) => { const barHeight = period.spend == null ? 0 : (period.spend / maxSpend) * (bottom - top); return <Rect key={`${period.from}-bar`} x={index * slot + slot * 0.2} y={bottom - barHeight} width={slot * 0.32} height={barHeight} fill={tint(brand.accent, 0.78)} />; })}
      {series.periods.slice(1).map((period, index) => { const previous = series.periods[index]!; return previous.leads == null || period.leads == null ? null : <Line key={`${period.from}-leads`} x1={index * slot + slot * 0.55} y1={y(previous.leads, maxLeads)} x2={(index + 1) * slot + slot * 0.55} y2={y(period.leads, maxLeads)} stroke="#17211a" strokeWidth={2.5} />; })}
      {series.periods.slice(1).map((period, index) => { const previous = series.periods[index]!; return previous.cost_per_lead == null || period.cost_per_lead == null ? null : <Line key={`${period.from}-cpl`} x1={index * slot + slot * 0.55} y1={y(previous.cost_per_lead, maxCpl)} x2={(index + 1) * slot + slot * 0.55} y2={y(period.cost_per_lead, maxCpl)} stroke={brand.accent} strokeWidth={2} />; })}
      {series.periods.map((period, index) => period.leads == null ? null : <Circle key={`${period.from}-lead-dot`} cx={index * slot + slot * 0.55} cy={y(period.leads, maxLeads)} r={3.5} fill="#17211a" />)}
      {series.periods.map((period, index) => period.cost_per_lead == null ? null : <Circle key={`${period.from}-cpl-dot`} cx={index * slot + slot * 0.55} cy={y(period.cost_per_lead, maxCpl)} r={3} fill={brand.accent} />)}
    </Svg></View>
    <View style={styles.legend}><View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: tint(brand.accent, 0.78) }]} /><Text>{text(language, "Investimento", "Inversión")}</Text></View><View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: "#17211a" }]} /><Text>Leads</Text></View><View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: brand.accent }]} /><Text>CPL</Text></View></View>
    <View style={styles.table}>{[text(language, "Período", "Período"), text(language, "Valor investido", "Valor invertido"), "Leads", "CPL"].map((label, rowIndex) => <View key={label} style={[styles.tableRow, rowIndex === 3 ? { borderBottomWidth: 0 } : {}]}><Text style={styles.tableLabel}>{label}</Text>{series.periods.map((period) => <Text key={`${label}-${period.from}`} style={styles.tableCell}>{rowIndex === 0 ? formatShortPeriod(period.from, period.to, language) : rowIndex === 1 ? formatMoney(period.spend, series.currency, language) : rowIndex === 2 ? formatNumber(period.leads, language) : formatMoney(period.cost_per_lead, series.currency, language)}</Text>)}</View>)}</View>
    {/* Fase 2: acrescentar vendas por período quando a fonte estiver disponível. */}
  </Page>;
}

function CrmPage({ source, group, brand, logoDataUri, language }: { source: TrafficSummarySource; group: TrafficSummaryGroup; brand: MarcaDeSaida; logoDataUri?: string | null; language: Language }) {
  const metrics = [
    { label: text(language, "Entraram no CRM", "Entraron al CRM"), value: source.crm.leads_entered, previous: source.crm.previous?.leads_entered },
    { label: text(language, "Em atendimento", "En atención"), value: source.crm.in_service, previous: source.crm.previous?.in_service },
    { label: text(language, "Fecharam", "Cerraron"), value: source.crm.closed_won, previous: source.crm.previous?.closed_won },
    { label: text(language, "Perdidos", "Perdidos"), value: source.crm.closed_lost ?? 0, previous: source.crm.previous?.closed_lost },
  ];
  return <Page size={PAGE_SIZE} style={styles.page}><PageHeader title={text(language, "Dados do CRM", "Datos del CRM")} subtitle={text(language, "Do anúncio até a venda", "Del anuncio a la venta")} brand={brand} logoDataUri={logoDataUri} /><View style={styles.crmGrid}><View style={styles.crmMetrics}>{metrics.map((metric) => <View key={metric.label} style={styles.metric}><Text style={styles.metricLabel}>{metric.label}</Text><Text style={styles.metricValue}>{formatNumber(metric.value, language)}</Text><Text style={styles.metricComparison}>{formatVariation(metric.value, metric.previous, language) ?? text(language, "sem dado anterior", "sin dato anterior")}</Text></View>)}</View><FunnelDrawing group={group} brand={brand} language={language} /></View></Page>;
}

function movementLabel(movement: TrafficAdMovement, language: Language): string | null {
  if (movement === "new") return text(language, "Novo no período", "Nuevo en el período");
  if (movement === "active") return text(language, "Ativo", "Activo");
  if (movement === "paused") return text(language, "Pausou no período", "Se pausó en el período");
  return null;
}
function AdsPageHeader({ brand, logoDataUri, language }: { brand: MarcaDeSaida; logoDataUri?: string | null; language: Language }) {
  return <View style={styles.adsPageHeader} fixed>
    <View>
      <Text style={styles.pageTitle}>{text(language, "Anúncios em teste", "Anuncios en prueba")}</Text>
      <Text
        style={styles.pageSubtitle}
        render={({ subPageNumber, subPageTotalPages }) => text(
          language,
          `Página ${subPageNumber} de ${subPageTotalPages}`,
          `Página ${subPageNumber} de ${subPageTotalPages}`,
        )}
      />
    </View>
    <BrandMark brand={brand} logoDataUri={logoDataUri} />
  </View>;
}
function AdsTableHeader({ language }: { language: Language }) {
  return <View style={[styles.adsHeader, styles.adsTableHeader]} fixed><Text style={[styles.adsHeaderText, styles.adCreative]}>{text(language, "Criativo", "Creativo")}</Text><Text style={[styles.adsHeaderText, styles.adIdentity]}>{text(language, "Anúncio / campanha", "Anuncio / campaña")}</Text><Text style={[styles.adsHeaderText, styles.adPage]}>{text(language, "Página de destino", "Página de destino")}</Text><Text style={[styles.adsHeaderText, styles.adMoney]}>{text(language, "Gasto", "Gasto")}</Text><Text style={[styles.adsHeaderText, styles.adLeads]}>Leads</Text><Text style={[styles.adsHeaderText, styles.adMoney]}>CPL</Text></View>;
}
function AdsTable({ ads, brand, language }: { ads: TrafficAdInTest[]; brand: MarcaDeSaida; language: Language }) {
  return <View>{ads.map((ad) => {
    const movement = movementLabel(ad.movement, language);
    return <View key={ad.key} style={[styles.adRow, styles.adsTableRow]} wrap={false}><View style={styles.adCreative}>{ad.thumbnail_data_uri ? <Image src={ad.thumbnail_data_uri} style={styles.adThumbnail} /> : <Text style={styles.adCreativeFallback}>{limparNomeParaPdf(ad.name)}</Text>}</View><View style={styles.adIdentity}><Text style={styles.adName}>{limparNomeParaPdf(ad.name)}</Text><Text style={styles.adCampaign}>{limparNomeParaPdf(ad.campaign)}</Text>{movement ? <Text style={[styles.adMovement, { color: brand.accent }]}>{movement}</Text> : null}</View><Text style={styles.adPage}>{ad.pages.length > 0 ? ad.pages.join("\n") : text(language, "Sem página informada", "Sin página informada")}</Text><Text style={styles.adMoney}>{formatMoney(ad.spend, ad.currency, language)}</Text><Text style={styles.adLeads}>{formatNumber(ad.leads, language)}</Text><Text style={styles.adMoney}>{formatMoney(ad.cost_per_lead, ad.currency, language)}</Text></View>;
  })}</View>;
}
function bestCreatives(ads: TrafficAdInTest[]): TrafficAdInTest[] {
  return [...ads].filter((ad) => ad.leads > 0).sort((a, b) => b.leads - a.leads || (a.cost_per_lead ?? Number.POSITIVE_INFINITY) - (b.cost_per_lead ?? Number.POSITIVE_INFINITY) || b.spend - a.spend).slice(0, 3);
}

// DOCUMENT_CONTINUE
export function TrafficSummaryPdf({
  source,
  brand,
  language,
  adsInTest,
  logoDataUri,
}: {
  source: TrafficSummarySource;
  brand: MarcaDeSaida;
  language: Language;
  adsInTest?: TrafficAdInTest[];
  logoDataUri?: string | null;
}): React.ReactElement {
  const groups = buildTrafficSummaryGroups(source);
  const ads = adsInTest ?? buildTrafficAdsInTest(source);
  const creatives = bestCreatives(ads);
  const deliverySections = buildTrafficDeliverySections(source.delivery, language);
  const hasDelivery = deliverySections.some((section) => section.items.length > 0);
  const primaryGroup = [...groups]
    .filter((group) => group.currency && group.spend != null)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0] ?? groups[0];
  const improvementPoints = primaryGroup
    ? buildImprovementPoints(primaryGroup, source.delivery?.pages.length ?? 0, language)
    : [];
  const clientName = source.organization_name?.trim() || brand.nome;
  const objective = source.objective?.trim() || defaultTrafficObjective(source.model ?? "leads", language);
  const hasCrm =
    source.crm.leads_entered > 0 ||
    source.crm.in_service > 0 ||
    source.crm.closed_won > 0 ||
    (source.crm.closed_lost ?? 0) > 0;
  const showPlatformPages = hasMultipleDeliveredPlatforms(source);

  return (
    <Document>
      <Page size={PAGE_SIZE} style={[styles.page, styles.cover]}>
        <View style={[styles.coverAccent, { backgroundColor: brand.accent }]} />
        {logoDataUri ? <Image src={logoDataUri} style={styles.coverLogo} /> : null}
        <View style={styles.coverContent}>
          <Text style={[styles.coverEyebrow, { color: brand.accent }]}>
            {text(language, "RELATÓRIO", "INFORME")}
          </Text>
          <Text style={styles.coverClient}>{clientName}</Text>
          <Text style={styles.coverPeriod}>{formatPeriod(source.window, language)}</Text>
        </View>
      </Page>

      {source.currencies.map((currencyGroup) => {
        const shares = buildPlatformInvestmentShares(currencyGroup.platforms ?? []);
        return (
          <Page key={`summary-${currencyGroup.currency}`} size={PAGE_SIZE} style={styles.page}>
            <PageHeader
              title={text(language, "Resumo", "Resumen")}
              subtitle={formatPeriod(source.window, language)}
              brand={brand}
              logoDataUri={logoDataUri}
            />
            <View style={styles.objective}>
              <Text style={styles.objectiveLabel}>{text(language, "Objetivo", "Objetivo")}</Text>
              <Text style={styles.objectiveText}>{objective}</Text>
            </View>
            {shares.length > 0 ? (
              <>
                <Text style={styles.currencyLabel}>
                  {text(language, "Trabalhamos a publicidade digital em:", "Trabajamos la publicidad digital en:")}
                  {source.currencies.length > 1 ? ` ${currencyGroup.currency}` : ""}
                </Text>
                <View style={styles.sharesRow}>
                  {shares.map((share) => (
                    <View key={share.platform} style={styles.shareCard}>
                      <View style={[styles.shareCircle, { backgroundColor: tint(brand.accent, 0.82) }]}>
                        <Text style={[styles.sharePercent, { color: brand.accentFg }]}>
                          {formatPercentNumber(share.percent, language)}%
                        </Text>
                      </View>
                      <Text style={styles.sharePlatform}>
                        {share.platform === "meta_ads" ? "Meta Ads" : "Google Ads"}
                      </Text>
                      <Text style={styles.shareSpend}>{formatMoney(share.spend, currencyGroup.currency, language)}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.currencyLabel}>{text(language, "Sem investimento por plataforma no período.", "Sin inversión por plataforma en el período.")}</Text>
            )}
            {/* Fase 2: mostrar a segmentação por plataforma quando o Windsor fornecer esse dado. */}
          </Page>
        );
      })}

      {source.currencies.map((currencyGroup) => (
        <MetricsPage
          key={`all-${currencyGroup.currency}`}
          title={text(language, "Resultados / Todas as mídias", "Resultados / Todos los medios")}
          subtitle={`${formatPeriod(source.window, language)} · ${currencyGroup.currency}`}
          current={currencyGroup.summary}
          previous={currencyGroup.comparison}
          currency={currencyGroup.currency}
          brand={brand}
          logoDataUri={logoDataUri}
          language={language}
        />
      ))}

      {(source.historico ?? [])
        .filter((series) => series.periods.some((period) => period.spend != null || period.leads != null || period.cost_per_lead != null))
        .map((series) => (
          <HistoricoPage
            key={`historico-${series.currency}`}
            series={series}
            brand={brand}
            logoDataUri={logoDataUri}
            language={language}
          />
        ))}

      {showPlatformPages ? source.currencies.flatMap((currencyGroup) =>
        (currencyGroup.platforms ?? [])
          .filter(platformHasDelivery)
          .map((platform) => (
            <MetricsPage
              key={`${currencyGroup.currency}-${platform.platform}`}
              title={platform.platform === "meta_ads" ? "Meta Ads" : "Google Ads"}
              subtitle={`${formatPeriod(source.window, language)} · ${currencyGroup.currency}`}
              current={platform}
              previous={platform.comparison}
              currency={currencyGroup.currency}
              platform={platform.platform}
              brand={brand}
              logoDataUri={logoDataUri}
              language={language}
            />
          )),
      ) : null}

      {hasCrm && primaryGroup ? (
        <CrmPage
          source={source}
          group={primaryGroup}
          brand={brand}
          logoDataUri={logoDataUri}
          language={language}
        />
      ) : null}

      {creatives.length > 0 ? (
        <Page size={PAGE_SIZE} style={styles.page}>
          <PageHeader
            title={text(language, "Melhores criativos", "Mejores creativos")}
            subtitle={text(language, "Os 3 anúncios com melhor entrega de contatos", "Los 3 anuncios con mejor entrega de contactos")}
            brand={brand}
            logoDataUri={logoDataUri}
          />
          <View style={styles.creativeGrid}>
            {creatives.map((creative) => (
              <View key={creative.key} style={styles.creativeCard}>
                {creative.thumbnail_data_uri ? (
                  <Image src={creative.thumbnail_data_uri} style={styles.creativeImage} />
                ) : (
                  <View style={styles.creativeFallback}>
                    <Text style={styles.creativeName}>{limparNomeParaPdf(creative.name)}</Text>
                  </View>
                )}
                <View style={styles.creativeBody}>
                  <Text style={styles.creativeName}>{limparNomeParaPdf(creative.name)}</Text>
                  <View style={styles.creativeMetrics}>
                    <View><Text style={styles.creativeValue}>{formatNumber(creative.leads, language)}</Text><Text style={styles.creativeLabel}>Leads</Text></View>
                    <View><Text style={styles.creativeValue}>{formatMoney(creative.cost_per_lead, creative.currency, language)}</Text><Text style={styles.creativeLabel}>CPL</Text></View>
                  </View>
                  {creative.pages.length > 0 ? <Text style={styles.creativePage}>{creative.pages.join("\n")}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </Page>
      ) : null}

      {hasDelivery || improvementPoints.length > 0 ? (
        <Page size={PAGE_SIZE} style={styles.page}>
          <PageHeader
            title={text(language, "O que está rodando", "Lo que está activo")}
            subtitle={text(language, "Campanhas e páginas acompanhadas no período", "Campañas y páginas acompañadas en el período")}
            brand={brand}
            logoDataUri={logoDataUri}
          />
          {hasDelivery ? (
            <View style={styles.deliveryColumns}>
              {deliverySections.filter((section) => section.items.length > 0).map((section) => (
                <View key={section.title} style={styles.deliverySection}>
                  <Text style={styles.deliverySectionTitle}>{section.title}</Text>
                  {section.items.map((item) => <Text key={item} style={styles.deliveryRow}>{item}</Text>)}
                </View>
              ))}
            </View>
          ) : null}
          {improvementPoints.length > 0 ? (
            <View style={styles.improvement}>
              <Text style={styles.improvementTitle}>{text(language, "Pontos de melhoria", "Puntos de mejora")}</Text>
              {improvementPoints.map((point) => <Text key={point} style={styles.improvementItem}>• {point}</Text>)}
            </View>
          ) : null}
        </Page>
      ) : null}

      {ads.length > 0 ? (
        <Page size={PAGE_SIZE} style={[styles.page, styles.adsPage]} wrap>
          <AdsPageHeader brand={brand} logoDataUri={logoDataUri} language={language} />
          <AdsTableHeader language={language} />
          <AdsTable ads={ads} brand={brand} language={language} />
        </Page>
      ) : null}

      {source.lead_profile && source.lead_profile.considered_leads >= 5 && source.lead_profile.fields.length > 0 ? (
        <Page size={PAGE_SIZE} style={styles.page}>
          <PageHeader
            title={text(language, "Perfil dos leads", "Perfil de los leads")}
            subtitle={formatPeriod(source.window, language)}
            brand={brand}
            logoDataUri={logoDataUri}
          />
          <Text style={styles.profileIntro}>
            {text(language, `${source.lead_profile.considered_leads} pessoas com respostas consideradas no formulário.`, `${source.lead_profile.considered_leads} personas con respuestas consideradas en el formulario.`)}
          </Text>
          <View style={styles.profileGrid}>
            {source.lead_profile.fields.map((field) => (
              <View key={field.key} style={styles.profileCard}>
                <Text style={[styles.profilePercent, { color: brand.accent }]}>{formatPercentNumber(field.top_percent, language)}%</Text>
                <Text style={styles.profileValue}>{field.top_value}</Text>
                <Text style={styles.profileLabel}>{field.label} · {field.answered} {text(language, "respostas", "respuestas")}</Text>
              </View>
            ))}
          </View>
        </Page>
      ) : null}
      {/* Fase 2: acrescentar as melhores palavras-chave após integrar termos de pesquisa do Google. */}
    </Document>
  );
}

export async function renderTrafficSummaryPdf(args: {
  source: TrafficSummarySource;
  brand: MarcaDeSaida;
  language: Language;
  thumbnailDependencies?: ThumbnailDependencies;
}): Promise<Buffer> {
  const ads = buildTrafficAdsInTest(args.source);
  const prepared = await preloadPdfThumbnails(ads.slice(0, 12), args.thumbnailDependencies);
  const adsInTest: TrafficAdInTest[] = [
    ...prepared,
    ...ads.slice(12).map((ad) => ({ ...ad, thumbnail_data_uri: null })),
  ];
  const logoDataUri = args.brand.logoUrl
    ? await fetchPdfThumbnailDataUri(args.brand.logoUrl, args.thumbnailDependencies)
    : null;
  const documentProps = {
    source: args.source,
    brand: args.brand,
    language: args.language,
    logoDataUri,
  };
  try {
    return (await renderToBuffer(
      <TrafficSummaryPdf {...documentProps} adsInTest={adsInTest} />,
    )) as Buffer;
  } catch (error) {
    if (!adsInTest.some((ad) => ad.thumbnail_data_uri) && !logoDataUri) throw error;
    const withoutImages = adsInTest.map((ad) => ({ ...ad, thumbnail_data_uri: null }));
    return (await renderToBuffer(
      <TrafficSummaryPdf {...documentProps} logoDataUri={null} adsInTest={withoutImages} />,
    )) as Buffer;
  }
}
