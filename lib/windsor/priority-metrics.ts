import {
  type CampaignMetricColumn,
  type DashboardModel,
} from "@/lib/windsor/types";

const PRIORITY_TRAFFIC_METRICS = [
  "spend",
  "reach",
  "impressions",
  "link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "leads",
  "cost_per_lead",
  "messaging_conversations",
  "cost_per_messaging_conversation",
  "landing_page_views",
  "add_to_cart",
  "purchases",
  "cost_per_purchase",
  "revenue",
  "roas",
] as const satisfies readonly CampaignMetricColumn[];

export const PRIORITY_METRIC_COLUMNS = [
  ...PRIORITY_TRAFFIC_METRICS,
  "crm_closed_won",
  "cost_per_crm_closed_won",
] as const;

export type PriorityMetricColumn = (typeof PRIORITY_METRIC_COLUMNS)[number];
export type PriorityMetricFormat = "money" | "number" | "percent" | "ratio";

export const PRIORITY_METRIC_META: Record<
  PriorityMetricColumn,
  {
    label: string;
    labelEs: string;
    hint: string;
    hintEs: string;
    format: PriorityMetricFormat;
    betterWhen: "up" | "down";
  }
> = {
  spend: {
    label: "Investimento",
    labelEs: "Inversión",
    hint: "Meta + Google",
    hintEs: "Meta + Google",
    format: "money",
    betterWhen: "up",
  },
  reach: {
    label: "Alcance",
    labelEs: "Alcance",
    hint: "pessoas únicas que viram",
    hintEs: "personas únicas que vieron",
    format: "number",
    betterWhen: "up",
  },
  impressions: {
    label: "Impressões",
    labelEs: "Impresiones",
    hint: "exibições totais",
    hintEs: "visualizaciones totales",
    format: "number",
    betterWhen: "up",
  },
  link_clicks: {
    label: "Cliques no link",
    labelEs: "Clics en el enlace",
    hint: "visitas ao site",
    hintEs: "visitas al sitio",
    format: "number",
    betterWhen: "up",
  },
  ctr: {
    label: "CTR",
    labelEs: "CTR",
    hint: "taxa de clique",
    hintEs: "tasa de clic",
    format: "percent",
    betterWhen: "up",
  },
  cpc: {
    label: "CPC",
    labelEs: "CPC",
    hint: "custo por clique",
    hintEs: "costo por clic",
    format: "money",
    betterWhen: "down",
  },
  cpm: {
    label: "CPM",
    labelEs: "CPM",
    hint: "custo por 1.000 exibições",
    hintEs: "costo por 1.000 visualizaciones",
    format: "money",
    betterWhen: "down",
  },
  leads: {
    label: "Leads",
    labelEs: "Leads",
    hint: "pessoas que deixaram contato",
    hintEs: "personas que dejaron sus datos",
    format: "number",
    betterWhen: "up",
  },
  cost_per_lead: {
    label: "Custo por lead",
    labelEs: "Costo por lead",
    hint: "custo por lead",
    hintEs: "costo por lead",
    format: "money",
    betterWhen: "down",
  },
  messaging_conversations: {
    label: "Conversas iniciadas",
    labelEs: "Conversaciones iniciadas",
    hint: "conversas que começaram pelo anúncio",
    hintEs: "conversaciones que empezaron por el anuncio",
    format: "number",
    betterWhen: "up",
  },
  cost_per_messaging_conversation: {
    label: "Custo por conversa",
    labelEs: "Costo por conversación",
    hint: "custo por conversa",
    hintEs: "costo por conversación",
    format: "money",
    betterWhen: "down",
  },
  landing_page_views: {
    label: "Visualizações da página",
    labelEs: "Visualizaciones de la página",
    hint: "visitas confirmadas à página",
    hintEs: "visitas confirmadas a la página",
    format: "number",
    betterWhen: "up",
  },
  add_to_cart: {
    label: "Carrinhos",
    labelEs: "Carritos",
    hint: "produtos adicionados ao carrinho",
    hintEs: "productos añadidos al carrito",
    format: "number",
    betterWhen: "up",
  },
  purchases: {
    label: "Compras/Vendas",
    labelEs: "Compras/Ventas",
    hint: "compras pelos anúncios",
    hintEs: "compras por los anuncios",
    format: "number",
    betterWhen: "up",
  },
  cost_per_purchase: {
    label: "Custo por venda",
    labelEs: "Costo por venta",
    hint: "custo por compra rastreada",
    hintEs: "costo por compra rastreada",
    format: "money",
    betterWhen: "down",
  },
  revenue: {
    label: "Faturamento",
    labelEs: "Facturación",
    hint: "receita rastreada pelos anúncios",
    hintEs: "ingresos rastreados por los anuncios",
    format: "money",
    betterWhen: "up",
  },
  roas: {
    label: "ROAS",
    labelEs: "ROAS",
    hint: "receita ÷ investimento",
    hintEs: "ingresos ÷ inversión",
    format: "ratio",
    betterWhen: "up",
  },
  crm_closed_won: {
    label: "Fechadas no CRM",
    labelEs: "Cerradas en el CRM",
    hint: "vendas fechadas no CRM",
    hintEs: "ventas cerradas en el CRM",
    format: "number",
    betterWhen: "up",
  },
  cost_per_crm_closed_won: {
    label: "Custo por venda fechada",
    labelEs: "Costo por venta cerrada",
    hint: "investimento ÷ vendas fechadas",
    hintEs: "inversión ÷ ventas cerradas",
    format: "money",
    betterWhen: "down",
  },
};

const DEFAULT_PRIORITY_METRICS: Record<DashboardModel, readonly PriorityMetricColumn[]> = {
  leads: ["spend", "reach", "leads", "cost_per_lead"],
  messages: [
    "spend",
    "messaging_conversations",
    "cost_per_messaging_conversation",
    "crm_closed_won",
  ],
  ecommerce: ["revenue", "roas", "purchases", "crm_closed_won"],
};

export function defaultPriorityMetrics(model: DashboardModel): PriorityMetricColumn[] {
  return [...DEFAULT_PRIORITY_METRICS[model]];
}

export function validPriorityMetrics(
  value: unknown,
  model: DashboardModel,
): PriorityMetricColumn[] {
  if (!Array.isArray(value)) return defaultPriorityMetrics(model);
  const allowed = new Set<string>(PRIORITY_METRIC_COLUMNS);
  const valid = value.filter(
    (column): column is PriorityMetricColumn => typeof column === "string" && allowed.has(column),
  );
  if (valid.length < 1 || valid.length > 6 || new Set(valid).size !== valid.length) {
    return defaultPriorityMetrics(model);
  }
  return valid;
}

export type PriorityMetricValues = Partial<Record<CampaignMetricColumn, number | null>> & {
  spend: number;
  conversions?: number | null;
};

export function priorityMetricValue(
  column: PriorityMetricColumn,
  summary: PriorityMetricValues,
  closedWon: number,
): number | null {
  if (column === "crm_closed_won") return closedWon;
  if (column === "cost_per_crm_closed_won") {
    return closedWon > 0 ? summary.spend / closedWon : null;
  }
  if (column === "purchases") return summary.purchases || summary.conversions || 0;
  return summary[column] ?? null;
}
