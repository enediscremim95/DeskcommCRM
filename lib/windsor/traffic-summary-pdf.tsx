import {
  Document,
  Page,
  Polygon,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";

import type { MarcaDeSaida } from "@/lib/branding/saida";
import type { TrafficDelivery, TrafficDeliveryCampaign } from "@/lib/windsor/delivery";
import {
  PRIORITY_METRIC_META,
  priorityMetricValue,
  validPriorityMetrics,
  type PriorityMetricColumn,
  type PriorityMetricValues,
} from "@/lib/windsor/priority-metrics";
import type { DashboardModel } from "@/lib/windsor/types";

export type TrafficSummarySource = {
  model?: DashboardModel;
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
  currencies: Array<{
    currency: string;
    summary: PriorityMetricValues & {
      reach: number | null;
      impressions: number;
      clicks: number;
    };
    comparison?: PriorityMetricValues & {
      reach: number | null;
      impressions: number;
      clicks: number;
    } | null;
    campaigns?: Array<{
      name: string;
      leads: number;
      cost_per_lead: number | null;
      conversion_rate: number | null;
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
    return [
      {
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
      },
    ];
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
      mediaKind:
        group.summary.reach != null
          ? "reach" as const
          : group.summary.impressions > 0
            ? "impressions" as const
            : "unavailable" as const,
      inService: source.crm.in_service,
      closedWon: source.crm.closed_won,
      closedLost: source.crm.closed_lost ?? 0,
      previous: {
        spend: group.comparison?.spend ?? null,
        reach: group.comparison?.reach ?? null,
        clicks: group.comparison?.clicks ?? null,
        leads: previousLeads,
        costPerLead:
          group.comparison && previousLeads != null && previousLeads > 0
            ? group.comparison.spend / previousLeads
            : null,
        inService: source.crm.previous?.in_service ?? null,
        closedWon: source.crm.previous?.closed_won ?? null,
        closedLost: source.crm.previous?.closed_lost ?? null,
      },
    };
  });
}

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: "Helvetica", fontSize: 9, color: "#17211a" },
  header: { borderBottomWidth: 2, paddingBottom: 10, marginBottom: 14 },
  brand: { fontSize: 18, fontWeight: "bold" },
  title: { marginTop: 3, fontSize: 11, fontWeight: "bold" },
  muted: { marginTop: 3, color: "#66736a", fontSize: 8 },
  group: { marginBottom: 13, borderWidth: 1, borderColor: "#dce4de", borderRadius: 7 },
  groupHeader: { padding: 7, fontSize: 10, fontWeight: "bold" },
  metrics: { flexDirection: "row", padding: 7, gap: 5 },
  metric: { flex: 1, borderWidth: 1, borderColor: "#e5ebe6", borderRadius: 5, padding: 6 },
  metricLabel: { color: "#66736a", fontSize: 7, textTransform: "uppercase" },
  metricValue: { marginTop: 3, fontSize: 12, fontWeight: "bold" },
  metricComparison: { marginTop: 2, color: "#66736a", fontSize: 6.5 },
  drawing: { alignItems: "center", paddingTop: 6, paddingBottom: 12 },
  levelLabel: {
    marginTop: 4,
    marginBottom: 3,
    color: "#66736a",
    fontSize: 6.5,
    fontWeight: "bold",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  trapezoid: { position: "relative", alignItems: "center", justifyContent: "center" },
  trapezoidSvg: { position: "absolute", top: 0, left: 0 },
  trapezoidValue: { fontSize: 15, fontWeight: "bold", textAlign: "center" },
  trapezoidLegend: { marginTop: 1, fontSize: 7, textAlign: "center" },
  pill: {
    marginVertical: 4,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  pillFrom: { color: "#66736a", fontSize: 7, textAlign: "center" },
  pillToRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  pillTo: { fontSize: 8, fontWeight: "bold", textAlign: "center" },
  costBox: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 22,
    borderRadius: 8,
    alignItems: "center",
  },
  costValue: { fontSize: 18, fontWeight: "bold" },
  costLabel: { marginTop: 2, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 1 },
  delivery: {
    marginTop: 2,
    borderWidth: 1,
    borderColor: "#dce4de",
    borderRadius: 7,
    padding: 10,
  },
  deliveryTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 7 },
  deliverySection: { marginTop: 7 },
  deliverySectionTitle: { fontSize: 9, fontWeight: "bold", marginBottom: 3 },
  deliveryItem: { color: "#344139", fontSize: 8, marginTop: 2 },
  deliveryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderColor: "#eef2ef",
  },
  deliveryName: { flex: 1, color: "#344139", fontSize: 8, maxLines: 1, textOverflow: "ellipsis" },
  deliveryPlatform: { color: "#66736a", fontSize: 7, textTransform: "uppercase" },
  insightGrid: { flexDirection: "row", gap: 7, marginTop: 6 },
  insightColumn: { flex: 1 },
  situationMetrics: { flexDirection: "row", gap: 5, marginBottom: 6 },
  championGrid: { flexDirection: "row", gap: 5, paddingHorizontal: 7, paddingBottom: 7 },
  championCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 5,
    paddingVertical: 6,
    paddingHorizontal: 7,
    minHeight: 54,
  },
  championLabel: { color: "#66736a", fontSize: 7, textTransform: "uppercase" },
  championName: { marginTop: 4, fontSize: 8, fontWeight: "bold" },
  championValue: { marginTop: 3, fontSize: 11, fontWeight: "bold" },
});

/** Largura do topo do funil e quanto cada nível afina, em pontos. */
const FUNNEL_WIDTH = 400;
const FUNNEL_STEP = 60;
const FUNNEL_STAGE_HEIGHT = 46;

function parseHex(color: string): [number, number, number] | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** Mistura a cor da marca com branco: `amount` 1 = cor pura, 0 = branco. */
function tint(color: string, amount: number): string {
  const rgb = parseHex(color) ?? [37, 99, 235];
  const channel = (value: number) => Math.round(255 - (255 - value) * amount);
  return `#${rgb.map((value) => channel(value).toString(16).padStart(2, "0")).join("")}`;
}

type Language = "pt-BR" | "es";

function text(language: Language, pt: string, es: string): string {
  return language === "es" ? es : pt;
}

function formatNumber(value: number | null, language: Language): string {
  if (value == null) return text(language, "Não disponível", "No disponible");
  return new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoney(value: number | null, currency: string | null, language: Language): string {
  if (value == null || !currency) return text(language, "Não disponível", "No disponible");
  return new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

type TrafficCampaign = NonNullable<TrafficSummarySource["currencies"][number]["campaigns"]>[number];

export type TrafficCampaignChampion = {
  label: string;
  campaignName: string;
  value: string | null;
};

function eligibleCampaigns(
  campaigns: TrafficCampaign[],
  minimumLeads: number,
  metric: (campaign: TrafficCampaign) => number | null,
  direction: "asc" | "desc",
): TrafficCampaign[] {
  return campaigns
    .filter((campaign) => {
      const value = metric(campaign);
      return (
        campaign.name.trim().length > 0 &&
        Number.isFinite(campaign.leads) &&
        campaign.leads >= minimumLeads &&
        value != null &&
        Number.isFinite(value) &&
        value >= 0
      );
    })
    .sort((a, b) => {
      const aValue = metric(a) ?? 0;
      const bValue = metric(b) ?? 0;
      const difference = direction === "asc" ? aValue - bValue : bValue - aValue;
      return difference || a.name.localeCompare(b.name, "pt-BR");
    });
}

export function buildTrafficCampaignChampions(
  campaigns: TrafficCampaign[],
  currency: string | null,
  language: Language,
): TrafficCampaignChampion[] {
  const insufficient = text(language, "Sem dados suficientes", "Sin datos suficientes");
  const card = (
    label: string,
    winner: TrafficCampaign | undefined,
    value: (campaign: TrafficCampaign) => string,
  ): TrafficCampaignChampion => ({
    label,
    campaignName: winner?.name ?? insufficient,
    value: winner ? value(winner) : null,
  });
  const mostLeads = eligibleCampaigns(campaigns, 0, (campaign) => campaign.leads, "desc")[0];
  const lowestCost = eligibleCampaigns(
    campaigns,
    20,
    (campaign) => campaign.cost_per_lead,
    "asc",
  )[0];
  const bestConversion = eligibleCampaigns(
    campaigns,
    40,
    (campaign) => campaign.conversion_rate,
    "desc",
  )[0];

  return [
    card(text(language, "Mais leads", "Más leads"), mostLeads, (campaign) =>
      `${formatNumber(campaign.leads, language)} leads`,
    ),
    card(text(language, "Menor custo por lead", "Menor costo por lead"), lowestCost, (campaign) =>
      formatMoney(campaign.cost_per_lead, currency, language),
    ),
    card(text(language, "Melhor conversão", "Mejor conversión"), bestConversion, (campaign) =>
      `${formatPercentNumber(campaign.conversion_rate ?? 0, language)}%`,
    ),
  ];
}

function formatPeriod(window: TrafficSummarySource["window"], language: Language): string {
  const formatter = new Intl.DateTimeFormat(language === "es" ? "es-ES" : "pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const from = formatter.format(new Date(`${window.from}T12:00:00Z`));
  const to = formatter.format(new Date(`${window.to}T12:00:00Z`));
  return text(language, `${from} a ${to}`, `${from} al ${to}`);
}

function formatPercent(value: number, language: Language): string {
  const digits = value < 0.1 ? 2 : 1;
  return new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercentNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** `legend` fica sob o número; `from` completa "De N ..." na pílula de passagem. */
type DrawnStage = { value: number | null; legend: string; from: string };

function Trapezoid({
  level,
  fill,
  color,
  value,
  legend,
}: {
  level: number;
  fill: string;
  color: string;
  value: string;
  legend: string;
}) {
  const top = FUNNEL_WIDTH - level * FUNNEL_STEP;
  const bottom = top - FUNNEL_STEP;
  const insetTop = (FUNNEL_WIDTH - top) / 2;
  const insetBottom = (FUNNEL_WIDTH - bottom) / 2;
  const points = [
    `${insetTop},0`,
    `${FUNNEL_WIDTH - insetTop},0`,
    `${FUNNEL_WIDTH - insetBottom},${FUNNEL_STAGE_HEIGHT}`,
    `${insetBottom},${FUNNEL_STAGE_HEIGHT}`,
  ].join(" ");
  return (
    <View style={[styles.trapezoid, { width: FUNNEL_WIDTH, height: FUNNEL_STAGE_HEIGHT }]}>
      <Svg
        style={styles.trapezoidSvg}
        width={FUNNEL_WIDTH}
        height={FUNNEL_STAGE_HEIGHT}
        viewBox={`0 0 ${FUNNEL_WIDTH} ${FUNNEL_STAGE_HEIGHT}`}
      >
        <Polygon points={points} fill={fill} />
      </Svg>
      <Text style={[styles.trapezoidValue, { color }]}>{value}</Text>
      <Text style={[styles.trapezoidLegend, { color }]}>{legend}</Text>
    </View>
  );
}

function PassagePill({
  from,
  to,
  accent,
  language,
}: {
  from: DrawnStage;
  to: DrawnStage;
  accent: string;
  language: Language;
}) {
  const rate =
    from.value != null && from.value > 0 && to.value != null ? to.value / from.value : null;
  return (
    <View style={[styles.pill, { borderColor: tint(accent, 0.35) }]}>
      {from.value != null ? (
        <Text style={styles.pillFrom}>
          {text(language, "De", "De")} {formatNumber(from.value, language)} {from.from}
        </Text>
      ) : null}
      <View style={styles.pillToRow}>
        <Svg width={7} height={5} viewBox="0 0 7 5">
          <Polygon points="0,0 7,0 3.5,5" fill={accent} />
        </Svg>
        <Text style={[styles.pillTo, { color: accent }]}>
          {formatNumber(to.value, language)} {to.legend}
          {rate != null ? ` (${formatPercent(rate, language)})` : ""}
        </Text>
      </View>
    </View>
  );
}

function FunnelDrawing({
  group,
  brand,
  language,
}: {
  group: TrafficSummaryGroup;
  brand: MarcaDeSaida;
  language: Language;
}) {
  const media: DrawnStage =
    group.mediaKind === "reach"
      ? {
          value: group.mediaValue,
          legend: text(language, "pessoas viram o anúncio", "personas vieron el anuncio"),
          from: text(language, "que viram o anúncio", "que vieron el anuncio"),
        }
      : group.mediaKind === "impressions"
        ? {
            value: group.mediaValue,
            legend: text(language, "vezes o anúncio apareceu", "veces apareció el anuncio"),
            from: text(language, "vezes que o anúncio apareceu", "veces que apareció el anuncio"),
          }
        : {
            value: null,
            legend: text(language, "sem dados de mídia", "sin datos de medios"),
            from: "",
          };
  const stages: DrawnStage[] = [
    media,
    {
      value: group.clicks,
      legend: text(language, "clicaram no anúncio", "hicieron clic en el anuncio"),
      from: text(language, "que clicaram no anúncio", "que hicieron clic en el anuncio"),
    },
    {
      value: group.leads,
      legend: text(language, "viraram leads no CRM", "se volvieron leads en el CRM"),
      from: text(language, "que viraram leads no CRM", "que se volvieron leads en el CRM"),
    },
    {
      value: group.closedWon,
      legend: text(language, "fecharam a venda", "cerraron la venta"),
      from: "",
    },
  ];
  const levelLabels: Record<number, string> = {
    0: text(language, "Topo · Descoberta", "Arriba · Descubrimiento"),
    1: text(language, "Meio · Interesse", "Medio · Interés"),
    2: text(language, "Fundo · Ação", "Fondo · Acción"),
  };
  const tints = [0.22, 0.48, 0.72, 1];

  return (
    <View style={styles.drawing} wrap={false}>
      {stages.map((stage, level) => {
        const amount = tints[level] ?? 1;
        const color = amount >= 0.58 ? brand.accentFg : "#17211a";
        const next = stages[level + 1];
        return (
          <React.Fragment key={level}>
            {levelLabels[level] ? <Text style={styles.levelLabel}>{levelLabels[level]}</Text> : null}
            <Trapezoid
              level={level}
              fill={tint(brand.accent, amount)}
              color={color}
              value={formatNumber(stage.value, language)}
              legend={stage.legend}
            />
            {next ? (
              <PassagePill from={stage} to={next} accent={brand.accent} language={language} />
            ) : null}
          </React.Fragment>
        );
      })}
      <View style={[styles.costBox, { backgroundColor: tint(brand.accent, 0.12) }]}>
        <Text style={[styles.costValue, { color: brand.accent }]}>
          {formatMoney(group.costPerLead, group.currency, language)}
        </Text>
        <Text style={[styles.costLabel, { color: brand.accent }]}>
          {text(language, "por lead", "por lead")}
        </Text>
      </View>
    </View>
  );
}

export type TrafficVariation =
  | { kind: "unavailable"; percent: null }
  | { kind: "new"; percent: null }
  | { kind: "percent"; percent: number };

export function trafficVariation(
  current: number | null,
  previous: number | null | undefined,
): TrafficVariation {
  if (current == null || previous == null) return { kind: "unavailable", percent: null };
  if (previous === 0) {
    return current === 0 ? { kind: "percent", percent: 0 } : { kind: "new", percent: null };
  }
  return { kind: "percent", percent: ((current - previous) / Math.abs(previous)) * 100 };
}

function formatVariation(
  current: number | null,
  previous: number | null | undefined,
  language: Language,
): string | null {
  const variation = trafficVariation(current, previous);
  if (variation.kind === "unavailable") return null;
  if (variation.kind === "new") {
    return text(language, "novo vs. período anterior", "nuevo vs. período anterior");
  }
  const value = variation.percent;
  const signal = value > 0 ? "+" : "";
  return `${signal}${new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", {
    maximumFractionDigits: 1,
  }).format(value)}% ${text(language, "vs. período anterior", "vs. período anterior")}`;
}

export type TrafficPriorityMetricCard = {
  key: PriorityMetricColumn;
  label: string;
  value: string;
  comparison: string | null;
};

export function buildTrafficPriorityMetricCards(
  source: TrafficSummarySource,
  currencyIndex: number,
  language: Language,
): TrafficPriorityMetricCard[] {
  const model = source.model ?? "leads";
  const selected = validPriorityMetrics(source.priority_metrics, model);
  const currencyGroup = source.currencies[currencyIndex];
  const currentSummary = currencyGroup?.summary;
  const previousSummary = currencyGroup?.comparison ?? null;
  const closedWon = source.crm.closed_won;
  const previousClosedWon = source.crm.previous?.closed_won;

  return selected.map((metric) => {
    const meta = PRIORITY_METRIC_META[metric];
    const current = currentSummary
      ? priorityMetricValue(metric, currentSummary, closedWon)
      : metric === "crm_closed_won"
        ? closedWon
        : null;
    let previous: number | null | undefined;
    if (metric === "crm_closed_won") {
      previous = previousClosedWon;
    } else if (previousSummary) {
      previous = priorityMetricValue(metric, previousSummary, previousClosedWon ?? 0);
    }
    const value = (() => {
      if (meta.format === "money") {
        return formatMoney(current, currencyGroup?.currency ?? null, language);
      }
      if (meta.format === "percent") {
        return current == null ? "0%" : `${formatPercentNumber(current, language)}%`;
      }
      if (meta.format === "ratio") {
        return current == null ? "0x" : `${formatNumber(current, language)}x`;
      }
      return formatNumber(current, language);
    })();
    return {
      key: metric,
      label: language === "es" ? meta.labelEs : meta.label,
      value,
      comparison: formatVariation(current, previous, language),
    };
  });
}

function Metric({
  label,
  value,
  comparison,
}: {
  label: string;
  value: string;
  comparison?: string | null;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {comparison ? <Text style={styles.metricComparison}>{comparison}</Text> : null}
    </View>
  );
}


const DELIVERY_LIMIT = 10;

export type TrafficDeliverySection = { title: string; items: string[] };

function campaignPlatform(platform: TrafficDeliveryCampaign["platform"]): string {
  return platform === "meta_ads" ? "Meta" : "Google";
}

function limitedItems(items: string[], language: Language): string[] {
  const visible = items.slice(0, DELIVERY_LIMIT);
  const remaining = items.length - visible.length;
  return remaining > 0
    ? [...visible, text(language, `e mais ${remaining}`, `y ${remaining} más`)]
    : visible;
}

export function buildTrafficDeliverySections(
  delivery: TrafficDelivery | undefined,
  language: Language,
): TrafficDeliverySection[] {
  const active = delivery?.active_campaigns ?? [];
  const invested = delivery?.invested_campaigns ?? [];
  const pages = delivery?.pages ?? [];
  const campaignItems = (campaigns: TrafficDeliveryCampaign[]) =>
    limitedItems(
      campaigns.map((campaign) => `${campaign.name} · ${campaignPlatform(campaign.platform)}`),
      language,
    );
  const activeTitle = text(
    language,
    `Hoje: ${active.length} ${active.length === 1 ? "campanha ativa" : "campanhas ativas"}`,
    `Hoy: ${active.length} ${active.length === 1 ? "campaña activa" : "campañas activas"}`,
  );
  const investedTitle = text(
    language,
    `${invested.length} ${invested.length === 1 ? "campanha com investimento no período" : "campanhas com investimento no período"}`,
    `${invested.length} ${invested.length === 1 ? "campaña con inversión en el período" : "campañas con inversión en el período"}`,
  );
  const pagesTitle = text(
    language,
    `${pages.length} ${pages.length === 1 ? "página em teste" : "páginas em teste"}`,
    `${pages.length} ${pages.length === 1 ? "página en prueba" : "páginas en prueba"}`,
  );
  return [
    { title: activeTitle, items: campaignItems(active) },
    ...(invested.length > 0 ? [{ title: investedTitle, items: campaignItems(invested) }] : []),
    { title: pagesTitle, items: limitedItems(pages, language) },
  ];
}

/**
 * Pontos de melhoria tirados dos próprios números, curtos e objetivos (pedido do dono,
 * 21/09/2026: "com base nos dados... não enfeita muito"). Só afirma "estamos testando"
 * quando o dado prova o teste (mais de uma página recebendo tráfego no período).
 */
export function buildImprovementPoints(
  group: TrafficSummaryGroup,
  pagesInTest: number,
  language: Language,
): string[] {
  const pontos: string[] = [];
  const pct = (parte: number, todo: number) =>
    `${formatPercentNumber((parte / todo) * 100, language)}%`;

  if (group.clicks >= 50 && group.leads / group.clicks < 0.1) {
    const taxa = pct(group.leads, group.clicks);
    pontos.push(
      pagesInTest >= 2
        ? text(
            language,
            `Conversão de clique em lead está em ${taxa}. Estamos testando ${pagesInTest} páginas para aumentar.`,
            `La conversión de clic en lead está en ${taxa}. Estamos probando ${pagesInTest} páginas para aumentarla.`,
          )
        : text(
            language,
            `Conversão de clique em lead está em ${taxa}. Próximo passo: testar outra página.`,
            `La conversión de clic en lead está en ${taxa}. Próximo paso: probar otra página.`,
          ),
    );
  }
  if (group.mediaValue && group.mediaValue >= 1000 && group.clicks / group.mediaValue < 0.01) {
    const taxa = pct(group.clicks, group.mediaValue);
    pontos.push(
      text(
        language,
        `Taxa de clique está em ${taxa}. Próximo passo: testar novos criativos.`,
        `La tasa de clic está en ${taxa}. Próximo paso: probar nuevos creativos.`,
      ),
    );
  }
  if (group.leads >= 20 && group.closedWon / group.leads < 0.05) {
    const taxa = pct(group.closedWon, group.leads);
    pontos.push(
      text(
        language,
        `Conversão de lead em venda está em ${taxa} (${formatNumber(group.closedWon, language)} de ${formatNumber(group.leads, language)}). Próximo passo: revisar o atendimento dos leads.`,
        `La conversión de lead en venta está en ${taxa} (${formatNumber(group.closedWon, language)} de ${formatNumber(group.leads, language)}). Próximo paso: revisar la atención de los leads.`,
      ),
    );
  }
  return pontos.slice(0, 3);
}

function ImprovementBlock({
  groups,
  pagesInTest,
  language,
  accent,
}: {
  groups: TrafficSummaryGroup[];
  pagesInTest: number;
  language: Language;
  accent: string;
}) {
  const pontos = groups.flatMap((group) => buildImprovementPoints(group, pagesInTest, language));
  if (pontos.length === 0) return null;
  return (
    <View style={styles.delivery} wrap={false}>
      <Text style={[styles.deliveryTitle, { color: accent }]}>
        {text(language, "Pontos de melhoria", "Puntos de mejora")}
      </Text>
      {[...new Set(pontos)].map((ponto) => (
        <Text key={ponto} style={styles.deliveryItem}>
          • {ponto}
        </Text>
      ))}
    </View>
  );
}

/** "Nome · Meta" vira { nome, plataforma }; página (sem plataforma) fica só com o nome. */
export function separarPlataforma(item: string): { nome: string; plataforma: string | null } {
  const corte = item.lastIndexOf(" · ");
  if (corte < 0) return { nome: item, plataforma: null };
  return { nome: item.slice(0, corte), plataforma: item.slice(corte + 3) };
}

/**
 * A fonte do PDF (Helvetica) não tem emoji: nome de campanha que começa com emoji saía
 * como "€P1" (print do dono, 21/09/2026). O emoji sai e sobra o nome limpo.
 */
export function limparNomeParaPdf(nome: string): string {
  return nome
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-|·]+/, "")
    .trim();
}

function DeliveryBlock({
  delivery,
  language,
  accent,
}: {
  delivery: TrafficDelivery | undefined;
  language: Language;
  accent: string;
}) {
  const sections = buildTrafficDeliverySections(delivery, language);
  return (
    <View style={styles.delivery}>
      <Text style={[styles.deliveryTitle, { color: accent }]}>
        {text(language, "O que está rodando", "Lo que está activo")}
      </Text>
      {sections.map((section) => (
        <View key={section.title} style={styles.deliverySection}>
          <Text style={styles.deliverySectionTitle}>{section.title}</Text>
          {section.items.map((item) => {
            const { nome, plataforma } = separarPlataforma(item);
            return (
              <View key={item} style={styles.deliveryRow} wrap={false}>
                <Text style={styles.deliveryName}>{limparNomeParaPdf(nome)}</Text>
                {plataforma ? <Text style={styles.deliveryPlatform}>{plataforma}</Text> : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function changeSentence(
  language: Language,
  labelPt: string,
  labelEs: string,
  current: number,
  previous: number,
): string {
  const variation = trafficVariation(current, previous);
  const label = text(language, labelPt, labelEs);
  if (variation.kind === "new") {
    return text(
      language,
      `${label}: ${formatNumber(current, language)}, sem ocorrência no período anterior.`,
      `${label}: ${formatNumber(current, language)}, sin ocurrencias en el período anterior.`,
    );
  }
  const percent = variation.kind === "percent" ? variation.percent : 0;
  if (percent === 0) {
    return text(
      language,
      `${label} permaneceu em ${formatNumber(current, language)}.`,
      `${label} se mantuvo en ${formatNumber(current, language)}.`,
    );
  }
  const signedPercent = `${percent > 0 ? "+" : "-"}${formatPercentNumber(Math.abs(percent), language)}%`;
  return text(
    language,
    `${label}: ${signedPercent}, de ${formatNumber(previous, language)} para ${formatNumber(current, language)}.`,
    `${label}: ${signedPercent}, de ${formatNumber(previous, language)} a ${formatNumber(current, language)}.`,
  );
}

export function buildTrafficHighlights(
  source: TrafficSummarySource,
  groups: TrafficSummaryGroup[],
  language: Language,
): string[] {
  const highlights: string[] = [];
  const previous = source.crm.previous;
  if (previous) {
    highlights.push(
      changeSentence(
        language,
        "Entrada de leads",
        "Entrada de leads",
        source.crm.leads_entered,
        previous.leads_entered,
      ),
    );
  }

  const primary = [...groups]
    .filter((group) => group.currency != null && group.spend != null)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];
  if (primary?.costPerLead != null && primary.previous.costPerLead != null) {
    const variation = trafficVariation(primary.costPerLead, primary.previous.costPerLead);
    if (variation.kind === "percent" && variation.percent !== 0) {
      highlights.push(
        text(
          language,
          `Custo por lead ${variation.percent < 0 ? "melhorou" : "aumentou"} ${formatPercentNumber(Math.abs(variation.percent), language)}%, para ${formatMoney(primary.costPerLead, primary.currency, language)}.`,
          `El costo por lead ${variation.percent < 0 ? "mejoró" : "aumentó"} ${formatPercentNumber(Math.abs(variation.percent), language)}%, a ${formatMoney(primary.costPerLead, primary.currency, language)}.`,
        ),
      );
    }
  }

  if (previous) {
    highlights.push(
      changeSentence(
        language,
        "Vendas ganhas",
        "Ventas ganadas",
        source.crm.closed_won,
        previous.closed_won,
      ),
    );
  }

  const topLossReason = source.crm.loss_reasons?.[0];
  if (topLossReason && (source.crm.closed_lost ?? 0) > 0) {
    const share = topLossReason.count / (source.crm.closed_lost ?? 1);
    highlights.push(
      text(
        language,
        `Principal motivo de perda: ${topLossReason.reason}, ${formatPercent(share, language)} das perdas.`,
        `Principal motivo de pérdida: ${topLossReason.reason}, ${formatPercent(share, language)} de las pérdidas.`,
      ),
    );
  }
  return highlights.slice(0, 4);
}

export function buildTrafficFunnelReading(
  groups: TrafficSummaryGroup[],
  language: Language,
): string[] {
  const primary = [...groups]
    .filter((group) => group.mediaValue != null || group.leads > 0)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))[0];
  if (!primary) return [];

  const mediaLabel =
    primary.mediaKind === "reach"
      ? text(language, "visualização do anúncio", "visualización del anuncio")
      : text(language, "impressão", "impresión");
  const transitions = [
    { from: primary.mediaValue, to: primary.clicks, fromLabel: mediaLabel, toLabel: text(language, "clique", "clic") },
    { from: primary.clicks, to: primary.leads, fromLabel: text(language, "clique", "clic"), toLabel: "lead" },
    { from: primary.leads, to: primary.closedWon, fromLabel: "lead", toLabel: text(language, "venda", "venta") },
  ]
    .filter((item): item is { from: number; to: number; fromLabel: string; toLabel: string } =>
      item.from != null && item.from > 0,
    )
    .map((item) => ({ ...item, rate: item.to / item.from }));
  const bottleneck = [...transitions].sort((a, b) => a.rate - b.rate)[0];
  const readings: string[] = [];
  if (bottleneck) {
    readings.push(
      text(
        language,
        `Maior estreitamento: ${bottleneck.fromLabel} para ${bottleneck.toLabel}, com ${formatPercent(bottleneck.rate, language)} de passagem.`,
        `Mayor estrechamiento: ${bottleneck.fromLabel} a ${bottleneck.toLabel}, con ${formatPercent(bottleneck.rate, language)} de paso.`,
      ),
    );
  }
  if (primary.leads > 0) {
    readings.push(
      text(
        language,
        `Conversão de lead em venda: ${formatPercent(primary.closedWon / primary.leads, language)} (${formatNumber(primary.closedWon, language)} de ${formatNumber(primary.leads, language)}).`,
        `Conversión de lead en venta: ${formatPercent(primary.closedWon / primary.leads, language)} (${formatNumber(primary.closedWon, language)} de ${formatNumber(primary.leads, language)}).`,
      ),
    );
  }
  return readings;
}


export function TrafficSummaryPdf({
  source,
  brand,
  language,
}: {
  source: TrafficSummarySource;
  brand: MarcaDeSaida;
  language: Language;
}): React.ReactElement {
  const groups = buildTrafficSummaryGroups(source);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={[styles.header, { borderBottomColor: brand.accent }]}>
          <Text style={styles.title}>
            {text(language, "Relatório", "Informe")}
          </Text>
          <Text style={styles.muted}>{formatPeriod(source.window, language)}</Text>
        </View>

        {groups.map((group, index) => {
          const priorityCards = buildTrafficPriorityMetricCards(source, index, language);
          return (
            <View key={group.currency ?? `crm-${index}`} style={styles.group} wrap={false}>
              <Text
                style={[
                  styles.groupHeader,
                  { backgroundColor: brand.accent, color: brand.accentFg },
                ]}
              >
                {group.currency ?? text(language, "Dados do CRM", "Datos del CRM")}
              </Text>
              <View style={styles.metrics}>
                {priorityCards.map((metric) => (
                  <Metric
                    key={metric.key}
                    label={metric.label}
                    value={metric.value}
                    comparison={metric.comparison}
                  />
                ))}
              </View>
              {/* A linha de caixinhas do funil saiu: repetia o desenho logo abaixo
                  (pedido do dono, 21/09/2026). */}
              <FunnelDrawing group={group} brand={brand} language={language} />
              {/* Sem nota de metodologia: o dono pediu um PDF macro e simples,
                  só números e funil (21/09/2026). */}
            </View>
          );
        })}
        <ImprovementBlock
          groups={groups}
          pagesInTest={source.delivery?.pages.length ?? 0}
          language={language}
          accent={brand.accent}
        />
        <DeliveryBlock delivery={source.delivery} language={language} accent={brand.accent} />
      </Page>
    </Document>
  );
}

export async function renderTrafficSummaryPdf(args: {
  source: TrafficSummarySource;
  brand: MarcaDeSaida;
  language: Language;
}): Promise<Buffer> {
  return (await renderToBuffer(<TrafficSummaryPdf {...args} />)) as Buffer;
}
