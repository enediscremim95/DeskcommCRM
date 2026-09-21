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

export type TrafficSummarySource = {
  window: { from: string; to: string };
  crm: { leads_entered: number; in_service: number; closed_won: number };
  currencies: Array<{
    currency: string;
    summary: {
      spend: number;
      reach: number | null;
      impressions: number;
      clicks: number;
    };
  }>;
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
      },
    ];
  }

  return source.currencies.map((group) => ({
    currency: group.currency,
    spend: group.summary.spend,
    reach: group.summary.reach,
    clicks: group.summary.clicks,
    leads,
    costPerLead: leads > 0 ? group.summary.spend / leads : null,
    mediaValue: group.summary.reach ?? group.summary.impressions,
    mediaKind:
      group.summary.reach != null
        ? "reach"
        : group.summary.impressions > 0
          ? "impressions"
          : "unavailable",
    inService: source.crm.in_service,
    closedWon: source.crm.closed_won,
  }));
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
      value: group.inService,
      legend: text(language, "entraram em atendimento", "entraron en atención"),
      from: text(language, "que entraram em atendimento", "que entraron en atención"),
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
    3: text(language, "Fundo · Ação", "Fondo · Acción"),
  };
  const tints = [0.22, 0.4, 0.58, 0.78, 1];

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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
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
          <Text style={styles.brand}>{brand.nome}</Text>
          <Text style={styles.title}>
            {text(language, "Relatório resumido de desempenho", "Informe resumido de rendimiento")}
          </Text>
          <Text style={styles.muted}>{formatPeriod(source.window, language)}</Text>
        </View>

        {groups.map((group, index) => {
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
                <Metric
                  label={text(language, "Investimento", "Inversión")}
                  value={formatMoney(group.spend, group.currency, language)}
                />
                <Metric
                  label={text(language, "Alcance", "Alcance")}
                  value={formatNumber(group.reach, language)}
                />
                <Metric
                  label={text(language, "Cliques", "Clics")}
                  value={formatNumber(group.clicks, language)}
                />
                <Metric label="Leads" value={formatNumber(group.leads, language)} />
                <Metric
                  label={text(language, "Custo por lead", "Costo por lead")}
                  value={formatMoney(group.costPerLead, group.currency, language)}
                />
              </View>
              {/* A linha de caixinhas do funil saiu: repetia o desenho logo abaixo
                  (pedido do dono, 21/09/2026). */}
              <FunnelDrawing group={group} brand={brand} language={language} />
              {/* Sem nota de metodologia: o dono pediu um PDF macro e simples,
                  só números e funil (21/09/2026). */}
            </View>
          );
        })}
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
