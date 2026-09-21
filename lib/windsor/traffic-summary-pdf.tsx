import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
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
  funnelTitle: { marginHorizontal: 7, marginTop: 2, fontSize: 8, fontWeight: "bold" },
  funnel: { flexDirection: "row", alignItems: "center", padding: 7, gap: 3 },
  stage: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: "#d8e3da",
    borderRadius: 5,
    padding: 5,
    justifyContent: "center",
  },
  stageLabel: { color: "#66736a", fontSize: 6.5, textAlign: "center" },
  stageValue: { marginTop: 2, fontSize: 11, fontWeight: "bold", textAlign: "center" },
  arrow: { color: "#809087", fontSize: 10 },
  note: { marginHorizontal: 7, marginBottom: 7, color: "#66736a", fontSize: 7 },
  footer: {
    position: "absolute",
    left: 30,
    right: 30,
    bottom: 20,
    paddingTop: 5,
    borderTopWidth: 1,
    borderColor: "#e5ebe6",
    color: "#7a867e",
    fontSize: 7,
  },
});

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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function FunnelStage({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stage}>
      <Text style={styles.stageLabel}>{label}</Text>
      <Text style={styles.stageValue}>{value}</Text>
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
  const moreThanOneCurrency = groups.filter((group) => group.currency).length > 1;

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
          const mediaLabel =
            group.mediaKind === "reach"
              ? text(language, "Alcance reportado", "Alcance reportado")
              : group.mediaKind === "impressions"
                ? text(language, "Impressões", "Impresiones")
                : text(language, "Mídia", "Medios");
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
              <Text style={styles.funnelTitle}>
                {text(language, "Funil do período", "Embudo del período")}
              </Text>
              <View style={styles.funnel}>
                <FunnelStage label={mediaLabel} value={formatNumber(group.mediaValue, language)} />
                <Text style={styles.arrow}>›</Text>
                <FunnelStage
                  label={text(language, "Cliques", "Clics")}
                  value={formatNumber(group.clicks, language)}
                />
                <Text style={styles.arrow}>›</Text>
                <FunnelStage
                  label={text(language, "Leads no CRM", "Leads en el CRM")}
                  value={formatNumber(group.leads, language)}
                />
                <Text style={styles.arrow}>›</Text>
                <FunnelStage
                  label={text(language, "Em atendimento", "En atención")}
                  value={formatNumber(group.inService, language)}
                />
                <Text style={styles.arrow}>›</Text>
                <FunnelStage
                  label={text(language, "Vendas fechadas", "Ventas cerradas")}
                  value={formatNumber(group.closedWon, language)}
                />
              </View>
              <Text style={styles.note}>
                {text(
                  language,
                  "Leads inclui todas as entradas no CRM no período, de qualquer origem. O custo por lead divide o investimento deste bloco por esses leads. Alcance é o valor reportado pelas plataformas e não é deduplicado entre contas ou plataformas.",
                  "Leads incluye todas las entradas en el CRM durante el período, de cualquier origen. El costo por lead divide la inversión de este bloque por esos leads. El alcance es el valor reportado por las plataformas y no se deduplica entre cuentas o plataformas.",
                )}
                {moreThanOneCurrency
                  ? text(
                      language,
                      " Os mesmos leads do CRM aparecem em cada moeda; investimentos de moedas diferentes nunca são somados.",
                      " Los mismos leads del CRM aparecen en cada moneda; las inversiones en monedas diferentes nunca se suman.",
                    )
                  : ""}
              </Text>
            </View>
          );
        })}

        <Text style={styles.footer} fixed>
          {text(
            language,
            "Gerado a partir dos dados confirmados do relatório e do CRM.",
            "Generado a partir de los datos confirmados del informe y del CRM.",
          )}
        </Text>
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
