import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrafficDashboard } from "./TrafficDashboard";

const { translate } = vi.hoisted(() => ({ translate: (value: string) => value }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => translate }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt" }));
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

  it("isola a preferência no navegador e permite ao admin salvar o padrão", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ data: { columns: ["spend", "impressions", "leads"] } }),
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
    await user.click(screen.getByRole("checkbox", { name: "Impressões" }));
    expect(
      JSON.parse(localStorage.getItem("traffic-campaign-columns:org-1:user-1:leads") ?? "[]"),
    ).toEqual(["spend", "impressions", "leads"]);

    await user.click(screen.getByRole("button", { name: "Salvar como padrão da organização" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[1]?.method === "PATCH")).toBe(true),
    );
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(patchCall?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ columns: ["spend", "impressions", "leads"] }),
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
    expect(await screen.findByText("Do alcance à venda fechada")).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Do alcance à venda fechada" })).toHaveLength(1);
    await user.selectOptions(screen.getByRole("combobox", { name: "Período" }), "7");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondUrl).toContain("/api/v1/reports/traffic?from=");
    expect(secondUrl).toContain("&to=");
  });
});
