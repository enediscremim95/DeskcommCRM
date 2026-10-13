import type { DashboardModel } from "@/lib/windsor/types";

export type TrafficSummaryLanguage = "pt-BR" | "es";

export function text(language: TrafficSummaryLanguage, pt: string, es: string): string {
  return language === "es" ? es : pt;
}

export type TrafficMetricSnapshot = {
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks?: number | null;
  leads?: number | null;
  cost_per_lead?: number | null;
  ctr?: number | null;
  conversion_rate?: number | null;
};

export type TrafficPlatformSnapshot = TrafficMetricSnapshot & {
  platform: "meta_ads" | "google_ads";
};

export type PlatformInvestmentShare = {
  platform: "meta_ads" | "google_ads";
  spend: number;
  percent: number;
};

export function buildPlatformInvestmentShares(
  platforms: TrafficPlatformSnapshot[],
): PlatformInvestmentShare[] {
  const active = platforms.filter((platform) => Number.isFinite(platform.spend) && platform.spend > 0);
  const total = active.reduce((sum, platform) => sum + platform.spend, 0);
  if (total <= 0) return [];
  return active
    .map((platform) => ({
      platform: platform.platform,
      spend: platform.spend,
      percent: Math.round((platform.spend / total) * 1_000_000) / 10_000,
    }))
    .sort((a, b) => b.spend - a.spend || a.platform.localeCompare(b.platform));
}

function variation(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function number(value: number, language: TrafficSummaryLanguage, digits = 1): string {
  return new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", {
    maximumFractionDigits: digits,
  }).format(value);
}

function money(value: number, currency: string, language: TrafficSummaryLanguage): string {
  return new Intl.NumberFormat(language === "es" ? "es-ES" : "pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function buildAutomaticAnalysis(args: {
  current: TrafficMetricSnapshot;
  previous?: TrafficMetricSnapshot | null;
  currency: string;
  language: TrafficSummaryLanguage;
}): string[] {
  const { current, previous, currency, language } = args;
  const interested = current.leads ?? 0;
  if (!previous) {
    return [
      text(
        language,
        `Neste período, foram registradas ${number(interested, language, 0)} pessoas interessadas.`,
        `En este período se registraron ${number(interested, language, 0)} personas interesadas.`,
      ),
      current.cost_per_lead == null
        ? text(
            language,
            "Não há dados do período anterior para fazer uma comparação.",
            "No hay datos del período anterior para hacer una comparación.",
          )
        : text(
            language,
            `O custo por pessoa interessada ficou em ${money(current.cost_per_lead, currency, language)}. Não há comparação com o período anterior.`,
            `El costo por persona interesada fue de ${money(current.cost_per_lead, currency, language)}. No hay comparación con el período anterior.`,
          ),
    ];
  }

  const sentences: string[] = [];
  const spendChange = variation(current.spend, previous.spend);
  const leadChange = variation(current.leads, previous.leads);
  if (spendChange == null || leadChange == null) {
    sentences.push(
      text(
        language,
        `O investimento foi de ${money(current.spend, currency, language)} e foram registradas ${number(interested, language, 0)} pessoas interessadas. A base anterior não permite calcular uma das variações.`,
        `La inversión fue de ${money(current.spend, currency, language)} y se registraron ${number(interested, language, 0)} personas interesadas. La base anterior no permite calcular una de las variaciones.`,
      ),
    );
  } else if (Math.abs(spendChange) < 0.05 && Math.abs(leadChange) < 0.05) {
    sentences.push(
      text(
        language,
        "O investimento e o número de pessoas interessadas ficaram estáveis em relação ao período anterior.",
        "La inversión y el número de personas interesadas se mantuvieron estables frente al período anterior.",
      ),
    );
  } else {
    const spendDirection = spendChange >= 0 ? text(language, "subiu", "subió") : text(language, "caiu", "bajó");
    const leadDirection = leadChange >= 0 ? text(language, "subiu", "subió") : text(language, "caiu", "bajó");
    sentences.push(
      text(
        language,
        `O investimento ${spendDirection} ${number(Math.abs(spendChange), language)}% e o número de pessoas interessadas ${leadDirection} ${number(Math.abs(leadChange), language)}%.`,
        `La inversión ${spendDirection} ${number(Math.abs(spendChange), language)}% y el número de personas interesadas ${leadDirection} ${number(Math.abs(leadChange), language)}%.`,
      ),
    );
  }

  const costChange = variation(current.cost_per_lead, previous.cost_per_lead);
  if (costChange != null && current.cost_per_lead != null) {
    if (Math.abs(costChange) < 0.05) {
      sentences.push(
        text(
          language,
          `O custo por pessoa interessada ficou estável em ${money(current.cost_per_lead, currency, language)}.`,
          `El costo por persona interesada se mantuvo estable en ${money(current.cost_per_lead, currency, language)}.`,
        ),
      );
    } else {
      sentences.push(
        text(
          language,
          `O custo por pessoa interessada ${costChange < 0 ? "caiu" : "subiu"} ${number(Math.abs(costChange), language)}%, para ${money(current.cost_per_lead, currency, language)}.`,
          `El costo por persona interesada ${costChange < 0 ? "bajó" : "subió"} ${number(Math.abs(costChange), language)}%, a ${money(current.cost_per_lead, currency, language)}.`,
        ),
      );
    }
  }

  const ctrChange = variation(current.ctr, previous.ctr);
  if (ctrChange != null && Math.abs(ctrChange) >= 0.05) {
    sentences.push(
      text(
        language,
        `A taxa de clique ${ctrChange > 0 ? "melhorou" : "piorou"} ${number(Math.abs(ctrChange), language)}%.`,
        `La tasa de clic ${ctrChange > 0 ? "mejoró" : "empeoró"} ${number(Math.abs(ctrChange), language)}%.`,
      ),
    );
  }
  return sentences.slice(0, 3);
}

export type LeadProfileField = {
  key: string;
  label: string;
  answered: number;
  coverage_percent: number;
  top_value: string;
  top_count: number;
  top_percent: number;
};

export type LeadProfile = {
  considered_leads: number;
  fields: LeadProfileField[];
};

const TECHNICAL_OR_PERSONAL_FIELD = /(^|_)(id|uuid|nome|name|email|mail|telefone|phone|whatsapp|cpf|cnpj|endereco|address|cep|consent|status|score|form|respondent|utm|gclid|fbclid|campaign|campanha|ad|anuncio|source|origem|classificacao|motivo|observacao|nota|mensagem|message)($|_)/i;

function categoricalValue(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 80) return null;
  return normalized;
}

function fieldLabel(key: string): string {
  const clean = key.replace(/^respondi_q_/, "").replace(/[_-]+/g, " ").trim();
  return clean ? clean.charAt(0).toLocaleUpperCase("pt-BR") + clean.slice(1) : key;
}

export function buildLeadProfile(
  leads: Array<{ custom_fields?: unknown }>,
): LeadProfile | null {
  const rows = leads.map((lead) => {
    const custom =
      lead.custom_fields && typeof lead.custom_fields === "object" && !Array.isArray(lead.custom_fields)
        ? (lead.custom_fields as Record<string, unknown>)
        : {};
    return Object.entries(custom)
      .filter(([key]) => !TECHNICAL_OR_PERSONAL_FIELD.test(key))
      .map(([key, value]) => [key, categoricalValue(value)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] != null);
  });
  const considered = rows.filter((row) => row.length > 0);
  if (considered.length < 5) return null;

  const byField = new Map<string, Map<string, { label: string; count: number }>>();
  for (const row of considered) {
    for (const [key, value] of row) {
      let values = byField.get(key);
      if (!values) {
        values = new Map();
        byField.set(key, values);
      }
      const normalized = value.toLocaleLowerCase("pt-BR");
      const current = values.get(normalized);
      values.set(normalized, { label: current?.label ?? value, count: (current?.count ?? 0) + 1 });
    }
  }

  const fields: LeadProfileField[] = [];
  for (const [key, values] of byField) {
    const answered = [...values.values()].reduce((sum, value) => sum + value.count, 0);
    const distinct = values.size;
    const maxDistinct = Math.min(8, Math.max(2, Math.floor(answered * 0.6)));
    if (answered < 5 || distinct > maxDistinct) continue;
    const top = [...values.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"),
    )[0];
    if (!top) continue;
    fields.push({
      key,
      label: fieldLabel(key),
      answered,
      coverage_percent: (answered / considered.length) * 100,
      top_value: top.label,
      top_count: top.count,
      top_percent: (top.count / answered) * 100,
    });
  }
  fields.sort(
    (a, b) =>
      b.answered - a.answered ||
      b.top_count - a.top_count ||
      a.label.localeCompare(b.label, "pt-BR"),
  );
  const selected = fields.slice(0, 4);
  return selected.length > 0 ? { considered_leads: considered.length, fields: selected } : null;
}

export type EvolutionWindow = { from: string; to: string };

function utcDate(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0, 12));
}

export function buildEvolutionWindows(window: EvolutionWindow): EvolutionWindow[] {
  const from = utcDate(window.from);
  const to = utcDate(window.to);
  const monthMode =
    from.getUTCDate() === 1 &&
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    to.getUTCDate() === endOfMonth(to.getUTCFullYear(), to.getUTCMonth()).getUTCDate();
  if (monthMode) {
    return Array.from({ length: 6 }, (_, index) => {
      const offset = index - 5;
      const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1, 12));
      const end = offset === 0 ? to : endOfMonth(start.getUTCFullYear(), start.getUTCMonth());
      return { from: iso(start), to: iso(end) };
    });
  }

  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  return Array.from({ length: 6 }, (_, index) => {
    const end = new Date(to);
    end.setUTCDate(end.getUTCDate() - (5 - index) * days);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    return { from: iso(start), to: iso(end) };
  });
}

export function defaultTrafficObjective(
  model: DashboardModel,
  language: TrafficSummaryLanguage,
): string {
  if (model === "ecommerce") {
    return text(
      language,
      "Aumentar as vendas online por meio da publicidade digital.",
      "Aumentar las ventas en línea por medio de la publicidad digital.",
    );
  }
  if (model === "messages") {
    return text(
      language,
      "Gerar conversas de pessoas interessadas com a equipe.",
      "Generar conversaciones de personas interesadas con el equipo.",
    );
  }
  return text(
    language,
    "Gerar contatos de pessoas interessadas para a equipe comercial.",
    "Generar contactos de personas interesadas para el equipo comercial.",
  );
}
