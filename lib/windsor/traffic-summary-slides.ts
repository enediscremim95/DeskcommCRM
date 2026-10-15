import type { MarcaDeSaida } from "@/lib/branding/saida";
import type { GoogleKeyword } from "@/lib/windsor/google-keywords";
import {
  fetchPdfThumbnailDataUri,
  preloadPdfThumbnails,
  type ThumbnailDependencies,
} from "@/lib/windsor/pdf-thumbnails";
import {
  buildTrafficAdsInTest,
  type TrafficAdInTest,
  type TrafficSummarySource,
} from "@/lib/windsor/traffic-summary-pdf";
import { text, type TrafficSummaryLanguage } from "@/lib/windsor/traffic-summary-model";

import slideModel from "./assets/traffic-summary-slides-model.json";

type StageConversion = {
  name: string;
  volume: number;
  from_previous: number | null;
  from_top: number | null;
  is_won: boolean;
};

type SlideMetricGroup = {
  currency: string;
  investment: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  cpl: number | null;
  ctr: number | null;
  conversion: number | null;
  meta: SlidePlatform;
  google: SlidePlatform & { keywords: GoogleKeyword[] };
  history: Array<{
    label: string;
    investment: number | null;
    leads: number | null;
    cpl: number | null;
    sales: number | null;
  }>;
  creatives: SlideCreative[];
};

type SlidePlatform = {
  investment: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  cpl: number | null;
  ctr: number | null;
  conversion: number | null;
  reach: number | null;
  frequency: number | null;
  cpm: number | null;
  cpc: number | null;
  video: {
    hook: number | null;
    body: number | null;
    v25: number | null;
    v50: number | null;
    v75: number | null;
    v95: number | null;
  };
};

type SlideCreative = {
  name: string;
  leads: number;
  cpl: number | null;
  image: string | null;
};

type SlideProfile = {
  considered: number;
  fields: Array<{
    label: string;
    answered: number;
    coverage: number;
    topValue: string;
    topPercent: number;
  }>;
};

type SlideFunnel = {
  stages: StageConversion[];
  focus: string[];
};

type SlideData = {
  brand: string;
  footerName: string;
  objective: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  locale: string;
  groups: SlideMetricGroup[];
  sections: {
    results: string;
    meta: string;
    google: string;
    profile?: string;
    funnel?: string;
  };
  profile?: SlideProfile;
  funnel?: SlideFunnel;
  labels: ReturnType<typeof labels>;
};

type SourceWithSlideDetails = TrafficSummarySource & {
  crm: TrafficSummarySource["crm"] & { stage_conversion?: StageConversion[] };
};

const DASH = "—";

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveRatio(part: number | null, total: number | null): number | null {
  return part != null && total != null && total > 0 ? (part / total) * 100 : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function safeDataImage(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^data:image\/(?:png|jpeg);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}

function formatDate(value: string, language: TrafficSummaryLanguage): string {
  return new Intl.DateTimeFormat(language === "es" ? "es-ES" : "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatMonth(
  window: TrafficSummarySource["window"],
  language: TrafficSummaryLanguage,
): string {
  const from = new Date(`${window.from}T12:00:00Z`);
  const to = new Date(`${window.to}T12:00:00Z`);
  const endOfMonth = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0, 12),
  );
  if (
    from.getUTCDate() === 1 &&
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    to.getUTCDate() === endOfMonth.getUTCDate()
  ) {
    const formatted = new Intl.DateTimeFormat(language === "es" ? "es-ES" : "pt-BR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(from);
    return formatted.charAt(0).toLocaleUpperCase(language) + formatted.slice(1);
  }
  return `${formatDate(window.from, language)} a ${formatDate(window.to, language)}`;
}

function formatShortPeriod(
  from: string,
  to: string,
  language: TrafficSummaryLanguage,
): string {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (start.getUTCDate() === 1 && start.getUTCMonth() === end.getUTCMonth()) {
    return new Intl.DateTimeFormat(language === "es" ? "es-ES" : "pt-BR", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    })
      .format(start)
      .replace(".", "");
  }
  return `${formatDate(from, language).slice(0, 5)}-${formatDate(to, language).slice(0, 5)}`;
}

function platformData(platform: Record<string, unknown> | undefined): SlidePlatform {
  const investment = finite(platform?.spend);
  const impressions = finite(platform?.impressions);
  const clicks = finite(platform?.clicks);
  const leads = finite(platform?.leads);
  const reach = finite(platform?.reach);
  const videoViews = finite(platform?.video_views);
  const videoP25 = finite(platform?.video_p25);
  const videoP50 = finite(platform?.video_p50);
  const videoP75 = finite(platform?.video_p75);
  const videoP95 = finite(platform?.video_p95);
  return {
    investment,
    impressions,
    clicks,
    leads,
    cpl: finite(platform?.cost_per_lead) ?? (investment != null && leads != null && leads > 0 ? investment / leads : null),
    ctr: finite(platform?.ctr) ?? positiveRatio(clicks, impressions),
    conversion: finite(platform?.conversion_rate) ?? positiveRatio(leads, clicks),
    reach,
    frequency: impressions != null && reach != null && reach > 0 ? impressions / reach : null,
    cpm: investment != null && impressions != null && impressions > 0 ? (investment / impressions) * 1_000 : null,
    cpc: investment != null && clicks != null && clicks > 0 ? investment / clicks : null,
    video: {
      hook: positiveRatio(videoViews, impressions),
      body: positiveRatio(videoP75, impressions),
      v25: videoP25,
      v50: videoP50,
      v75: videoP75,
      v95: videoP95,
    },
  };
}

function deterministicFocus(args: {
  stages: StageConversion[];
  groups: SlideMetricGroup[];
  language: TrafficSummaryLanguage;
}): string[] {
  const { stages, groups, language } = args;
  const points: string[] = [];
  const largestDrop = stages
    .slice(1)
    .map((stage, index) => ({
      from: stages[index]!,
      to: stage,
      drop: stages[index]!.volume - stage.volume,
    }))
    .filter((item) => item.drop > 0)
    .sort((a, b) => b.drop - a.drop)[0];
  if (largestDrop) {
    points.push(
      text(
        language,
        `Acompanhar a passagem de ${largestDrop.from.name} (${largestDrop.from.volume}) para ${largestDrop.to.name} (${largestDrop.to.volume}), a maior queda do funil no período.`,
        `Acompañar el paso de ${largestDrop.from.name} (${largestDrop.from.volume}) a ${largestDrop.to.name} (${largestDrop.to.volume}), la mayor caída del embudo en el período.`,
      ),
    );
  }
  const last = stages.at(-1);
  if (last) {
    points.push(
      last.volume > 0
        ? text(
            language,
            `${last.name} registrou ${last.volume} ${last.volume === 1 ? "lead" : "leads"} no período; acompanhar a continuidade desta etapa.`,
            `${last.name} registró ${last.volume} ${last.volume === 1 ? "lead" : "leads"} en el período; acompañar la continuidad de esta etapa.`,
          )
        : text(
            language,
            `${last.name} não registrou avanço no período; acompanhar os leads da etapa anterior até o fechamento.`,
            `${last.name} no registró avances en el período; acompañar los leads de la etapa anterior hasta el cierre.`,
          ),
    );
  }
  const primary = groups[0];
  if (primary?.meta.video.hook != null && primary.meta.video.body != null) {
    points.push(
      text(
        language,
        `Acompanhar a retenção dos vídeos: ${primary.meta.video.hook.toFixed(2).replace(".", ",")}% chegam ao hook e ${primary.meta.video.body.toFixed(2).replace(".", ",")}% ao corpo.`,
        `Acompañar la retención de los videos: ${primary.meta.video.hook.toFixed(2).replace(".", ",")}% llegan al hook y ${primary.meta.video.body.toFixed(2).replace(".", ",")}% al cuerpo.`,
      ),
    );
  }
  if (primary?.meta.cpl != null && primary.google.cpl != null) {
    const lower = primary.meta.cpl <= primary.google.cpl ? "Meta Ads" : "Google Ads";
    points.push(
      text(
        language,
        `${lower} apresentou o menor custo por lead no período; acompanhar a qualidade dos leads antes de alterar a distribuição do investimento.`,
        `${lower} presentó el menor costo por lead en el período; acompañar la calidad de los leads antes de cambiar la distribución de la inversión.`,
      ),
    );
  }
  return points.slice(0, 4);
}

function labels(language: TrafficSummaryLanguage) {
  const localized = (pt: string, es: string) => text(language, pt, es);
  return {
    previous: localized("Anterior", "Anterior"),
    next: localized("Próximo", "Siguiente"),
    loadError: localized("Não foi possível carregar o relatório", "No se pudo cargar el informe"),
    monthlyReport: localized("Relatório mensal", "Informe mensual"),
    performance: localized("Performance", "Rendimiento"),
    performanceAndExpansion: localized("Performance e expansão", "Rendimiento y expansión"),
    summary: localized("Resumo", "Resumen"),
    objective: localized("OBJETIVO", "OBJETIVO"),
    digitalAds: localized("Trabalhamos a publicidade digital em:", "Trabajamos la publicidad digital en:"),
    investmentShare: localized("Participação no investimento", "Participación en la inversión"),
    segmentation: localized("Segmentação", "Segmentación"),
    notInformed: localized("não informada", "no informada"),
    results: localized("Resultados", "Resultados"),
    allMedia: localized("Todas as mídias", "Todos los medios"),
    monthlyEvolution: localized("Todas as mídias: evolução mensal", "Todos los medios: evolución mensual"),
    investment: localized("Investimento", "Inversión"),
    impressions: localized("Impressões", "Impresiones"),
    clicks: localized("Cliques", "Clics"),
    leads: "Leads",
    cpl: "CPL",
    clickToLead: localized("clique → lead", "clic → lead"),
    variationPrevious: localized("Variação em relação ao mês anterior", "Variación frente al mes anterior"),
    investedValue: localized("Valor investido", "Valor invertido"),
    sales: localized("Vendas", "Ventas"),
    reachDelivery: localized("Meta Ads: alcance e entrega", "Meta Ads: alcance y entrega"),
    reach: localized("Alcance", "Alcance"),
    uniquePeople: localized("pessoas únicas que viram o anúncio", "personas únicas que vieron el anuncio"),
    frequency: localized("Frequência", "Frecuencia"),
    impressionsPerPerson: localized("média de exibições por pessoa", "promedio de exhibiciones por persona"),
    cpmCaption: localized("custo por 1.000 exibições", "costo por 1.000 impresiones"),
    cpcCaption: localized("custo por clique", "costo por clic"),
    videoRetention: localized("Meta Ads: retenção de vídeo", "Meta Ads: retención de video"),
    stoppedToWatch: localized("pararam para assistir", "se detuvieron a mirar"),
    watchedToEnd: localized("viram até o fim", "vieron hasta el final"),
    videoMilestones: localized("Visualizações por marco do vídeo", "Visualizaciones por hito del video"),
    creativeRanking: localized("Meta Ads: ranking de criativos", "Meta Ads: ranking de creativos"),
    creative: localized("Criativo", "Creativo"),
    noImage: localized("imagem não disponível", "imagen no disponible"),
    metaAttribution: localized("Leads e CPL conforme atribuição do Meta Ads", "Leads y CPL según la atribución de Meta Ads"),
    googleKeywords: localized("Google Ads: melhores palavras", "Google Ads: mejores palabras"),
    keyword: localized("Palavra-chave", "Palabra clave"),
    conversions: localized("Conversões", "Conversiones"),
    costPerConversion: localized("Custo / conv.", "Costo / conv."),
    total: localized("Total", "Total"),
    profileSection: localized("Perfil dos leads", "Perfil de los leads"),
    formCompletion: localized("Preenchimento do formulário", "Completitud del formulario"),
    consideredPeople: localized("Pessoas consideradas", "Personas consideradas"),
    answeredFields: localized("Campos com resposta", "Campos con respuesta"),
    greatestCoverage: localized("Maior cobertura", "Mayor cobertura"),
    peopleWithAnswers: localized("com respostas válidas no período", "con respuestas válidas en el período"),
    fieldsShown: localized("campos exibidos no perfil", "campos mostrados en el perfil"),
    answered: localized("respostas", "respuestas"),
    funnelSection: localized("Funil do CRM", "Embudo del CRM"),
    leadToClose: localized("Do lead ao fechamento", "Del lead al cierre"),
    stage: localized("ETAPA", "ETAPA"),
    volume: localized("VOLUME", "VOLUMEN"),
    conversion: localized("CONVERSÃO", "CONVERSIÓN"),
    stageCost: localized("CUSTO POR ETAPA", "COSTO POR ETAPA"),
    periodClosing: localized("Fechamento do período", "Cierre del período"),
    costPerLead: localized("Custo por lead", "Costo por lead"),
    monitoringFocus: localized("Foco de acompanhamento", "Foco de seguimiento"),
    monthlyPerformance: localized("RELATÓRIO MENSAL DE PERFORMANCE", "INFORME MENSUAL DE RENDIMIENTO"),
  };
}

async function resolvedLogo(
  brand: MarcaDeSaida,
  dependencies: ThumbnailDependencies,
): Promise<string | null> {
  const inline = safeDataImage(brand.logoUrl);
  if (inline) return inline;
  return brand.logoUrl ? fetchPdfThumbnailDataUri(brand.logoUrl, dependencies) : null;
}

async function slideData(args: {
  source: SourceWithSlideDetails;
  language: TrafficSummaryLanguage;
  creatives: TrafficAdInTest[];
}): Promise<SlideData> {
  const { source, language, creatives } = args;
  const groups = source.currencies.map((currencyGroup) => {
    const summary = currencyGroup.summary;
    const summaryInvestment = finite(summary.spend);
    const summaryClicks = finite(summary.clicks);
    const summaryLeads = finite(summary.leads);
    const summaryImpressions = finite(summary.impressions);
    const metaRaw = currencyGroup.platforms?.find((item) => item.platform === "meta_ads");
    const googleRaw = currencyGroup.platforms?.find((item) => item.platform === "google_ads");
    const history = source.historico?.find((item) => item.currency === currencyGroup.currency);
    const googleKeywords = (source.google_keywords ?? [])
      .filter((keyword) => keyword.currency === currencyGroup.currency)
      .map((keyword) => ({
        keyword: escapeHtml(keyword.keyword),
        impressions: finite(keyword.impressions),
        clicks: finite(keyword.clicks),
        conversions: finite(keyword.conversions),
        ctr: finite(keyword.ctr),
        cost_per_conversion: finite(keyword.cost_per_conversion),
      }));
    return {
      currency: escapeHtml(currencyGroup.currency),
      investment: summaryInvestment,
      impressions: summaryImpressions,
      clicks: summaryClicks,
      leads: summaryLeads,
      cpl:
        finite(summary.cost_per_lead) ??
        (summaryInvestment != null && summaryLeads != null && summaryLeads > 0
          ? summaryInvestment / summaryLeads
          : null),
      ctr: finite(summary.ctr) ?? positiveRatio(summaryClicks, summaryImpressions),
      conversion:
        finite(summary.conversion_rate) ?? positiveRatio(summaryLeads, summaryClicks),
      meta: platformData(metaRaw as unknown as Record<string, unknown> | undefined),
      google: {
        ...platformData(googleRaw as unknown as Record<string, unknown> | undefined),
        keywords: googleKeywords,
      },
      history:
        history?.periods.map((period, index, periods) => ({
          label: escapeHtml(formatShortPeriod(period.from, period.to, language)),
          investment: finite(period.spend),
          leads: finite(period.leads),
          cpl: finite(period.cost_per_lead),
          sales: index === periods.length - 1 ? finite(source.crm.closed_won) : null,
        })) ?? [],
      creatives: creatives
        .filter(
          (creative) =>
            creative.currency === currencyGroup.currency && creative.platform === "meta_ads",
        )
        .sort(
          (a, b) =>
            b.leads - a.leads ||
            (a.cost_per_lead ?? Number.POSITIVE_INFINITY) -
              (b.cost_per_lead ?? Number.POSITIVE_INFINITY) ||
            b.spend - a.spend,
        )
        .slice(0, 3)
        .map((creative) => ({
          name: escapeHtml(creative.name),
          leads: creative.leads,
          cpl: creative.cost_per_lead,
          image: safeDataImage(creative.thumbnail_data_uri),
        })),
    } satisfies SlideMetricGroup;
  });

  const rawStages = (source.crm.stage_conversion ?? [])
    .filter((stage) => Number.isFinite(stage.volume) && stage.volume >= 0)
    .map((stage) => ({
      name: escapeHtml(stage.name),
      volume: stage.volume,
      from_previous: finite(stage.from_previous),
      from_top: finite(stage.from_top),
      is_won: stage.is_won,
    }));
  const hasFunnel = rawStages.some((stage) => stage.volume > 0);
  const profile =
    source.lead_profile &&
    source.lead_profile.considered_leads >= 5 &&
    source.lead_profile.fields.length > 0
      ? {
          considered: source.lead_profile.considered_leads,
          fields: source.lead_profile.fields.map((field) => ({
            label: escapeHtml(field.label),
            answered: field.answered,
            coverage: field.coverage_percent,
            topValue: escapeHtml(field.top_value),
            topPercent: field.top_percent,
          })),
        }
      : undefined;
  const organizationName = source.organization_name?.trim() || "Organização";
  const objective =
    source.objective?.trim() ||
    text(
      language,
      "RESULTADOS DE PERFORMANCE DO PERÍODO",
      "RESULTADOS DE RENDIMIENTO DEL PERÍODO",
    );
  const localizedLabels = labels(language);
  if (!profile) {
    localizedLabels.profileSection = "";
    localizedLabels.formCompletion = "";
    localizedLabels.consideredPeople = "";
    localizedLabels.answeredFields = "";
    localizedLabels.greatestCoverage = "";
    localizedLabels.peopleWithAnswers = "";
    localizedLabels.fieldsShown = "";
    localizedLabels.answered = "";
  }
  if (!hasFunnel) {
    localizedLabels.funnelSection = "";
    localizedLabels.leadToClose = "";
    localizedLabels.stage = "";
    localizedLabels.volume = "";
    localizedLabels.conversion = "";
    localizedLabels.stageCost = "";
    localizedLabels.periodClosing = "";
    localizedLabels.costPerLead = "";
    localizedLabels.monitoringFocus = "";
  }
  const data: SlideData = {
    brand: escapeHtml(organizationName),
    footerName: escapeHtml(organizationName.toLocaleUpperCase(language)),
    objective: escapeHtml(objective),
    month: escapeHtml(formatMonth(source.window, language)),
    periodStart: formatDate(source.window.from, language),
    periodEnd: formatDate(source.window.to, language),
    locale: language === "es" ? "es-ES" : "pt-BR",
    groups,
    sections: { results: "01", meta: "02", google: "03" },
    labels: localizedLabels,
  };
  let optionalSection = 4;
  if (profile) {
    data.profile = profile;
    data.sections.profile = String(optionalSection).padStart(2, "0");
    optionalSection += 1;
  }
  if (hasFunnel) {
    data.funnel = {
      stages: rawStages,
      focus: deterministicFocus({ stages: rawStages, groups, language }).map(escapeHtml),
    };
    data.sections.funnel = String(optionalSection).padStart(2, "0");
  }
  return data;
}

/**
 * Runtime autocontido do arquivo baixado. A função não fecha sobre nenhum valor
 * do servidor; os quatro argumentos são serializados acima dela no mesmo script.
 */
function slidesRuntime(
  D: SlideData,
  ICON: Record<string, string>,
  LOGO: string | null,
  BADGE: string | null,
): void {
  const fInt = (value: number | null) =>
    value == null ? DASH : new Intl.NumberFormat(D.locale, { maximumFractionDigits: 0 }).format(value);
  const fMoney = (value: number | null, currency: string) =>
    value == null
      ? DASH
      : new Intl.NumberFormat(D.locale, {
          style: "currency",
          currency,
          maximumFractionDigits: 2,
        }).format(value);
  const fPct = (value: number | null, digits = 2) =>
    value == null
      ? DASH
      : `${new Intl.NumberFormat(D.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`;
  const fX = (value: number | null) =>
    value == null
      ? DASH
      : `${new Intl.NumberFormat(D.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}x`;
  const logo = (className: string) =>
    LOGO ? `<img class="${className}" src="${LOGO}" alt="${D.brand}">` : "";
  const badge = BADGE ? `<img class="badge" src="${BADGE}" alt="${D.brand}">` : "";
  const FOOT = `<div class="foot"><span>${D.footerName}  ·  ${D.labels.monthlyPerformance}</span><span class="pn"></span></div>`;
  const content = (title: string, body: string, cls = "") =>
    `<section class="slide content ${cls}">${badge}<h2 class="title">${title}</h2><div class="body">${body}</div>${FOOT}</section>`;
  const divider = (num: string, title: string) =>
    `<section class="slide divider">${badge}<div class="dv"><div class="dv-num">${num}</div><h2 class="dv-title">${title}</h2></div></section>`;
  const kcard = (icon: string, label: string, value: string, caption: string, cls = "") =>
    `<div class="card kcard ${cls}"><div class="k-top"><span class="circ">${ICON[icon] ?? ""}</span><span class="k-label">${label}</span></div><div class="k-val">${value}</div><div class="k-cap">${caption}</div></div>`;
  const scard = (icon: string, label: string, value: string, cls = "") =>
    `<div class="card kcard sm ${cls}"><span class="circ">${ICON[icon] ?? ""}</span><div class="k-val">${value}</div><div class="k-lab">${label}</div></div>`;
  const table = (head: string[], rows: string[], cls = "") =>
    `<div class="tw"><table class="tb ${cls}"><thead><tr>${head.map((item) => `<th>${item}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

  function chevrons(
    values: {
      investment: string;
      impressions: string;
      clicks: string;
      leads: string;
      cpl: string;
      ctr: string;
      conv: string;
    },
    note?: string,
  ) {
    const steps = [
      ["coins", D.labels.investment, values.investment],
      ["search", D.labels.impressions, values.impressions],
      ["click", D.labels.clicks, values.clicks],
      ["check", D.labels.leads, values.leads],
      ["dollar", D.labels.cpl, values.cpl],
    ];
    const step = 214;
    const items = steps
      .map((item, index) => {
        const polygon =
          index === 0
            ? "1,1 203,1 287,84 203,167 1,167"
            : "1,1 203,1 287,84 203,167 1,167 85,84";
        return `<div class="chev-item ${index === 0 ? "first" : ""}" style="left:${10 + index * step}px">
      <svg class="chev-bg" viewBox="0 0 288 168" preserveAspectRatio="none"><polygon points="${polygon}" fill="#FFE9DA" stroke="#E6D6C3" stroke-width="1.5"/></svg>
      <div class="chev-in"><span class="ic">${ICON[item[0]!] ?? ""}</span><b>${item[1]}</b><span class="val">${item[2]}</span></div>
      <div class="chev-var">${DASH}<small> ${D.labels.variationPrevious.toLocaleLowerCase(D.locale)}</small></div></div>`;
      })
      .join("");
    const centers = [10 + 144 - 21, 10 + step + 144, 10 + 2 * step + 144, 10 + 3 * step + 144];
    const brackets = `<svg class="brackets" width="1164" height="191" viewBox="0 0 1164 191" fill="none" stroke="#C76B4B" stroke-width="1.7">
    <path d="M${centers[1]} 191V143H${centers[2]}V191"/><path d="M${centers[2]} 191V85H${centers[3]}V191"/></svg>
    <div class="b-label" style="left:${(centers[1]! + centers[2]!) / 2}px;top:96px">CTR = ${values.ctr}</div>
    <div class="b-label" style="left:${(centers[2]! + centers[3]!) / 2}px;top:12px">${values.conv}<small>${D.labels.clickToLead}</small></div>`;
    return `<div class="chev-stage">${brackets}${items}
    <div class="pills"><span>CTR = ${values.ctr}</span><span>${values.conv} ${D.labels.clickToLead}</span></div>
    <div class="chev-legend">${D.labels.variationPrevious}</div>
    ${note ? `<div class="chev-note">${note}</div>` : ""}</div>`;
  }

  function evoChart(group: SlideMetricGroup) {
    const W = 1164;
    const H = 300;
    const L = 82;
    const R = 56;
    const T = 14;
    const B = 62;
    const plotWidth = W - L - R;
    const plotHeight = H - T - B;
    const periods = group.history.length > 0 ? group.history : [{ label: D.month, investment: group.investment, leads: group.leads, cpl: group.cpl, sales: null }];
    const maxInvestment = Math.max(1, ...periods.map((period) => period.investment ?? 0));
    const maxRight = Math.max(1, ...periods.flatMap((period) => [period.leads ?? 0, period.cpl ?? 0]));
    const maxLeft = Math.ceil((maxInvestment * 1.15) / 1_000) * 1_000 || 1_000;
    const maxR = Math.ceil((maxRight * 1.15) / 10) * 10 || 10;
    const band = plotWidth / periods.length;
    const ticks = 5;
    let svg = `<svg viewBox="0 0 ${W} ${H}" font-family="Calibri,Segoe UI,Arial,sans-serif" font-size="13" fill="#7C7784">`;
    for (let index = 0; index <= ticks; index += 1) {
      const y = T + plotHeight - (index / ticks) * plotHeight;
      svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#E6D6C3" stroke-width="1"/>`;
      svg += `<text x="${L - 8}" y="${y + 4}" text-anchor="end">${fMoney((maxLeft * index) / ticks, group.currency)}</text>`;
      svg += `<text x="${W - R + 8}" y="${y + 4}">${Math.round((maxR * index) / ticks)}</text>`;
    }
    periods.forEach((period, index) => {
      const center = L + band * index + band / 2;
      svg += `<text x="${center}" y="${T + plotHeight + 22}" text-anchor="middle" fill="#2E2B3F" font-size="14">${period.label}</text>`;
      if (period.investment != null) {
        const height = (period.investment / maxLeft) * plotHeight;
        svg += `<rect x="${center - Math.min(band * 0.4, 72) / 2}" y="${T + plotHeight - height}" width="${Math.min(band * 0.4, 72)}" height="${height}" fill="#7F8D7A"/>`;
      }
    });
    const line = (values: Array<number | null>, max: number, color: string) => {
      const points = values
        .map((value, index) =>
          value == null ? null : [L + band * index + band / 2, T + plotHeight - (value / max) * plotHeight],
        )
        .filter((point): point is number[] => point !== null);
      const path =
        points.length > 1
          ? `<polyline points="${points.map((point) => point.join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5"/>`
          : "";
      return path + points.map((point) => `<circle cx="${point[0]}" cy="${point[1]}" r="5.5" fill="${color}"/>`).join("");
    };
    svg += line(periods.map((period) => period.leads), maxR, "#2E2B3F");
    svg += line(periods.map((period) => period.cpl), maxR, "#C76B4B");
    const legend: Array<[string, string, "r" | "c"]> = [
      ["#7F8D7A", D.labels.investedValue, "r"],
      ["#2E2B3F", D.labels.leads, "c"],
      ["#C76B4B", D.labels.cpl, "c"],
    ];
    let left = W / 2 - 150;
    legend.forEach(([color, title, kind]) => {
      svg +=
        kind === "r"
          ? `<rect x="${left}" y="${H - 20}" width="16" height="10" fill="${color}"/>`
          : `<line x1="${left - 4}" x2="${left + 20}" y1="${H - 15}" y2="${H - 15}" stroke="${color}" stroke-width="2.5"/><circle cx="${left + 8}" cy="${H - 15}" r="4.5" fill="${color}"/>`;
      svg += `<text x="${left + 28}" y="${H - 10}" fill="#2E2B3F" font-size="14">${title}</text>`;
      left += 120;
    });
    return `${svg}</svg>`;
  }

  const S: string[] = [];
  S.push(`<section class="slide cover">${logo("logo")}<div class="kicker">${D.labels.monthlyReport}</div><h1>${D.brand}</h1><div class="month">${D.month}</div><div class="period">${D.periodStart} a ${D.periodEnd}  ·  ${D.funnel ? D.labels.performanceAndExpansion : D.labels.performance}</div></section>`);

  const primary = D.groups[0];
  const totalInvestment = primary?.investment ?? null;
  const share = (investment: number | null) =>
    investment != null && totalInvestment != null && totalInvestment > 0
      ? fPct((investment / totalInvestment) * 100, 1)
      : DASH;
  S.push(content(D.labels.summary, `
  <div class="obj"><span class="t">${D.labels.objective} » </span>${D.objective}</div>
  <div class="sub">${D.labels.digitalAds}</div>
  <div class="channels">
    <div class="ch"><span class="circ">${ICON.meta ?? ""}</span><b>Meta Ads</b><span>${D.labels.investmentShare}: ${share(primary?.meta.investment ?? null)}</span><span>${D.labels.segmentation}: ${D.labels.notInformed}</span></div>
    <div class="ch"><span class="circ">${ICON.google ?? ""}</span><b>Google Ads</b><span>${D.labels.investmentShare}: ${share(primary?.google.investment ?? null)}</span><span>${D.labels.segmentation}: ${D.labels.notInformed}</span></div>
  </div>`));

  S.push(divider(D.sections.results, D.labels.results));
  D.groups.forEach((group) => {
    const suffix = D.groups.length > 1 ? ` · ${group.currency}` : "";
    S.push(content(`${D.labels.allMedia}${suffix}`, chevrons({
      investment: fMoney(group.investment, group.currency),
      impressions: fInt(group.impressions),
      clicks: fInt(group.clicks),
      leads: fInt(group.leads),
      cpl: fMoney(group.cpl, group.currency),
      ctr: fPct(group.ctr),
      conv: fPct(group.conversion),
    })));
    const periods = group.history.length > 0 ? group.history : [{ label: D.month, investment: group.investment, leads: group.leads, cpl: group.cpl, sales: null }];
    const row = (label: string, values: string[]) => `<tr><td><b>${label}</b></td>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
    S.push(content(`${D.labels.monthlyEvolution}${suffix}`, `<div class="evo-wrap tw">${evoChart(group)}</div><div class="evo-table">${table([""].concat(periods.map((period) => period.label)), [
      row(D.labels.investedValue, periods.map((period) => fMoney(period.investment, group.currency))),
      row(D.labels.leads, periods.map((period) => fInt(period.leads))),
      row(D.labels.cpl, periods.map((period) => fMoney(period.cpl, group.currency))),
      row(D.labels.sales, periods.map((period) => fInt(period.sales))),
    ])}</div>`));
  });

  S.push(divider(D.sections.meta, "Meta Ads"));
  D.groups.forEach((group) => {
    const suffix = D.groups.length > 1 ? ` · ${group.currency}` : "";
    const meta = group.meta;
    S.push(content(`Meta Ads${suffix}`, chevrons({
      investment: fMoney(meta.investment, group.currency),
      impressions: fInt(meta.impressions),
      clicks: fInt(meta.clicks),
      leads: fInt(meta.leads),
      cpl: fMoney(meta.cpl, group.currency),
      ctr: fPct(meta.ctr),
      conv: fPct(meta.conversion),
    }, D.labels.metaAttribution)));
    S.push(content(`${D.labels.reachDelivery}${suffix}`, `<div class="grid g2">${
      kcard("users", D.labels.reach, fInt(meta.reach), D.labels.uniquePeople) +
      kcard("eye", D.labels.frequency, fX(meta.frequency), D.labels.impressionsPerPerson) +
      kcard("layers", "CPM", fMoney(meta.cpm, group.currency), D.labels.cpmCaption) +
      kcard("click", "CPC", fMoney(meta.cpc, group.currency), D.labels.cpcCaption)
    }</div>`));
    const video = meta.video;
    const maxVideo = Math.max(1, video.v25 ?? 0, video.v50 ?? 0, video.v75 ?? 0, video.v95 ?? 0);
    const callout = (icon: string, label: string, subtitle: string, value: string, caption: string) => `<div class="card callout"><div class="k-top"><span class="circ">${ICON[icon] ?? ""}</span><span class="k-label">${label}<small>${subtitle}</small></span></div><div class="k-val">${value}</div><div class="k-cap">${caption}</div></div>`;
    const bar = (label: string, value: number | null) => `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${value == null ? 0 : ((value / maxVideo) * 100).toFixed(1)}%"></div></div><span class="bar-val">${fInt(value)}</span></div>`;
    S.push(content(`${D.labels.videoRetention}${suffix}`, `<div class="ret"><div class="col">${callout("play", "HOOK", "3s+", fPct(video.hook), D.labels.stoppedToWatch)}${callout("badge", "BODY", "75%+", fPct(video.body), D.labels.watchedToEnd)}</div>
    <div class="card chart-card"><h3>${D.labels.videoMilestones}</h3><div class="bars">${bar("View 25%", video.v25)}${bar("View 50%", video.v50)}${bar("View 75%", video.v75)}${bar("View 95%", video.v95)}</div></div></div>`));
    const creatives = Array.from({ length: 3 }, (_, index) => group.creatives[index] ?? null);
    S.push(content(`${D.labels.creativeRanking}${suffix}`, `<div class="crea">${creatives.map((creative, index) => `<div><div class="frame">${creative?.image ? `<img src="${creative.image}" alt="${creative.name}" style="width:100%;height:100%;object-fit:cover;border-radius:14px">` : `${creative?.name ?? `${D.labels.creative} ${index + 1}`}<br>(${D.labels.noImage})`}<span class="rank">${index + 1}º</span></div>${table([D.labels.leads, D.labels.cpl], [`<tr><td style="text-align:center">${creative ? fInt(creative.leads) : DASH}</td><td>${creative ? fMoney(creative.cpl, group.currency) : DASH}</td></tr>`])}</div>`).join("")}</div>`));
  });

  S.push(divider(D.sections.google, "Google Ads"));
  D.groups.forEach((group) => {
    const suffix = D.groups.length > 1 ? ` · ${group.currency}` : "";
    const google = group.google;
    S.push(content(`Google Ads${suffix}`, chevrons({
      investment: fMoney(google.investment, group.currency),
      impressions: fInt(google.impressions),
      clicks: fInt(google.clicks),
      leads: fInt(google.leads),
      cpl: fMoney(google.cpl, group.currency),
      ctr: fPct(google.ctr),
      conv: fPct(google.conversion),
    })));
    const keywordRows = google.keywords.length > 0
      ? google.keywords.slice(0, 5).map((keyword) => `<tr><td>${keyword.keyword}</td><td>${fInt(keyword.impressions)}</td><td>${fInt(keyword.clicks)}</td><td>${fInt(keyword.conversions)}</td><td>${fPct(keyword.ctr)}</td><td>${fMoney(keyword.cost_per_conversion, group.currency)}</td></tr>`)
      : Array.from({ length: 5 }, () => `<tr><td class="m">${DASH}</td>${`<td>${DASH}</td>`.repeat(5)}</tr>`);
    const totalRow = `<tr class="tot"><td>${D.labels.total}</td><td>${fInt(google.impressions)}</td><td>${fInt(google.clicks)}</td><td>${fInt(google.leads)}</td><td>${fPct(google.ctr)}</td><td>${fMoney(google.cpl, group.currency)}</td></tr>`;
    S.push(content(`${D.labels.googleKeywords}${suffix}`, table([D.labels.keyword, D.labels.impressions, D.labels.clicks, D.labels.conversions, "CTR", D.labels.costPerConversion], [totalRow, ...keywordRows])));
  });

  if (D.profile) {
    S.push(divider(D.sections.profile ?? "04", D.labels.profileSection));
    const greatestCoverage = Math.max(...D.profile.fields.map((field) => field.coverage));
    S.push(content(D.labels.formCompletion, `<div class="grid g3 pre" style="margin-top:50px">${
      kcard("file", D.labels.consideredPeople, fInt(D.profile.considered), D.labels.peopleWithAnswers) +
      kcard("check", D.labels.answeredFields, fInt(D.profile.fields.length), D.labels.fieldsShown) +
      kcard("badge", D.labels.greatestCoverage, fPct(greatestCoverage, 1), D.labels.answered)
    }</div>`));
    const profileIcons = ["wallet", "map", "pin", "store", "clock"];
    S.push(content(D.labels.profileSection, `<div class="perfil">${D.profile.fields.slice(0, 5).map((field, index) => `<div class="pf"><span class="circ">${ICON[profileIcons[index]!] ?? ""}</span><div class="v">${field.topValue}</div><div class="c">${field.label} · ${fPct(field.topPercent, 1)} · ${fInt(field.answered)} ${D.labels.answered}</div></div>`).join("")}</div>`));
  }

  if (D.funnel) {
    S.push(divider(D.sections.funnel ?? "04", D.labels.funnelSection));
    const chunks: StageConversion[][] = [];
    for (let index = 0; index < D.funnel.stages.length; index += 6) chunks.push(D.funnel.stages.slice(index, index + 6));
    chunks.forEach((stages, chunkIndex) => {
      const top = D.funnel!.stages[0]?.volume ?? 0;
      const rows = stages.map((stage, index) => {
        const absoluteIndex = chunkIndex * 6 + index;
        const previous = absoluteIndex > 0 ? D.funnel!.stages[absoluteIndex - 1] : null;
        const group = D.groups[0];
        const cost = group?.investment != null && stage.volume > 0 ? group.investment / stage.volume : null;
        return `<div class="fun-row"><span class="lb">${stage.name}</span><span class="nv">${fInt(stage.volume)}</span><div class="tr">${stage.volume > 0 && top > 0 ? `<div class="fl" style="width:${((stage.volume / top) * 100).toFixed(1)}%"></div>` : ""}</div><span class="rt">${previous && previous.volume > 0 ? fPct((stage.volume / previous.volume) * 100, 1) : DASH}</span><span class="cost">${group ? fMoney(cost, group.currency) : DASH}</span></div>`;
      }).join("");
      const suffix = chunks.length > 1 ? ` · ${chunkIndex + 1}/${chunks.length}` : "";
      S.push(content(`${D.labels.leadToClose}${suffix}`, `<div class="card fun"><div class="fun-head"><span>${D.labels.stage}</span><span>${D.labels.volume}</span><span></span><span>${D.labels.conversion}</span><span>${D.labels.stageCost}</span></div>${rows}</div>`));
    });
    const group = D.groups[0];
    const closingCards = [
      scard("wallet", D.labels.investment, group ? fMoney(group.investment, group.currency) : DASH),
      scard("file", D.labels.leads, group ? fInt(group.leads) : DASH),
      scard("dollar", D.labels.costPerLead, group ? fMoney(group.cpl, group.currency) : DASH),
      ...D.funnel.stages.slice(0, 5).map((stage) => scard(stage.is_won ? "trophy" : "userCheck", stage.name, fInt(stage.volume), stage.is_won ? "att" : "")),
    ];
    S.push(content(D.labels.periodClosing, `<div class="grid g4">${closingCards.join("")}</div>`));
    if (D.funnel.focus.length > 0) {
      S.push(content(D.labels.monitoringFocus, `<div class="grid g2 foco">${D.funnel.focus.map((item, index) => `<div class="card"><span class="n">${String(index + 1).padStart(2, "0")}</span><span class="tx">${item}</span></div>`).join("")}</div>`));
    }
  }

  S.push(`<section class="slide closing">${LOGO ? logo("") : `<h1 style="position:absolute;left:10%;right:10%;top:50%;transform:translateY(-50%);text-align:center;font-size:72px;color:var(--terracotta)">${D.brand}</h1>`}</section>`);

  const stage = document.getElementById("stage")!;
  try {
    stage.innerHTML = S.join("");
  } catch (error) {
    document.body.textContent = `${D.labels.loadError}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const slides = [...stage.querySelectorAll<HTMLElement>(".slide")];
  slides.forEach((slide, index) => {
    const pageNumber = slide.querySelector(".pn");
    if (pageNumber) pageNumber.textContent = String(index + 1);
  });
  let current = Math.max(0, Math.min(slides.length - 1, (Number.parseInt(location.hash.slice(1)) || 1) - 1));
  const counter = document.getElementById("ct");
  function show(index: number) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === current));
    if (counter) counter.textContent = `${current + 1} / ${slides.length}`;
    if (!document.body.classList.contains("flow")) history.replaceState(null, "", `#${current + 1}`);
  }
  function layout() {
    const flow = window.innerWidth < 900;
    document.body.classList.toggle("flow", flow);
    if (flow) {
      stage.style.transform = "";
      stage.style.left = "";
      stage.style.top = "";
      return;
    }
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.transform = `scale(${scale})`;
    stage.style.left = `${(window.innerWidth - 1280 * scale) / 2}px`;
    stage.style.top = `${(window.innerHeight - 720 * scale) / 2}px`;
  }
  window.addEventListener("resize", layout);
  window.addEventListener("beforeprint", () => document.body.classList.remove("flow"));
  window.addEventListener("afterprint", layout);
  const previous = document.getElementById("prev");
  const next = document.getElementById("next");
  if (previous) previous.onclick = () => show(current - 1);
  if (next) next.onclick = () => show(current + 1);
  document.addEventListener("keydown", (event) => {
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      show(current + 1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      show(current - 1);
    } else if (event.key === "Home") show(0);
    else if (event.key === "End") show(slides.length - 1);
  });
  let touchX: number | null = null;
  document.addEventListener("touchstart", (event) => {
    touchX = event.touches[0]?.clientX ?? null;
  }, { passive: true });
  document.addEventListener("touchend", (event) => {
    if (touchX == null || document.body.classList.contains("flow")) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
    touchX = null;
    if (Math.abs(delta) > 50) show(current + (delta < 0 ? 1 : -1));
  }, { passive: true });
  stage.addEventListener("click", (event) => {
    if (!document.body.classList.contains("flow") && event.clientX > window.innerWidth / 2) show(current + 1);
  });
  layout();
  show(current);
}

export async function renderTrafficSummarySlides(args: {
  source: TrafficSummarySource;
  brand: MarcaDeSaida;
  language: TrafficSummaryLanguage;
  organizationSlug: string | null;
  imageDependencies?: ThumbnailDependencies;
}): Promise<string> {
  const dependencies = args.imageDependencies ?? {};
  const [logo, creatives] = await Promise.all([
    resolvedLogo(args.brand, dependencies),
    preloadPdfThumbnails(buildTrafficAdsInTest(args.source), dependencies),
  ]);
  const data = await slideData({
    source: args.source as SourceWithSlideDetails,
    language: args.language,
    creatives,
  });
  const title = escapeHtml(
    `${args.source.organization_name?.trim() || args.brand.nome} · ${text(args.language, "Relatório mensal", "Informe mensual")} · ${formatMonth(args.source.window, args.language)}`,
  );
  const languageTag = args.language === "es" ? "es" : "pt-BR";
  const runtime = slidesRuntime.toString();
  return `<!doctype html>
<html lang="${languageTag}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<style>${slideModel.css}</style>
</head>
<body>
<div id="stage"></div>
<div class="nav" id="nav"><button id="prev" aria-label="${escapeHtml(data.labels.previous)}">‹</button><span class="ct" id="ct">1 / 1</span><button id="next" aria-label="${escapeHtml(data.labels.next)}">›</button></div>
<script>
const D = ${safeJson(data)};
const ICON = ${safeJson(slideModel.icons)};
const LOGO = ${safeJson(safeDataImage(logo))};
const BADGE = ${safeJson(safeDataImage(logo))};
const DASH = ${safeJson(DASH)};
(${runtime})(D, ICON, LOGO, BADGE);
</script>
</body>
</html>`;
}
