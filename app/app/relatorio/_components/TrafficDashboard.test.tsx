import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TrafficDashboard } from "./TrafficDashboard";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt" }));
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
  budget: 100, budget_type: "daily", spend: 50, conversions: 5, leads: 5,
  landing_page_views: 20, cost_per_landing_page_view: 2.5,
  add_to_cart: 4, cost_per_add_to_cart: 12.5,
  initiate_checkout: 3, cost_per_initiate_checkout: 16.67,
  purchases: 2, cost_per_purchase: 25,
  messaging_conversations: 0, cost_per_messaging_conversation: null,
  revenue: 200, impressions: 1000, reach: null, clicks: 60, link_clicks: 50,
  cost_per_conversion: 10, cost_per_lead: 10, cpm: 50, ctr: 5, cpc: 1,
  conversion_rate: 10, roas: 4, average_order_value: 100,
  video_views: 0, video_p25: 0, video_p50: 0, video_p75: 0, video_p95: 0,
} as const;

describe("colunas da tabela de campanhas", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("isola a preferência no navegador e permite ao admin salvar o padrão", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ data: { columns: ["spend", "impressions", "leads"] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {
        model: "leads", organization_key: "org-1", viewer_key: "user-1",
        default_columns: ["spend", "leads"],
        can_manage_defaults: true,
        sync: { status: "ready", last_succeeded_at: "2026-09-18T20:00:00Z", error: null },
        currencies: [{
          currency: "BRL", summary: metrics, daily: [],
          platforms: [{ ...metrics, platform: "meta_ads" }],
          campaigns: [{ ...metrics, name: "Campanha A", platform: "meta_ads", adsets: [] }],
        }],
      } }), { status: 200 });
    });

    const user = userEvent.setup();
    render(<TrafficDashboard />);
    expect(await screen.findByText("Campanha A")).toBeInTheDocument();

    await user.click(screen.getByText("Colunas (2)"));
    await user.click(screen.getByRole("checkbox", { name: "Impressões" }));
    expect(JSON.parse(localStorage.getItem("traffic-campaign-columns:org-1:user-1:leads") ?? "[]"))
      .toEqual(["spend", "impressions", "leads"]);

    await user.click(screen.getByRole("button", { name: "Salvar como padrão da organização" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === "PATCH")).toBe(true));
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(patchCall?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ columns: ["spend", "impressions", "leads"] }),
    });
  });
});
