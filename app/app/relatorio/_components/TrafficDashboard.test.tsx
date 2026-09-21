import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrafficDashboard } from "./TrafficDashboard";

const { translate } = vi.hoisted(() => ({ translate: (value: string) => value }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => translate }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt-BR" }));
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
});
