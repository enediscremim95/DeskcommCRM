"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { SetaRecolhivel, useRelatorioRecolhivel } from "./RelatorioRecolhivel";

interface FunnelStage {
  key: string;
  label: string;
  value: number;
  rate?: number | null;
  cost?: number | null;
  /**
   * Como a etapa é dita quando é a ORIGEM da passagem ("De 3,8 mil que clicaram, ...").
   * Sem isso a frase usa o rótulo em minúsculas.
   */
  asSource?: string;
  /** Como a etapa é dita quando é o DESTINO da passagem ("..., 441 viraram leads"). */
  asTarget?: string;
  /** Unidade do custo, já no idioma ("por lead"). Sem isso o custo fica só o valor. */
  costLabel?: string;
}

interface FunnelStageGroup {
  key: string;
  label: string;
  stages: FunnelStage[];
}

interface TrafficFunnelMetrics {
  spend?: number;
  impressions: number;
  reach?: number | null;
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

/** "3,8 mil" em vez de "3.812": a frase entre etapas é para ler, não para conferir. */
const formatCompact = (value: number, idioma: string) =>
  new Intl.NumberFormat(idioma === "es" ? "es" : "pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const passageRate = (current: number, previous: number): number | null =>
  previous > 0 ? (current / previous) * 100 : null;

export function recalculateFunnelStages(
  stages: FunnelStage[],
  selectedKeys: readonly string[],
): FunnelStage[] {
  const selected = new Set(selectedKeys);
  const visible = stages.filter((stage) => selected.has(stage.key));
  return visible.map((stage, index) => ({
    ...stage,
    rate: index === 0 ? null : passageRate(stage.value, visible[index - 1]!.value),
  }));
}

export function buildTrafficFunnelStages(
  metrics: TrafficFunnelMetrics,
  model: DashboardModel,
  idioma: string,
): FunnelStage[] {
  const text = (pt: string, es: string) => (idioma === "es" ? es : pt);
  const firstStage =
    metrics.reach != null && metrics.reach > 0
      ? {
          key: "reach",
          label: text("Pessoas alcançadas", "Personas alcanzadas"),
          value: metrics.reach,
          available: true,
          asSource: text("que viram o anúncio", "que vieron el anuncio"),
          asTarget: text("viram o anúncio", "vieron el anuncio"),
          costLabel: text("por pessoa", "por persona"),
        }
      : {
          key: "impressions",
          label: text("Impressões", "Impresiones"),
          value: metrics.impressions,
          available: true,
          asSource: text("exibições", "impresiones"),
          asTarget: text("exibições", "impresiones"),
          costLabel: text("por exibição", "por impresión"),
        };
  const clicks = (value: number, label: string) => ({
    key: "clicks",
    label,
    value,
    available: true,
    asSource: text("que clicaram", "que hicieron clic"),
    asTarget: text("clicaram", "hicieron clic"),
    costLabel: text("por clique", "por clic"),
  });
  const page = {
    key: "page",
    label: text("Visualizações da página", "Visitas a la página"),
    value: metrics.landing_page_views,
    available: metrics.landing_page_views_available,
    asSource: text("que viram a página", "que vieron la página"),
    asTarget: text("viram a página", "vieron la página"),
    costLabel: text("por visualização", "por visita"),
  };
  const raw: Array<FunnelStage & { available: boolean }> =
    model === "leads"
      ? [
          firstStage,
          clicks(metrics.link_clicks, text("Cliques no link", "Clics en el enlace")),
          page,
          {
            key: "leads",
            label: "Leads",
            value: metrics.leads,
            available: true,
            asSource: text("que viraram leads", "que se volvieron leads"),
            asTarget: text("viraram leads", "se volvieron leads"),
            costLabel: text("por lead", "por lead"),
          },
        ]
      : model === "messages"
        ? [
            firstStage,
            clicks(metrics.clicks, text("Cliques", "Clics")),
            {
              key: "messages",
              label: text("Conversas iniciadas", "Conversaciones iniciadas"),
              value: metrics.messaging_conversations,
              available: metrics.messaging_conversations_available,
              asSource: text("que iniciaram conversa", "que iniciaron conversación"),
              asTarget: text("iniciaram conversa", "iniciaron conversación"),
              costLabel: text("por conversa", "por conversación"),
            },
          ]
        : [
            firstStage,
            clicks(metrics.clicks, text("Cliques", "Clics")),
            page,
            {
              key: "cart",
              label: text("Carrinhos", "Carritos"),
              value: metrics.add_to_cart,
              available: metrics.add_to_cart_available,
              asSource: text("que colocaram no carrinho", "que agregaron al carrito"),
              asTarget: text("colocaram no carrinho", "agregaron al carrito"),
              costLabel: text("por carrinho", "por carrito"),
            },
            {
              key: "checkout",
              label: text("Finalizações", "Inicios de pago"),
              value: metrics.initiate_checkout,
              available: metrics.initiate_checkout_available,
              asSource: text("que foram para o pagamento", "que fueron al pago"),
              asTarget: text("foram para o pagamento", "fueron al pago"),
              costLabel: text("por finalização", "por inicio de pago"),
            },
            {
              key: "purchases",
              label: text("Compras", "Compras"),
              value: metrics.conversions,
              available: true,
              asSource: text("que compraram", "que compraron"),
              asTarget: text("compraram", "compraron"),
              costLabel: text("por compra", "por compra"),
            },
          ];

  return raw
    .filter((stage) => stage.available)
    .map((stage, index, stages) => ({
      key: stage.key,
      label: stage.label,
      value: stage.value,
      rate: index === 0 ? null : passageRate(stage.value, stages[index - 1]!.value),
      cost: metrics.spend != null && stage.value > 0 ? metrics.spend / stage.value : null,
      asSource: stage.asSource,
      asTarget: stage.asTarget,
      costLabel: stage.costLabel,
    }));
}

/**
 * A frase entre duas etapas, do jeito que o painel antigo da Veritas falava:
 * "De 3,8 mil que clicaram, 441 viraram leads (11,5%)". Quando a etapa de
 * cima está em zero não há passagem para medir, e a frase fica só com a chegada.
 */
export function passageText(previous: FunnelStage, current: FunnelStage, idioma: string): string {
  const source = previous.asSource ?? previous.label.toLowerCase();
  const target = current.asTarget ?? current.label.toLowerCase();
  const arrived = `${formatCompact(current.value, idioma)} ${target}`;
  if (current.rate == null) return arrived;
  // "De" é igual em português e espanhol.
  return `De ${formatCompact(previous.value, idioma)} ${source}, ${arrived} (${formatNumber(current.rate)}%)`;
}

export function ConversionFunnel({
  title,
  eyebrow,
  stages,
  summary,
  idioma,
  currency,
  organizationKey,
  viewerKey,
  sectionKey = "funnel",
  stageGroups,
}: {
  /** Nome acessível da seção; não é mais exibido (pedido do dono, 21/09/2026). */
  title: string;
  eyebrow?: string;
  stages: FunnelStage[];
  summary: Array<{ label: string; value: string; emphasis?: boolean }>;
  idioma: string;
  currency?: string;
  organizationKey?: string;
  viewerKey?: string;
  sectionKey?: string;
  stageGroups?: FunnelStageGroup[];
}) {
  const text = (pt: string, es: string) => (idioma === "es" ? es : pt);
  const groups = useMemo(
    () =>
      stageGroups ?? [
        {
          key: "default",
          label: idioma === "es" ? "Etapas del embudo" : "Etapas do funil",
          stages,
        },
      ],
    [stageGroups, stages, idioma],
  );
  const availableStages = useMemo(() => groups.flatMap((group) => group.stages), [groups]);
  const availableSignature = availableStages.map((stage) => stage.key).join("|");
  const defaultKeys = useMemo(() => stages.map((stage) => stage.key), [stages]);
  const defaultSignature = defaultKeys.join("|");
  const selectionStorageKey =
    organizationKey && viewerKey
      ? `traffic-report-funnel-stages:${organizationKey}:${viewerKey}:${sectionKey}`
      : null;
  const [selectedKeys, setSelectedKeys] = useState<string[]>(defaultKeys);
  const restoreVersion = useRef(0);
  const { open, toggle } = useRelatorioRecolhivel({
    organizationKey: organizationKey ?? "default",
    viewerKey: viewerKey ?? "default",
    sectionKey,
  });
  const panelId = `traffic-funnel-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    const version = ++restoreVersion.current;
    const timeout = window.setTimeout(() => {
      const available = new Set(availableSignature.split("|").filter(Boolean));
      let next = defaultSignature.split("|").filter(Boolean);
      if (selectionStorageKey) {
        try {
          const raw = window.localStorage.getItem(selectionStorageKey);
          const parsed: unknown = raw ? JSON.parse(raw) : null;
          if (Array.isArray(parsed)) {
            const valid = parsed.filter(
              (key, index): key is string =>
                typeof key === "string" && available.has(key) && parsed.indexOf(key) === index,
            );
            if (valid.length > 0) next = valid;
          }
        } catch {
          try {
            window.localStorage.removeItem(selectionStorageKey);
          } catch {
            // O funil continua com o padrão quando o navegador bloqueia armazenamento.
          }
        }
      }
      if (version === restoreVersion.current) setSelectedKeys(next);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [availableSignature, defaultSignature, selectionStorageKey]);

  const saveSelection = (next: string[]) => {
    restoreVersion.current += 1;
    setSelectedKeys(next);
    if (!selectionStorageKey) return;
    try {
      if (next.join("|") === defaultSignature) window.localStorage.removeItem(selectionStorageKey);
      else window.localStorage.setItem(selectionStorageKey, JSON.stringify(next));
    } catch {
      // A seleção atual continua funcionando mesmo sem persistência.
    }
  };
  const toggleStage = (key: string) => {
    if (selectedKeys.includes(key)) {
      if (selectedKeys.length === 1) return;
      saveSelection(selectedKeys.filter((selected) => selected !== key));
      return;
    }
    const selected = new Set([...selectedKeys, key]);
    saveSelection(
      availableStages.filter((stage) => selected.has(stage.key)).map((stage) => stage.key),
    );
  };
  const visibleStages =
    selectedKeys.join("|") === defaultSignature
      ? stages
      : recalculateFunnelStages(availableStages, selectedKeys);
  const maximum = Math.max(...visibleStages.map((stage) => stage.value), 1);
  const formatCost = (value: number) =>
    currency
      ? new Intl.NumberFormat(idioma === "es" ? "es-ES" : "pt-BR", {
          style: "currency",
          currency,
          maximumFractionDigits: 2,
        }).format(value)
      : formatNumber(value);
  // A menor passagem só faz sentido quando há mais de uma para comparar.
  const rated = visibleStages.filter((stage) => stage.rate != null);
  const weakestKey =
    rated.length >= 2
      ? rated.reduce((weakest, stage) => (stage.rate! < weakest.rate! ? stage : weakest)).key
      : null;
  const weakestLabel = idioma === "es" ? "menor paso del embudo" : "menor passagem do funil";
  const chooseStagesLabel = text("Escolher etapas", "Elegir etapas");
  const selectorDescription = text(
    "Marque o que deve aparecer na apresentação.",
    "Marca lo que debe aparecer en la presentación.",
  );
  const restoreDefaultLabel = text("Restaurar funil padrão", "Restaurar embudo predeterminado");
  return (
    <section
      className="overflow-hidden rounded-3xl border bg-card shadow-[0_24px_80px_-52px_var(--primary)]"
      aria-label={title}
    >
      <div className="relative flex items-center gap-2 overflow-hidden border-b bg-linear-to-r from-primary/[0.15] via-primary/[0.05] to-transparent pr-3">
        <span className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-primary/15 blur-3xl" />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? text("Recolher", "Contraer") : text("Expandir", "Expandir")} ${eyebrow ?? title}`}
          onClick={toggle}
          className="relative flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden sm:px-6"
        >
          <SetaRecolhivel open={open} />
          <span className="truncate text-xs font-semibold tracking-[0.16em] text-primary uppercase">
            {eyebrow ?? title}
          </span>
        </button>
        {stageGroups && (
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="relative shrink-0">
                {chooseStagesLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="max-h-[min(32rem,75vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto"
            >
              <p className="font-semibold">{text("Etapas do funil", "Etapas del embudo")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{selectorDescription}</p>
              <div className="mt-4 space-y-4">
                {groups
                  .filter((group) => group.stages.length > 0)
                  .map((group) => (
                    <fieldset key={group.key}>
                      <legend className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                        {group.label}
                      </legend>
                      <div className="space-y-1">
                        {group.stages.map((stage) => {
                          const checked = selectedKeys.includes(stage.key);
                          return (
                            <label
                              key={stage.key}
                              className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                            >
                              <span className="min-w-0 truncate">{stage.label}</span>
                              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                                {formatNumber(stage.value)}
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={checked && selectedKeys.length === 1}
                                  onChange={() => toggleStage(stage.key)}
                                  className="size-4 accent-primary"
                                  aria-label={stage.label}
                                />
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-3 w-full"
                disabled={selectedKeys.join("|") === defaultSignature}
                onClick={() => saveSelection(defaultKeys)}
              >
                {restoreDefaultLabel}
              </Button>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-center"
      >
        <ol className="mx-auto flex w-full max-w-3xl flex-col items-center" aria-label={title}>
          {visibleStages.map((stage, index) => {
            const proportionalWidth = 42 + Math.sqrt(Math.max(stage.value, 0) / maximum) * 58;
            const previous = index > 0 ? visibleStages[index - 1] : null;
            const weakest = stage.key === weakestKey;
            return (
              <li key={stage.key} className="contents">
                {previous && (
                  <div className="relative z-10 -my-1 flex w-[92%] flex-col items-center justify-center gap-0.5 sm:w-auto">
                    <span
                      className={`rounded-full border px-3 py-1 text-center text-[11px] font-semibold shadow-sm sm:text-xs ${
                        weakest
                          ? "border-error/40 bg-error-bg text-error-fg"
                          : "border-primary/25 bg-background text-primary"
                      }`}
                    >
                      {passageText(previous, stage, idioma)}
                    </span>
                    {weakest && (
                      <span className="text-[10px] font-medium tracking-[0.08em] text-error-fg uppercase">
                        {weakestLabel}
                      </span>
                    )}
                  </div>
                )}
                <div
                  tabIndex={0}
                  className="group/stage relative grid min-h-20 place-items-center overflow-hidden border border-primary/25 bg-linear-to-b from-primary/[0.14] to-primary/[0.06] px-6 py-3 text-center shadow-[0_12px_30px_-24px_var(--primary)] transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:from-primary/[0.2] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-hidden motion-reduce:transition-none"
                  style={{
                    width: `${proportionalWidth}%`,
                    clipPath: "polygon(2% 0, 98% 0, 94% 100%, 6% 100%)",
                  }}
                >
                  <div>
                    <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                      {stage.label}
                    </p>
                    <p className="mt-1 text-[22px] font-semibold tracking-tight text-foreground sm:text-3xl">
                      {formatNumber(stage.value)}
                    </p>
                    {index > 0 && stage.cost != null && (
                      <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                        {formatCost(stage.cost)}
                        {stage.costLabel ? ` ${stage.costLabel}` : ""}
                      </p>
                    )}
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

export type { FunnelStage, FunnelStageGroup, TrafficFunnelMetrics };
