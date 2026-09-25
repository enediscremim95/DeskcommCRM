import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrafficDashboard } from "./TrafficDashboard";

const { translate } = vi.hoisted(() => ({ translate: (value: string) => value }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => translate }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt-BR" }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ orgId: "org-1", name: "Clínica Exemplo", role: "admin" }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="Período"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("recharts", () => ({
  Area: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
vi.mock("@hello-pangea/dnd", () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Droppable: ({ children }: { children: (provided: unknown) => React.ReactNode }) =>
    children({ innerRef: () => undefined, droppableProps: {}, placeholder: null }),
  Draggable: ({ children }: { children: (provided: unknown) => React.ReactNode }) =>
    children({ innerRef: () => undefined, draggableProps: {}, dragHandleProps: {} }),
}));

const metrics = {
  budget: 100,
  budget_type: "daily",
  spend: 50,
  conversions: 5,
  leads: 5,
  landing_page_views: 20,
  cost_per_landing_page_view: 2.5,
  add_to_cart: 4,
  cost_per_add_to_cart: 12.5,
  initiate_checkout: 3,
  cost_per_initiate_checkout: 16.67,
  purchases: 2,
  cost_per_purchase: 25,
  messaging_conversations: 0,
  cost_per_messaging_conversation: null,
  revenue: 200,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 60,
  link_clicks: 50,
  cost_per_conversion: 10,
  cost_per_lead: 10,
  cpm: 50,
  ctr: 5,
  cpc: 1,
  conversion_rate: 10,
  roas: 4,
  average_order_value: 100,
  video_views: 0,
  video_p25: 0,
  video_p50: 0,
  video_p75: 0,
  video_p95: 0,
  landing_page_views_available: true,
  add_to_cart_available: true,
  initiate_checkout_available: true,
  purchases_available: true,
  messaging_conversations_available: false,
} as const;

describe("colunas da tabela de campanhas", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("carrega o preset padrão e permite ao admin salvar as colunas na ordem escolhida", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            data: {
              preset: {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Captação",
                columns: ["spend", "leads", "impressions"],
                is_default: false,
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            model: "leads",
            organization_key: "org-1",
            viewer_key: "user-1",
            default_columns: ["spend", "leads"],
            default_preset_id: "11111111-1111-4111-8111-111111111111",
            column_presets: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Captação",
                columns: ["spend", "leads"],
                is_default: true,
              },
            ],
            can_manage_defaults: true,
            sync: { status: "ready", last_succeeded_at: "2026-09-18T20:00:00Z", error: null },
            crm: { leads_entered: 8, in_service: 5, closed_won: 3 },
            currencies: [
              {
                currency: "BRL",
                summary: metrics,
                daily: [],
                platforms: [{ ...metrics, platform: "meta_ads" }],
                campaigns: [{ ...metrics, name: "Campanha A", platform: "meta_ads", adsets: [] }],
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    expect(await screen.findByText("Campanha A")).toBeInTheDocument();

    await user.click(screen.getByText("Colunas (2)"));
    expect(screen.getByText("Captação")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renomear predefinição" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Impressões" }));
    expect(
      JSON.parse(
        localStorage.getItem("traffic-campaign-columns:org-1:user-1:leads:meta_ads") ?? "[]",
      ),
    ).toEqual(["spend", "leads", "impressions"]);

    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[1]?.method === "PATCH")).toBe(true),
    );
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(String(patchCall?.[0])).toContain(
      "/api/v1/reports/traffic/column-presets/11111111-1111-4111-8111-111111111111",
    );
    expect(patchCall?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        platform: "meta_ads",
        columns: ["spend", "leads", "impressions"],
      }),
    });
  });

  it("alterar colunas do Meta não muda a tabela nem o rascunho do Google", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: {
          model: "leads",
          organization_key: "org-1",
          viewer_key: "user-1",
          default_columns: { meta_ads: ["spend"], google_ads: ["spend"] },
          default_preset_ids: { meta_ads: null, google_ads: null },
          column_presets: { meta_ads: [], google_ads: [] },
          can_manage_defaults: true,
          sync: { status: "ready", last_succeeded_at: null, error: null },
          crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
          currencies: [
            {
              currency: "BRL",
              summary: metrics,
              daily: [],
              platforms: [
                { ...metrics, platform: "meta_ads" },
                { ...metrics, platform: "google_ads" },
              ],
              campaigns: [
                { ...metrics, name: "Meta A", platform: "meta_ads", adsets: [] },
                { ...metrics, name: "Google A", platform: "google_ads", adsets: [] },
              ],
            },
          ],
        },
      }),
    );

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    await screen.findByText("Meta A");

    const menus = screen.getAllByText("Colunas (1)");
    const metaMenu = menus[0]!.parentElement!;
    await user.click(menus[0]!);
    await user.click(within(metaMenu).getByRole("checkbox", { name: "Alcance" }));

    const metaSection = screen.getByRole("heading", { name: "Meta Ads" }).closest("details")!;
    const googleSection = screen.getByRole("heading", { name: "Google Ads" }).closest("details")!;
    expect(within(metaSection).getByRole("columnheader", { name: /Alcance/ })).toBeInTheDocument();
    expect(
      within(googleSection).queryByRole("columnheader", { name: /Alcance/ }),
    ).not.toBeInTheDocument();
    expect(
      localStorage.getItem("traffic-campaign-columns:org-1:user-1:leads:meta_ads"),
    ).toBe('["spend","reach"]');
    expect(
      localStorage.getItem("traffic-campaign-columns:org-1:user-1:leads:google_ads"),
    ).toBeNull();
  });

  it("busca de métrica filtra a lista, sem ligar para acento", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          data: {
            model: "leads",
            organization_key: "org-1",
            viewer_key: "user-1",
            default_columns: ["spend", "leads"],
            default_preset_id: "11111111-1111-4111-8111-111111111111",
            column_presets: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Captação",
                columns: ["spend", "leads"],
                is_default: true,
              },
            ],
            can_manage_defaults: true,
            sync: { status: "ready", last_succeeded_at: "2026-09-18T20:00:00Z", error: null },
            crm: { leads_entered: 8, in_service: 5, closed_won: 3 },
            currencies: [
              {
                currency: "BRL",
                summary: metrics,
                daily: [],
                platforms: [{ ...metrics, platform: "meta_ads" }],
                campaigns: [{ ...metrics, name: "Campanha A", platform: "meta_ads", adsets: [] }],
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    expect(await screen.findByText("Campanha A")).toBeInTheDocument();
    await user.click(screen.getByText("Colunas (2)"));
    await user.type(screen.getByRole("textbox", { name: "Buscar métrica" }), "VISUALIZA");
    expect(screen.getByRole("checkbox", { name: "Visualizações da página" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Impressões" })).not.toBeInTheDocument();
  });

  it("recarrega o funil quando o período muda", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          data: {
            model: "leads",
            organization_key: "org-1",
            viewer_key: "user-1",
            default_columns: ["spend", "leads"],
            default_preset_id: "11111111-1111-4111-8111-111111111111",
            column_presets: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Captação",
                columns: ["spend", "leads"],
                is_default: true,
              },
              {
                id: "22222222-2222-4222-8222-222222222222",
                name: "Diretoria",
                columns: ["roas"],
                is_default: false,
              },
            ],
            can_manage_defaults: false,
            sync: { status: "ready", last_succeeded_at: null, error: null },
            crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
            currencies: [
              {
                currency: "BRL",
                summary: metrics,
                daily: [],
                  platforms: [{ ...metrics, platform: "meta_ads" }],
                  campaigns: [
                    { ...metrics, name: "Campanha A", platform: "meta_ads", adsets: [] },
                  ],
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    expect(await screen.findByRole("region", { name: "Do alcance à venda fechada" })).toBeInTheDocument();
    expect(screen.queryByText("Do alcance à venda fechada")).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Do alcance à venda fechada" })).toHaveLength(1);
    await user.click(screen.getByText("Colunas (2)"));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Predefinição de colunas" }),
      "22222222-2222-4222-8222-222222222222",
    );
    expect(localStorage.getItem("traffic-campaign-preset:org-1:user-1:leads:meta_ads")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(screen.queryByRole("button", { name: /^Salvar$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Período" }), "7");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Colunas (1)")).toBeInTheDocument();
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondUrl).toContain("/api/v1/reports/traffic?from=");
    expect(secondUrl).toContain("&to=");
  });

  it("não mantém os números da janela anterior visíveis enquanto o novo período carrega", async () => {
    let finishSevenDays: ((response: Response) => void) | undefined;
    const sevenDaysResponse = new Promise<Response>((resolve) => {
      finishSevenDays = resolve;
    });
    const responseFor = (name: string, spend: number) =>
      Response.json({
        data: {
          model: "leads",
          organization_key: "org-1",
          viewer_key: "viewer-1",
          default_columns: ["spend"],
          default_preset_id: null,
          column_presets: [],
          can_manage_defaults: false,
          sync: { status: "ready", last_succeeded_at: null, error: null },
          crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
          currencies: [
            {
              currency: "BRL",
              summary: { ...metrics, spend },
              comparison: null,
              daily: [],
              platforms: [{ ...metrics, spend, platform: "meta_ads" }],
              campaigns: [
                {
                  ...metrics,
                  spend,
                  name,
                  platform: "meta_ads",
                  campaign_status: "ACTIVE",
                  adsets: [],
                },
              ],
            },
          ],
        },
      });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(responseFor("Campanha do período inteiro", 606.39))
      .mockImplementationOnce(async () => sevenDaysResponse);

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    expect(await screen.findByText("Campanha do período inteiro")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Período" }), "7");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Carregando relatório…")).toBeInTheDocument();
    expect(screen.queryByText("Campanha do período inteiro")).not.toBeInTheDocument();
    expect(screen.queryByText(/606,39/)).not.toBeInTheDocument();

    finishSevenDays?.(responseFor("Campanha dos últimos 7 dias", 19.89));
    expect(await screen.findByText("Campanha dos últimos 7 dias")).toBeInTheDocument();
    expect(screen.queryByText("Campanha do período inteiro")).not.toBeInTheDocument();
  });

  it("baixa o PDF do período atual mesmo para quem não gerencia predefinições", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/reports/traffic/pdf?")) {
        return new Response(new Blob(["pdf"], { type: "application/pdf" }), {
          status: 200,
          headers: {
            "Content-Disposition":
              'attachment; filename="relatorio-resumido-2026-09-01-a-2026-09-30.pdf"',
            "Content-Type": "application/pdf",
          },
        });
      }
      return Response.json({
        data: {
          model: "leads",
          organization_key: "org-1",
          viewer_key: "viewer-1",
          default_columns: ["spend", "leads"],
          default_preset_id: null,
          column_presets: [],
          can_manage_defaults: false,
          sync: { status: "ready", last_succeeded_at: null, error: null },
          crm: { leads_entered: 8, in_service: 5, closed_won: 3 },
          currencies: [
            {
              currency: "BRL",
              summary: metrics,
              comparison: null,
              daily: [],
              platforms: [],
              campaigns: [],
            },
          ],
        },
      });
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:relatorio"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    await user.click(await screen.findByRole("button", { name: "Baixar relatório" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/reports/traffic/pdf?"),
        expect.objectContaining({ headers: { accept: "application/pdf" } }),
      ),
    );
    const pdfUrl = String(fetchMock.mock.calls.find(([url]) => String(url).includes("/pdf?"))?.[0]);
    expect(pdfUrl).toContain("from=");
    expect(pdfUrl).toContain("to=");
    expect(pdfUrl).toContain("language=pt-BR");
    expect(click).toHaveBeenCalledOnce();
  });

  it("filtra por status, persiste a escolha e ordena campanhas sem separar seus detalhes", async () => {
    const response = {
      data: {
        model: "leads", organization_key: "org-1", viewer_key: "viewer-1",
        default_columns: ["spend", "leads"], default_preset_id: null,
        column_presets: [], can_manage_defaults: false,
        sync: { status: "ready", last_succeeded_at: null, error: null },
        crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
        currencies: [{
          currency: "BRL", summary: metrics, comparison: null, daily: [],
          platforms: [{ ...metrics, platform: "meta_ads" }],
          campaigns: [
            { ...metrics, spend: 10, name: "Alpha", platform: "meta_ads", campaign_status: "ACTIVE", adsets: [{ ...metrics, name: "Conjunto Alpha", ads: [] }] },
            { ...metrics, spend: 30, name: "Beta", platform: "meta_ads", campaign_status: "PAUSED", adsets: [{ ...metrics, name: "Conjunto Beta", ads: [] }] },
            { ...metrics, spend: 20, name: "Gamma", platform: "meta_ads", campaign_status: "ARCHIVED", adsets: [{ ...metrics, name: "Conjunto Gamma", ads: [] }] },
          ],
        }],
      },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(response));
    const user = userEvent.setup();
    const { unmount } = render(<TrafficDashboard />);
    const alpha = await screen.findByText("Alpha");
    const beta = screen.getByText("Beta");
    const gamma = screen.getByText("Gamma");
    const appearsBefore = (first: HTMLElement, second: HTMLElement) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(screen.getByRole("columnheader", { name: /Valor gasto/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(appearsBefore(beta, gamma)).toBe(true);
    expect(appearsBefore(gamma, alpha)).toBe(true);
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.getByText("Pausada")).toBeInTheDocument();
    expect(screen.getByText("Encerrada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ordenar por Valor gasto" }));
    expect(screen.getByRole("columnheader", { name: /Valor gasto/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(appearsBefore(alpha, gamma)).toBe(true);
    expect(appearsBefore(gamma, beta)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Ordenar por Campanha" }));
    expect(appearsBefore(gamma, beta)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Ordenar por Campanha" }));
    expect(appearsBefore(alpha, beta)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Pausadas" }));
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
    expect(localStorage.getItem("traffic-campaign-status-filter:meta_ads")).toBe("paused");
    expect(screen.queryByRole("combobox", { name: /status/i })).not.toBeInTheDocument();
    expect(screen.getByText("Total").closest("tfoot")).not.toBeNull();

    unmount();
    render(<TrafficDashboard />);
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
  });

  it("filtra Meta e Google separadamente no formato real da rota e recalcula o total visível", async () => {
    const campaign = (
      name: string,
      platform: "meta_ads" | "google_ads",
      campaign_status: string | null,
      spend: number,
    ) => ({ ...metrics, name, platform, campaign_status, spend, adsets: [] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: {
          model: "leads",
          organization_key: "org-1",
          viewer_key: "viewer-1",
          default_columns: ["spend"],
          default_preset_id: null,
          column_presets: [],
          can_manage_defaults: false,
          sync: { status: "ready", last_succeeded_at: "2026-09-21T20:00:00Z", error: null },
          window: { from: "2026-09-15", to: "2026-09-21" },
          previous_window: { from: "2026-09-08", to: "2026-09-14" },
          crm: {
            leads_entered: 0,
            in_service: 0,
            closed_won: 0,
            previous: { leads_entered: 0, in_service: 0, closed_won: 0 },
          },
          delivery: { campaigns: [] },
          currencies: [
            {
              currency: "BRL",
              summary: { ...metrics, spend: 150 },
              comparison: null,
              daily: [],
              platforms: [
                { ...metrics, platform: "meta_ads", spend: 60 },
                { ...metrics, platform: "google_ads", spend: 90 },
              ],
              campaigns: [
                campaign("Meta ativa", "meta_ads", "ACTIVE", 10),
                campaign("Meta pausada", "meta_ads", "PAUSED", 30),
                campaign("Meta sem status", "meta_ads", null, 20),
                campaign("Google ativa", "google_ads", "ENABLED", 40),
                campaign("Google pausada", "google_ads", "PAUSED", 50),
              ],
            },
          ],
        },
      }),
    );

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    await screen.findByText("Meta ativa");
    const groups = screen.getAllByRole("group", { name: "Filtrar campanhas por status" });
    const metaGroup = groups[0]!;
    const googleGroup = groups[1]!;
    const metaTable = metaGroup.parentElement!.parentElement!.querySelector("table")!;
    const googleTable = googleGroup.parentElement!.parentElement!.querySelector("table")!;

    expect(metaTable.tBodies[0]?.rows).toHaveLength(3);
    expect(googleTable.tBodies[0]?.rows).toHaveLength(2);

    await user.click(within(metaGroup).getByRole("button", { name: "Ativas" }));
    expect(metaTable.tBodies[0]?.rows).toHaveLength(1);
    expect(within(metaTable).getByText("Meta ativa")).toBeInTheDocument();
    expect(within(metaTable).getByText("Total").closest("tr")).toHaveTextContent("R$ 10,00");
    expect(googleTable.tBodies[0]?.rows).toHaveLength(2);

    await user.click(within(metaGroup).getByRole("button", { name: "Pausadas" }));
    expect(metaTable.tBodies[0]?.rows).toHaveLength(1);
    expect(within(metaTable).getByText("Meta pausada")).toBeInTheDocument();
    expect(within(metaTable).getByText("Total").closest("tr")).toHaveTextContent("R$ 30,00");

    await user.click(within(googleGroup).getByRole("button", { name: "Pausadas" }));
    expect(googleTable.tBodies[0]?.rows).toHaveLength(1);
    expect(within(googleTable).getByText("Google pausada")).toBeInTheDocument();
    expect(within(googleTable).getByText("Total").closest("tr")).toHaveTextContent("R$ 50,00");
    expect(localStorage.getItem("traffic-campaign-status-filter:meta_ads")).toBe("paused");
    expect(localStorage.getItem("traffic-campaign-status-filter:google_ads")).toBe("paused");
  });

  it("não deixa a restauração atrasada do filtro salvo desfazer o clique atual", async () => {
    localStorage.setItem("traffic-campaign-status-filter:meta_ads", "all");
    const pending: Array<() => void> = [];
    let captureStatusRestore = false;
    const nativeGetItem = Storage.prototype.getItem;
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      const value = nativeGetItem.call(this, key);
      if (key === "traffic-campaign-status-filter:meta_ads") captureStatusRestore = true;
      return value;
    });
    const nativeSetTimeout = window.setTimeout.bind(window);
    const timeout = vi.spyOn(window, "setTimeout").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (captureStatusRestore && delay === 0 && typeof handler === "function") {
        captureStatusRestore = false;
        pending.push(() => handler(...args));
        return 99;
      }
      return nativeSetTimeout(handler, delay, ...args);
    }) as unknown as typeof window.setTimeout);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        baseResponse([
          campaignWithStatus("Meta ativa", "ACTIVE", 10),
          campaignWithStatus("Meta pausada", "PAUSED", 30),
        ], ["spend"]),
      ),
    );

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    await screen.findByText("Meta ativa");
    getItem.mockRestore();
    timeout.mockRestore();
    await user.click(screen.getByRole("button", { name: "Pausadas" }));
    expect(screen.queryByText("Meta ativa")).not.toBeInTheDocument();
    expect(screen.getByText("Meta pausada")).toBeInTheDocument();

    await act(async () => {
      for (const run of pending) run();
    });

    expect(screen.queryByText("Meta ativa")).not.toBeInTheDocument();
    expect(screen.getByText("Meta pausada")).toBeInTheDocument();
  });

  const baseResponse = (campaigns: unknown[], columns = ["spend", "leads", "impressions"]) => ({
    data: {
      model: "leads", organization_key: "org-1", viewer_key: "viewer-1",
      default_columns: columns, default_preset_id: null,
      column_presets: [], can_manage_defaults: false,
      sync: { status: "ready", last_succeeded_at: null, error: null },
      crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
      currencies: [{
        currency: "BRL", summary: metrics, comparison: null, daily: [],
        platforms: [{ ...metrics, platform: "meta_ads" }],
        campaigns,
      }],
    },
  });
  const campaignWithStatus = (name: string, campaign_status: string | null, spend: number) => ({
    ...metrics,
    name,
    platform: "meta_ads",
    campaign_status,
    spend,
    adsets: [],
  });
  const creativeResponse = (priorityMetrics: string[] = ["leads", "spend"]) => {
    const response = baseResponse([{
      ...metrics,
      name: "Campanha de criativos",
      platform: "meta_ads",
      campaign_status: "ACTIVE",
      adsets: [{
        ...metrics,
        name: "Conjunto principal",
        ads: [
          { ...metrics, name: "Criativo campeão", spend: 80, conversions: 8, thumbnail_url: null },
          { ...metrics, name: "Criativo secundário", spend: 20, conversions: 2, thumbnail_url: null },
        ],
      }],
    }]);
    return { data: { ...response.data, priority_metrics: priorityMetrics } };
  };
  const headerNames = (table: HTMLTableElement) =>
    Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) =>
      (cell.textContent ?? "").replace(/[▼▲]/g, "").trim(),
    );
  const columnIndex = (table: HTMLTableElement, header: string) =>
    headerNames(table).findIndex((name) => name.includes(header));
  const dragColumn = (
    source: HTMLElement,
    target: HTMLElement,
    clientX = 90,
  ) => {
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      width: 0, height: 40, top: 0, right: 0, bottom: 40,
      left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientX });
    return {
      drop: () => {
        fireEvent.drop(target, { dataTransfer, clientX });
        fireEvent.dragEnd(source, { dataTransfer });
      },
    };
  };

  it("campanhas com o MESMO nome ordenam certo e não se repetem (print do dono, 21/09/2026)", async () => {
    const mesmoNome = (id: string, spend: number) => ({
      ...metrics, id: `meta_ads:${id}`, spend, name: "Nova campanha de Leads",
      platform: "meta_ads", campaign_status: "ACTIVE", adsets: [],
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        baseResponse([mesmoNome("1", 599.65), mesmoNome("2", 499.86), mesmoNome("3", 199.06), mesmoNome("4", 21.27)], ["spend"]),
      ),
    );
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const table = (await screen.findAllByText("Nova campanha de Leads"))[0]!.closest("table") as HTMLTableElement;
    const gastos = () =>
      Array.from(table.tBodies[0]?.rows ?? []).map((row) => (row.cells[row.cells.length - 1]?.textContent ?? "").replace(/ /g, " "));

    expect(gastos()).toEqual(["R$ 599,65", "R$ 499,86", "R$ 199,06", "R$ 21,27"]);
    await user.click(within(table).getByRole("button", { name: /Ordenar por Valor gasto/i }));
    expect(gastos()).toEqual(["R$ 21,27", "R$ 199,06", "R$ 499,86", "R$ 599,65"]);
  });

  it("todo cabeçalho de métrica ordena, não só o valor gasto (dono, 21/09/2026)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        baseResponse(
          [
            { ...metrics, spend: 30, impressions: 10, ctr: 1, cpc: 3, link_clicks: 5, name: "Gasta mais", platform: "meta_ads", campaign_status: "ACTIVE", adsets: [] },
            { ...metrics, spend: 10, impressions: 500, ctr: 5, cpc: 1, link_clicks: 50, name: "Gasta menos", platform: "meta_ads", campaign_status: "ACTIVE", adsets: [] },
          ],
          ["spend", "impressions", "ctr", "link_clicks", "cpc"],
        ),
      ),
    );
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const table = (await screen.findByText("Gasta mais")).closest("table") as HTMLTableElement;
    const primeira = () => table.tBodies[0]?.rows[0]?.textContent ?? "";

    expect(primeira()).toContain("Gasta mais");
    for (const coluna of ["Impressões", "CTR", "Cliques no link"]) {
      await user.click(within(table).getByRole("button", { name: new RegExp(`Ordenar por ${coluna}`, "i") }));
      expect(primeira(), coluna).toContain("Gasta menos");
      await user.click(within(table).getByRole("button", { name: new RegExp(`Ordenar por ${coluna}`, "i") }));
      expect(primeira(), `${coluna} ao contrário`).toContain("Gasta mais");
    }
  });

  it("cada valor fica sob o seu cabeçalho: nome, status e as métricas na ordem da predefinição", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        baseResponse([
          { ...metrics, spend: 30, leads: 7, impressions: 1234, name: "Beta", platform: "meta_ads", campaign_status: "ACTIVE", adsets: [{ ...metrics, name: "Conjunto Beta", ads: [] }] },
          { ...metrics, spend: 10, leads: 2, impressions: 99, name: "Alpha", platform: "meta_ads", campaign_status: null, adsets: [] },
        ]),
      ),
    );
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const beta = await screen.findByText("Beta");
    const table = beta.closest("table") as HTMLTableElement;

    expect(headerNames(table)).toEqual([
      "Campanha", "Status", "Valor gasto", "Leads", "Impressões",
    ]);
    const statusColumn = columnIndex(table, "Status");
    const spendColumn = columnIndex(table, "Valor gasto");
    const impressionsColumn = columnIndex(table, "Impressões");
    const rows = Array.from(table.tBodies[0]?.rows ?? []);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.cells).toHaveLength(headerNames(table).length);
    }
    const betaRow = beta.closest("tr") as HTMLTableRowElement;
    expect(betaRow.cells[0]).toHaveTextContent("Beta");
    expect(betaRow.cells[statusColumn]).toHaveTextContent("Ativa");
    expect(betaRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s30,00$/);
    expect(betaRow.cells[impressionsColumn]?.textContent).toBe("1.234");
    const alphaRow = screen.getByText("Alpha").closest("tr") as HTMLTableRowElement;
    expect(alphaRow.cells[statusColumn]).toHaveTextContent("Não informada");
    expect(alphaRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s10,00$/);

    const totalRow = screen.getByText("Total").closest("tr") as HTMLTableRowElement;
    expect(totalRow.cells).toHaveLength(headerNames(table).length);
    expect(totalRow.cells[statusColumn]?.textContent).toBe("");
    expect(totalRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s40,00$/);

    // Sem status conhecido a campanha só aparece em "Todas".
    await user.click(screen.getByRole("button", { name: "Ativas" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pausadas" }));
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Todas" }));

    // O conjunto é uma linha da mesma tabela, com as mesmas colunas e larguras.
    await user.click(screen.getByRole("button", { name: /^Beta/, expanded: false }));
    const adsetRow = screen.getByText("Conjunto Beta").closest("tr") as HTMLTableRowElement;
    expect(adsetRow.cells).toHaveLength(headerNames(table).length);
    expect(adsetRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s50,00$/);
    expect(adsetRow.cells[impressionsColumn]?.textContent).toBe("1.000");
    expect(within(adsetRow).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Beta/, expanded: true })).toBeInTheDocument();
  });

  it("alinha conjunto e anúncio, respeita colunas ocultas e abre os dois níveis pelo teclado", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        baseResponse(
          [
            {
              ...metrics,
              name: "Campanha com detalhe",
              platform: "meta_ads",
              campaign_status: "ACTIVE",
              spend: 30,
              leads: 7,
              impressions: 1234,
              adsets: [
                {
                  ...metrics,
                  name: "Conjunto alinhado",
                  spend: 12,
                  leads: 3,
                  impressions: 456,
                  ads: [
                    {
                      ...metrics,
                      name: "Anúncio alinhado",
                      spend: 4,
                      leads: 1,
                      impressions: 123,
                      thumbnail_url: null,
                      story_id: null,
                    },
                  ],
                },
              ],
            },
            {
              ...metrics,
              name: "Campanha sem filhos",
              platform: "meta_ads",
              campaign_status: "ACTIVE",
              adsets: [],
            },
          ],
          ["spend", "leads", "impressions"],
        ),
      ),
    );

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const campaignButton = await screen.findByRole("button", {
      name: /^Campanha com detalhe/,
      expanded: false,
    });
    expect(campaignButton).toHaveTextContent("1 conjunto");
    expect(screen.queryByRole("button", { name: /Campanha sem filhos/ })).not.toBeInTheDocument();

    campaignButton.focus();
    await user.keyboard("{Enter}");
    expect(campaignButton).toHaveAttribute("aria-expanded", "true");

    const table = campaignButton.closest("table") as HTMLTableElement;
    const spendColumn = columnIndex(table, "Valor gasto");
    const leadsColumn = columnIndex(table, "Leads");
    const impressionsColumn = columnIndex(table, "Impressões");
    const adsetButton = screen.getByRole("button", {
      name: /^Conjunto alinhado/,
      expanded: false,
    });
    expect(adsetButton).toHaveTextContent("1 anúncio");
    const adsetRow = adsetButton.closest("tr") as HTMLTableRowElement;
    expect(adsetRow.cells).toHaveLength(headerNames(table).length);
    expect(adsetRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s12,00$/);
    expect(adsetRow.cells[leadsColumn]?.textContent).toBe("3");
    expect(adsetRow.cells[impressionsColumn]?.textContent).toBe("456");

    adsetButton.focus();
    await user.keyboard(" ");
    expect(adsetButton).toHaveAttribute("aria-expanded", "true");
    const adRow = within(table).getByText("Anúncio alinhado").closest("tr") as HTMLTableRowElement;
    expect(adRow.cells).toHaveLength(headerNames(table).length);
    expect(adRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s4,00$/);
    expect(adRow.cells[leadsColumn]?.textContent).toBe("1");
    expect(adRow.cells[impressionsColumn]?.textContent).toBe("123");

    await user.click(screen.getByText("Colunas (3)"));
    await user.click(screen.getByRole("checkbox", { name: "Impressões" }));
    expect(headerNames(table)).toEqual(["Campanha", "Status", "Valor gasto", "Leads"]);
    expect(adsetRow.cells).toHaveLength(4);
    expect(adRow.cells).toHaveLength(4);
    expect(within(adsetRow).queryByText("456")).not.toBeInTheDocument();
    expect(within(adRow).queryByText("123")).not.toBeInTheDocument();

    adsetButton.focus();
    await user.keyboard(" ");
    expect(within(table).queryByText("Anúncio alinhado")).not.toBeInTheDocument();
    campaignButton.focus();
    await user.keyboard("{Enter}");
    expect(within(table).queryByText("Conjunto alinhado")).not.toBeInTheDocument();
  });

  it("esconde o filtro e a coluna de status quando nenhuma campanha tem status conhecido", async () => {
    localStorage.setItem("traffic-campaign-status-filter:meta_ads", "active");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        baseResponse([
          { ...metrics, spend: 30, name: "Beta", platform: "meta_ads", campaign_status: null, adsets: [] },
          { ...metrics, spend: 10, name: "Alpha", platform: "meta_ads", campaign_status: "", adsets: [] },
        ]),
      ),
    );
    render(<TrafficDashboard />);
    const beta = await screen.findByText("Beta");
    const table = beta.closest("table") as HTMLTableElement;
    expect(headerNames(table)).toEqual(["Campanha", "Valor gasto", "Leads", "Impressões"]);
    expect(screen.queryByRole("group", { name: "Filtrar campanhas por status" })).not.toBeInTheDocument();
    expect(screen.queryByText("Não informada")).not.toBeInTheDocument();
    // O filtro "Ativas" lembrado não some com as campanhas quando o status ainda não chegou.
    await waitFor(() => expect(screen.getByText("Alpha")).toBeInTheDocument());
    for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
      expect(row.cells).toHaveLength(4);
    }
    expect(screen.getByText("Total").closest("tr")?.cells).toHaveLength(4);
  });

  it("marca uma campanha sem ordenar nem abrir o detalhamento", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(baseResponse([
      campaignWithStatus("Maior investimento", "ACTIVE", 80),
      campaignWithStatus("Menor investimento", "ACTIVE", 20),
    ], ["spend"])));
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const table = (await screen.findByText("Maior investimento")).closest("table") as HTMLTableElement;

    await user.click(within(table).getByRole("checkbox", {
      name: "Selecionar campanha Menor investimento",
    }));

    expect(table.tBodies[0]?.rows[0]).toHaveTextContent("Maior investimento");
    expect(within(table).queryByRole("button", {
      name: "Maior investimento",
    })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 campanha marcada");
  });

  it("marcar tudo respeita o filtro de status e mantém seleções fora dele", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(baseResponse([
      campaignWithStatus("Meta ativa", "ACTIVE", 70),
      campaignWithStatus("Meta pausada", "PAUSED", 30),
    ], ["spend"])));
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const table = (await screen.findByText("Meta ativa")).closest("table") as HTMLTableElement;

    await user.click(screen.getByRole("button", { name: "Pausadas" }));
    await user.click(within(table).getByRole("checkbox", {
      name: "Selecionar campanhas visíveis",
    }));
    expect(within(table).getByRole("checkbox", {
      name: "Selecionar campanha Meta pausada",
    })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Todas" }));
    expect(within(table).getByRole("checkbox", {
      name: "Selecionar campanha Meta ativa",
    })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("1 campanha marcada");
    await user.click(screen.getByRole("button", { name: "Pausadas" }));
    await user.click(within(table).getByRole("checkbox", {
      name: "Selecionar campanhas visíveis",
    }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("busca sem acento, marca só o resultado e limpa sem perder a seleção", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(baseResponse([
      campaignWithStatus("Promoção de Inverno", "ACTIVE", 50),
      campaignWithStatus("Sempre Visível", "ACTIVE", 30),
      campaignWithStatus("Outra Campanha", "ACTIVE", 20),
    ], ["spend"])));
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const table = (await screen.findByText("Promoção de Inverno")).closest("table") as HTMLTableElement;

    await user.click(within(table).getByRole("checkbox", {
      name: "Selecionar campanha Sempre Visível",
    }));
    await user.type(screen.getByRole("searchbox", { name: "Pesquisar campanha" }), "promocao");

    expect(within(table).getByText("Promoção de Inverno")).toBeInTheDocument();
    expect(within(table).queryByText("Sempre Visível")).not.toBeInTheDocument();
    expect(screen.getByText("1 campanha encontrada")).toBeInTheDocument();

    await user.click(within(table).getByRole("checkbox", {
      name: "Selecionar campanhas visíveis",
    }));
    expect(screen.getByRole("status")).toHaveTextContent("2 campanhas marcadas");

    await user.click(screen.getByRole("button", { name: "Limpar pesquisa" }));
    expect(within(table).getByRole("checkbox", {
      name: "Selecionar campanha Promoção de Inverno",
    })).toBeChecked();
    expect(within(table).getByRole("checkbox", {
      name: "Selecionar campanha Sempre Visível",
    })).toBeChecked();
    expect(within(table).getByRole("checkbox", {
      name: "Selecionar campanha Outra Campanha",
    })).not.toBeChecked();

    await user.type(screen.getByRole("searchbox", { name: "Pesquisar campanha" }), "inexistente");
    expect(within(table).getByText("Nenhuma campanha corresponde à pesquisa e aos filtros."))
      .toBeInTheDocument();
  });

  it("resume as marcadas e o total acompanha exatamente as linhas visíveis", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(baseResponse([
      { ...campaignWithStatus("Campanha A", "ACTIVE", 30), conversions: 3, leads: 3 },
      { ...campaignWithStatus("Campanha B", "ACTIVE", 20), conversions: 1, leads: 1 },
      { ...campaignWithStatus("Campanha C", "PAUSED", 50), conversions: 5, leads: 5 },
    ], ["spend", "leads"])));
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    const table = (await screen.findByText("Campanha A")).closest("table") as HTMLTableElement;
    const spendColumn = columnIndex(table, "Valor gasto");
    const leadsColumn = columnIndex(table, "Leads");

    await user.click(within(table).getByRole("checkbox", { name: "Selecionar campanha Campanha A" }));
    await user.click(within(table).getByRole("checkbox", { name: "Selecionar campanha Campanha B" }));

    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent("2 campanhas marcadas");
    expect(bar).toHaveTextContent(/Investimento:\s*R\$\s*50,00/);
    expect(bar).toHaveTextContent(/Conversões:\s*4/);
    expect(bar).toHaveTextContent(/Custo por conversão:\s*R\$\s*12,50/);
    expect(bar).toHaveTextContent("Os cards do topo e o funil mostram o período inteiro.");

    await user.click(screen.getByRole("button", { name: "Ver só as selecionadas" }));
    expect(screen.queryByText("Campanha C")).not.toBeInTheDocument();
    const totalRow = screen.getByText("Total").closest("tr") as HTMLTableRowElement;
    expect(totalRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s50,00$/);
    expect(totalRow.cells[leadsColumn]?.textContent).toBe("4");

    await user.click(screen.getByRole("button", { name: "Ver todas as campanhas" }));
    expect(screen.getByText("Campanha C")).toBeInTheDocument();
    expect(totalRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s100,00$/);
    await user.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("limpa a seleção quando o período muda", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(baseResponse([campaignWithStatus("Campanha do período", "ACTIVE", 50)])));
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    await user.click(await screen.findByRole("checkbox", {
      name: "Selecionar campanha Campanha do período",
    }));
    expect(screen.getByRole("status")).toHaveTextContent("1 campanha marcada");

    await user.selectOptions(screen.getByRole("combobox", { name: "Período" }), "7");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText("Campanha do período");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", {
      name: "Selecionar campanha Campanha do período",
    })).not.toBeChecked();
  });

  it("mantém as seleções de Meta e Google independentes", async () => {
    const response = baseResponse([
      campaignWithStatus("Meta escolhida", "ACTIVE", 30),
      { ...metrics, id: "google_ads:1", name: "Google separada", platform: "google_ads",
        campaign_status: "ENABLED", spend: 20, adsets: [] },
    ]);
    response.data.currencies[0]!.platforms.push({ ...metrics, platform: "google_ads" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(response));
    const user = userEvent.setup();
    render(<TrafficDashboard />);

    await user.click(await screen.findByRole("checkbox", {
      name: "Selecionar campanha Meta escolhida",
    }));

    expect(screen.getByRole("checkbox", { name: "Selecionar campanha Meta escolhida" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Selecionar campanha Google separada" })).not.toBeChecked();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("fala em linguagem simples: nome da organização, frases nos KPIs, retenção real e detalhe do anúncio", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        data: {
          model: "leads", organization_key: "org-1", viewer_key: "viewer-1",
          default_columns: ["spend", "leads"], default_preset_id: null,
          column_presets: [], can_manage_defaults: false,
          sync: { status: "ready", last_succeeded_at: "2026-09-18T20:00:00Z", error: null },
          crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
          currencies: [{
            currency: "BRL",
            summary: { ...metrics, cost_per_lead: 12.5 },
            comparison: { ...metrics, cost_per_lead: 20, spend: 40 },
            daily: [],
            platforms: [{
              ...metrics, platform: "meta_ads",
              impressions: 1000, video_views: 300, video_p25: 200, video_p50: 100, video_p75: 50, video_p95: 10,
            }],
            campaigns: [{
              ...metrics, name: "RMKT Clínica", platform: "meta_ads", campaign_status: "ACTIVE",
              adsets: [{
                ...metrics, name: "Conjunto Frio", spend: 40, conversions: 4,
                ads: [
                  { ...metrics, name: "Vídeo depoimento", spend: 30, conversions: 3, thumbnail_url: null, story_id: "123_456" },
                  { ...metrics, name: "Imagem oferta", spend: 10, conversions: 0, thumbnail_url: "https://cdn.example/x.jpg", story_id: null },
                ],
              }],
            }],
          }],
        },
      }),
    );
    const user = userEvent.setup();
    render(<TrafficDashboard />);
    expect(await screen.findByRole("heading", { level: 1, name: "Clínica Exemplo" })).toBeInTheDocument();
    expect(screen.getByText(/^Dados até 18\/09\/2026$/)).toBeInTheDocument();

    // Frases embaixo dos KPIs e a cor da variação seguindo "melhor quando".
    expect(screen.getAllByText("pessoas únicas que viram").length).toBeGreaterThan(0);
    expect(screen.getByText("custo por 1.000 exibições")).toBeInTheDocument();
    expect(screen.getByText("Meta + Google")).toBeInTheDocument();
    const cpl = screen
      .getAllByText("Custo por lead")
      .map((element) => element.closest("button"))
      .find((element): element is HTMLButtonElement => element instanceof HTMLButtonElement)!;
    expect(cpl.textContent).toContain("↓ 37,5%");
    expect(cpl.querySelector(".text-success-fg")).not.toBeNull();
    const spend = screen.getByRole("button", { name: /^Investimento/ });
    expect(spend.querySelector(".text-success-fg")).not.toBeNull();

    // Retenção real: Hook = 3s ÷ impressões, Body = 75% ÷ impressões, barras relativas ao 25%.
    expect(screen.getByText("pararam para assistir").parentElement?.textContent).toContain("30%");
    expect(screen.getByText("viram até o fim").parentElement?.textContent).toContain("5%");
    const bar95 = screen.getByText("View 95%").closest("li")?.querySelector(".bg-error") as HTMLElement;
    expect(bar95.style.width).toBe("5%");
    const bar25 = screen.getByText("View 25%").closest("li")?.querySelector(".bg-success") as HTMLElement;
    expect(bar25.style.width).toBe("100%");

    // Descrição leiga embaixo do nome da campanha e detalhamento conjunto → anúncio.
    expect(screen.getByText("Remarketing: quem já viu")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /RMKT Clínica/, expanded: false }));
    expect(screen.getByText("Conjunto Frio")).toBeInTheDocument();
    expect(screen.getByText("2 anúncios")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Conjunto Frio/, expanded: false }));
    const link = screen.getByRole("link", { name: "Ver anúncio" });
    expect(link).toHaveAttribute("href", "https://www.facebook.com/123/posts/456/");
    expect(screen.getByRole("link", { name: "Ver anúncio: Vídeo depoimento" })).toHaveAttribute(
      "href",
      "https://www.facebook.com/123/posts/456/",
    );
    expect(screen.getByText("VD")).toBeInTheDocument();
    expect(screen.getAllByText("sem dado").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("—");
  });

  it("segue a predefinição de colunas ao montar a tabela", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        baseResponse(
          [{ ...metrics, name: "Beta", platform: "meta_ads", campaign_status: "PAUSED", adsets: [] }],
          ["impressions", "ctr", "spend"],
        ),
      ),
    );
    render(<TrafficDashboard />);
    const table = (await screen.findByText("Beta")).closest("table") as HTMLTableElement;
    expect(headerNames(table)).toEqual(["Campanha", "Status", "Impressões", "CTR", "Valor gasto"]);
    const row = screen.getByText("Beta").closest("tr") as HTMLTableRowElement;
    expect(row.cells[2]?.textContent).toBe("1.000");
    expect(row.cells[3]?.textContent).toBe("5%");
    expect(row.cells[4]?.textContent).toMatch(/^R\$\s50,00$/);
    expect(screen.getByText("Pausada")).toBeInTheDocument();
  });

  it("arrasta a métrica, persiste por pessoa e organização e volta à ordem padrão", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(baseResponse([
        campaignWithStatus("Campanha reordenável", "ACTIVE", 50),
      ], ["spend", "leads"])),
    );

    const firstMount = render(<TrafficDashboard />);
    const firstTable = (await screen.findByText("Campanha reordenável")).closest("table") as HTMLTableElement;
    const spendHeader = within(firstTable).getByRole("columnheader", { name: /Valor gasto/ });
    const leadsHeader = within(firstTable).getByRole("columnheader", { name: /Leads/ });

    expect(within(firstTable).getByRole("columnheader", { name: /Campanha/ })).not.toHaveAttribute("draggable", "true");
    expect(spendHeader).toHaveAttribute("draggable", "true");
    const drag = dragColumn(leadsHeader, spendHeader);
    expect(spendHeader).toHaveAttribute("data-drop-position", "antes");
    drag.drop();

    expect(headerNames(firstTable)).toEqual(["Campanha", "Status", "Leads", "Valor gasto"]);
    const storageKey = "traffic-report-column-order:org-1:viewer-1:meta_ads";
    expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual([
      "name", "status", "leads", "spend",
    ]);

    firstMount.unmount();
    render(<TrafficDashboard />);
    const restoredTable = (await screen.findByText("Campanha reordenável")).closest("table") as HTMLTableElement;
    await waitFor(() => expect(headerNames(restoredTable)).toEqual([
      "Campanha", "Status", "Leads", "Valor gasto",
    ]));

    await userEvent.setup().click(screen.getByRole("button", { name: "Voltar à ordem padrão" }));
    expect(headerNames(restoredTable)).toEqual(["Campanha", "Status", "Valor gasto", "Leads"]);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("reordena também as colunas de Anúncios Meta sem mover o criativo", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(creativeResponse()));
    render(<TrafficDashboard />);
    const section = (await screen.findByText("Anúncios Meta")).closest("section") as HTMLElement;
    const table = section.querySelector("table") as HTMLTableElement;
    const spendHeader = within(table).getByRole("columnheader", { name: /Investimento/ });
    const impressionsHeader = within(table).getByRole("columnheader", { name: /Impressões/ });

    expect(within(table).getByRole("columnheader", { name: /Criativo/ })).not.toHaveAttribute("draggable", "true");
    const drag = dragColumn(impressionsHeader, spendHeader);
    expect(spendHeader).toHaveAttribute("data-drop-position", "antes");
    drag.drop();

    expect(headerNames(table).slice(0, 4)).toEqual(["Criativo", "Impressões", "Investimento", "Cliques"]);
    expect(JSON.parse(
      localStorage.getItem("traffic-report-column-order:org-1:viewer-1:meta-ads-creatives") ?? "[]",
    ).slice(0, 4)).toEqual(["creative", "impressions", "spend", "clicks"]);
  });

  it("desliga a reordenação de colunas no celular", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(baseResponse([
        campaignWithStatus("Campanha no celular", "ACTIVE", 50),
      ], ["spend", "leads"])),
    );

    render(<TrafficDashboard />);
    const table = (await screen.findByText("Campanha no celular")).closest("table") as HTMLTableElement;
    expect(within(table).getByRole("columnheader", { name: /Valor gasto/ })).not.toHaveAttribute(
      "draggable",
      "true",
    );
  });

  it("redimensiona sem ordenar e restaura a largura persistida pela organização", async () => {
    const campanhas = [
      campaignWithStatus("Maior investimento", "ACTIVE", 80),
      campaignWithStatus("Menor investimento", "ACTIVE", 20),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(baseResponse(campanhas, ["spend", "leads"])),
    );

    const firstMount = render(<TrafficDashboard />);
    const firstTable = (await screen.findByText("Maior investimento")).closest(
      "table",
    ) as HTMLTableElement;
    const spendHeader = within(firstTable).getByRole("columnheader", { name: /Valor gasto/ });
    vi.spyOn(spendHeader, "getBoundingClientRect").mockReturnValue({
      width: 160, height: 40, top: 0, right: 160, bottom: 40,
      left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    const separator = within(spendHeader).getByRole("separator", { name: /Valor gasto/ });

    fireEvent.pointerDown(separator, {
      pointerType: "mouse", button: 0, clientX: 100, pointerId: 7,
    });
    fireEvent.pointerMove(separator, { pointerType: "mouse", clientX: 180, pointerId: 7 });
    fireEvent.pointerUp(separator, { pointerType: "mouse", clientX: 180, pointerId: 7 });

    expect(spendHeader).toHaveStyle({ width: "240px" });
    expect(spendHeader).toHaveAttribute("aria-sort", "descending");
    expect(firstTable.tBodies[0]?.rows[0]).toHaveTextContent("Maior investimento");
    expect(JSON.parse(
      localStorage.getItem("traffic-report-column-widths:org-1:meta_ads") ?? "{}",
    )).toEqual({ spend: 240 });

    firstMount.unmount();
    render(<TrafficDashboard />);
    const secondTable = (await screen.findByText("Maior investimento")).closest(
      "table",
    ) as HTMLTableElement;
    const restoredHeader = within(secondTable).getByRole("columnheader", { name: /Valor gasto/ });
    await waitFor(() => expect(restoredHeader).toHaveStyle({ width: "240px" }));
  });

  it("duplo clique restaura somente a coluna escolhida", async () => {
    localStorage.setItem(
      "traffic-report-column-widths:org-1:meta_ads",
      JSON.stringify({ spend: 260, leads: 180 }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(baseResponse([
        campaignWithStatus("Campanha ajustável", "ACTIVE", 50),
      ], ["spend", "leads"])),
    );

    render(<TrafficDashboard />);
    const table = (await screen.findByText("Campanha ajustável")).closest(
      "table",
    ) as HTMLTableElement;
    const spendHeader = within(table).getByRole("columnheader", { name: /Valor gasto/ });
    await waitFor(() => expect(spendHeader).toHaveStyle({ width: "260px" }));

    fireEvent.doubleClick(within(spendHeader).getByRole("separator", { name: /Valor gasto/ }));

    expect(spendHeader.style.width).toBe("");
    expect(JSON.parse(
      localStorage.getItem("traffic-report-column-widths:org-1:meta_ads") ?? "{}",
    )).toEqual({ leads: 180 });
  });

  it("distingue na tabela a métrica prioritária escolhida", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const response = baseResponse(
        [campaignWithStatus("Campanha em destaque", "ACTIVE", 50)],
        ["spend", "leads"],
      );
      return Response.json({ data: { ...response.data, priority_metrics: ["leads", "spend"] } });
    });

    render(<TrafficDashboard />);
    const table = (await screen.findByText("Campanha em destaque")).closest(
      "table",
    ) as HTMLTableElement;
    const leadHeader = within(table).getByRole("columnheader", { name: /Leads/ });
    const leadColumn = columnIndex(table, "Leads");

    expect(leadHeader).toHaveAttribute("data-priority", "true");
    expect(leadHeader).toHaveClass("bg-primary/[0.10]");
    expect(table.tBodies[0]?.rows[0]?.cells[leadColumn]).toHaveAttribute("data-priority", "true");
    expect(table.tBodies[0]?.rows[0]?.cells[leadColumn]).toHaveClass("text-base", "font-semibold");
    expect(table.tFoot?.rows[0]?.cells[leadColumn]).toHaveAttribute("data-priority", "true");
  });

  it("redimensiona Anúncios Meta sem mudar a ordenação e restaura por organização e tabela", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(creativeResponse()));

    const firstMount = render(<TrafficDashboard />);
    const section = (await screen.findByText("Anúncios Meta")).closest("section") as HTMLElement;
    const table = section.querySelector("table") as HTMLTableElement;
    const spendHeader = within(table).getByRole("columnheader", { name: /Investimento/ });
    vi.spyOn(spendHeader, "getBoundingClientRect").mockReturnValue({
      width: 160, height: 40, top: 0, right: 160, bottom: 40,
      left: 0, x: 0, y: 0, toJSON: () => ({}),
    });
    const separator = within(spendHeader).getByRole("separator", { name: /Investimento/ });

    expect(fireEvent.pointerDown(separator, {
      pointerType: "mouse", button: 0, clientX: 100, pointerId: 11,
    })).toBe(false);
    fireEvent.pointerMove(separator, { pointerType: "mouse", clientX: 180, pointerId: 11 });
    fireEvent.pointerUp(separator, { pointerType: "mouse", clientX: 180, pointerId: 11 });

    expect(spendHeader).toHaveStyle({ width: "240px" });
    expect(within(section).getByRole("combobox")).toHaveValue("conversions");
    expect(table.tBodies[0]?.rows[0]).toHaveTextContent("Criativo campeão");
    expect(JSON.parse(
      localStorage.getItem("traffic-report-column-widths:org-1:meta-ads-creatives") ?? "{}",
    )).toEqual({ spend: 240 });
    expect(localStorage.getItem("traffic-report-column-widths:org-1:meta_ads")).toBeNull();

    firstMount.unmount();
    render(<TrafficDashboard />);
    const restoredSection = (await screen.findByText("Anúncios Meta")).closest("section") as HTMLElement;
    const restoredTable = restoredSection.querySelector("table") as HTMLTableElement;
    const restoredHeader = within(restoredTable).getByRole("columnheader", { name: /Investimento/ });
    await waitFor(() => expect(restoredHeader).toHaveStyle({ width: "240px" }));
  });

  it("ajusta Anúncios Meta pelo teclado e restaura somente a coluna escolhida", async () => {
    localStorage.setItem(
      "traffic-report-column-widths:org-1:meta-ads-creatives",
      JSON.stringify({ spend: 260, impressions: 180 }),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(creativeResponse()));

    render(<TrafficDashboard />);
    const section = (await screen.findByText("Anúncios Meta")).closest("section") as HTMLElement;
    const table = section.querySelector("table") as HTMLTableElement;
    const impressionsHeader = within(table).getByRole("columnheader", { name: /Impressões/ });
    await waitFor(() => expect(impressionsHeader).toHaveStyle({ width: "180px" }));
    const impressionsHandle = within(impressionsHeader).getByRole("separator", { name: /Impressões/ });

    fireEvent.keyDown(impressionsHandle, { key: "ArrowRight" });
    expect(impressionsHeader).toHaveStyle({ width: "188px" });
    fireEvent.keyDown(impressionsHandle, { key: "Home" });
    expect(impressionsHeader.style.width).toBe("");
    expect(JSON.parse(
      localStorage.getItem("traffic-report-column-widths:org-1:meta-ads-creatives") ?? "{}",
    )).toEqual({ spend: 260 });

    const spendHeader = within(table).getByRole("columnheader", { name: /Investimento/ });
    fireEvent.doubleClick(within(spendHeader).getByRole("separator", { name: /Investimento/ }));
    expect(localStorage.getItem("traffic-report-column-widths:org-1:meta-ads-creatives")).toBeNull();
  });

  it("mantém a ênfase da métrica prioritária em Anúncios Meta ao trocar a ordenação", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(creativeResponse()));
    const user = userEvent.setup();

    render(<TrafficDashboard />);
    const section = (await screen.findByText("Anúncios Meta")).closest("section") as HTMLElement;
    const table = section.querySelector("table") as HTMLTableElement;
    const leadsHeader = within(table).getByRole("columnheader", { name: /^Leads/ }) as HTMLTableCellElement;
    const leadsIndex = Array.from(table.tHead?.rows[0]?.cells ?? []).indexOf(leadsHeader);

    expect(leadsHeader).toHaveAttribute("data-priority", "true");
    expect(leadsHeader).toHaveClass("bg-primary/[0.10]");
    expect(table.tBodies[0]?.rows[0]?.cells[leadsIndex]).toHaveAttribute("data-priority", "true");
    await user.selectOptions(within(section).getByRole("combobox"), "spend");
    expect(leadsHeader).toHaveAttribute("data-priority", "true");
    expect(within(table).getByRole("columnheader", { name: /Investimento/ })).not.toHaveAttribute(
      "data-priority",
    );
  });
});
