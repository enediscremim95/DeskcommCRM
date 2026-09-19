interface FunnelStage {
  key: string;
  label: string;
  value: number;
  rate?: number | null;
}

interface TrafficFunnelMetrics {
  impressions: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  landing_page_views_available: boolean;
  leads: number;
  add_to_cart: number;
  add_to_cart_available: boolean;
  initiate_checkout: number;
  initiate_checkout_available: boolean;
  conversions: number;
  messaging_conversations: number;
  messaging_conversations_available: boolean;
}

type DashboardModel = "leads" | "messages" | "ecommerce";

const formatNumber = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);

const passageRate = (current: number, previous: number): number | null =>
  previous > 0 ? (current / previous) * 100 : null;

export function buildTrafficFunnelStages(
  metrics: TrafficFunnelMetrics,
  model: DashboardModel,
  idioma: string,
): FunnelStage[] {
  const text = (pt: string, es: string) => (idioma === "es" ? es : pt);
  const raw: Array<FunnelStage & { available: boolean }> =
    model === "leads"
      ? [
          {
            key: "impressions",
            label: text("Impressões", "Impresiones"),
            value: metrics.impressions,
            available: true,
          },
          {
            key: "clicks",
            label: text("Cliques no link", "Clics en el enlace"),
            value: metrics.link_clicks,
            available: true,
          },
          {
            key: "page",
            label: text("Visualizações da página", "Visitas a la página"),
            value: metrics.landing_page_views,
            available: metrics.landing_page_views_available,
          },
          { key: "leads", label: "Leads", value: metrics.leads, available: true },
        ]
      : model === "messages"
        ? [
            {
              key: "impressions",
              label: text("Impressões", "Impresiones"),
              value: metrics.impressions,
              available: true,
            },
            {
              key: "clicks",
              label: text("Cliques", "Clics"),
              value: metrics.clicks,
              available: true,
            },
            {
              key: "messages",
              label: text("Conversas iniciadas", "Conversaciones iniciadas"),
              value: metrics.messaging_conversations,
              available: metrics.messaging_conversations_available,
            },
          ]
        : [
            {
              key: "impressions",
              label: text("Impressões", "Impresiones"),
              value: metrics.impressions,
              available: true,
            },
            {
              key: "clicks",
              label: text("Cliques", "Clics"),
              value: metrics.clicks,
              available: true,
            },
            {
              key: "page",
              label: text("Visualizações da página", "Visitas a la página"),
              value: metrics.landing_page_views,
              available: metrics.landing_page_views_available,
            },
            {
              key: "cart",
              label: text("Carrinhos", "Carritos"),
              value: metrics.add_to_cart,
              available: metrics.add_to_cart_available,
            },
            {
              key: "checkout",
              label: text("Finalizações", "Inicios de pago"),
              value: metrics.initiate_checkout,
              available: metrics.initiate_checkout_available,
            },
            {
              key: "purchases",
              label: text("Compras", "Compras"),
              value: metrics.conversions,
              available: true,
            },
          ];

  return raw
    .filter((stage) => stage.available)
    .map((stage, index, stages) => ({
      key: stage.key,
      label: stage.label,
      value: stage.value,
      rate: index === 0 ? null : passageRate(stage.value, stages[index - 1]!.value),
    }));
}

function rateText(rate: number | null | undefined, idioma: string): string {
  if (rate == null) return idioma === "es" ? "Base del embudo" : "Base do funil";
  return `${formatNumber(rate)}% ${idioma === "es" ? "avanzó" : "avançou"}`;
}

export function ConversionFunnel({
  title,
  description,
  stages,
  summary,
  idioma,
}: {
  title: string;
  description: string;
  stages: FunnelStage[];
  summary: Array<{ label: string; value: string; emphasis?: boolean }>;
  idioma: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-label={title}>
      <div className="border-b bg-linear-to-r from-primary/[0.11] via-primary/[0.04] to-transparent px-4 py-4 sm:px-6">
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
          {idioma === "es" ? "Recorrido de conversión" : "Jornada de conversão"}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center">
        <ol className="mx-auto flex w-full max-w-3xl flex-col items-center" aria-label={title}>
          {stages.map((stage, index) => {
            const inset = Math.min(index * 4, 20);
            const nextInset = Math.min((index + 1) * 4, 24);
            return (
              <li key={stage.key} className="contents">
                {index > 0 && (
                  <div className="relative z-10 -my-1 flex w-[90%] items-center justify-center sm:w-auto">
                    <span className="rounded-full border border-primary/25 bg-background px-3 py-1 text-[11px] font-semibold text-primary shadow-sm sm:text-xs">
                      {rateText(stage.rate, idioma)}
                    </span>
                  </div>
                )}
                <div
                  className="grid min-h-20 w-full place-items-center border border-primary/20 bg-primary/[0.08] px-12 py-3 text-center transition-colors hover:bg-primary/[0.13] motion-reduce:transition-none"
                  style={{
                    clipPath: `polygon(${inset}% 0, ${100 - inset}% 0, ${100 - nextInset}% 100%, ${nextInset}% 100%)`,
                  }}
                >
                  <div>
                    <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      {stage.label}
                    </p>
                    <p className="mt-1 text-[22px] font-semibold tracking-tight text-foreground sm:text-3xl">
                      {formatNumber(stage.value)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <aside
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"
          aria-label={idioma === "es" ? "Resumen del embudo" : "Resumo do funil"}
        >
          {summary.map((item) => (
            <div
              key={item.label}
              className={
                item.emphasis
                  ? "rounded-xl border border-primary/30 bg-primary/[0.08] p-4"
                  : "rounded-xl border bg-muted/25 p-4"
              }
            >
              <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {item.label}
              </p>
              <p className="mt-1 text-xl font-semibold tracking-tight">{item.value}</p>
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
}

export type { FunnelStage, TrafficFunnelMetrics };
