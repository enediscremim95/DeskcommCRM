import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    await user.click(screen.getByRole("button", { name: "+ Impressões" }));
    expect(
      JSON.parse(localStorage.getItem("traffic-campaign-columns:org-1:user-1:leads") ?? "[]"),
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
      body: JSON.stringify({ columns: ["spend", "leads", "impressions"] }),
    });
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
                platforms: [],
                campaigns: [],
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
    expect(localStorage.getItem("traffic-campaign-preset:org-1:user-1:leads")).toBe(
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
    const metaTable = metaGroup.parentElement!.querySelector("table")!;
    const googleTable = googleGroup.parentElement!.querySelector("table")!;

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
  const headerNames = (table: HTMLTableElement) =>
    Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) =>
      (cell.textContent ?? "").replace(/[▼▲]/g, "").trim(),
    );
  const columnIndex = (table: HTMLTableElement, header: string) =>
    headerNames(table).findIndex((name) => name.includes(header));

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
    expect(totalRow.cells[spendColumn]?.textContent).toMatch(/^R\$\s50,00$/);

    // Sem status conhecido a campanha só aparece em "Todas".
    await user.click(screen.getByRole("button", { name: "Ativas" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pausadas" }));
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Todas" }));

    // Abrir os conjuntos não desalinha: a linha extra ocupa todas as colunas.
    await user.click(screen.getByRole("button", { name: "Beta", expanded: false }));
    const adsetRow = screen.getByText("Conjunto Beta").closest("tr") as HTMLTableRowElement;
    expect(adsetRow.cells).toHaveLength(1);
    expect(adsetRow.cells[0]?.colSpan).toBe(headerNames(table).length);
    expect(screen.getByRole("button", { name: "Beta", expanded: true })).toBeInTheDocument();
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
    const cpl = screen.getByText("Custo por lead").closest("button") as HTMLButtonElement;
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
});
