import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Regressões da conferência de 2026-11-16 (todas as orgs):
 *  b) troca recusada para quem TEM acesso;  c) clique no seletor não pegava;
 *  e) org ativa por aba;  a) quadro preso; d) contagens inteiras.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const h = vi.hoisted(() => ({
  header: null as string | null,
  cookie: undefined as string | undefined,
  user: null as unknown,
  setCookie: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (n: string) => (n === "x-org-aba" ? h.header : null) }),
  cookies: async () => ({ get: (n: string) => (n === "active_org" && h.cookie ? { value: h.cookie } : undefined), set: h.setCookie }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/cookie-secure", () => ({ cookieSecure: () => false }));
vi.mock("@/lib/supabase/server", () => ({
  // Qualquer consulta de membership aqui é um defeito: a fonte é loadAuthUser.
  createClient: async () => ({
    from: (tabela: string) => {
      if (tabela === "user_organizations") throw new Error("setActiveOrg não deve consultar user_organizations à parte");
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.is = () => q;
      q.maybeSingle = async () => ({ data: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, error: null });
      return q;
    },
    auth: { getUser: h.auth },
  }),
}));
vi.mock("@/lib/auth/server", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/server")>();
  return { ...real, loadAuthUser: async () => h.user, mfaEmDivida: async () => false };
});

const org = (id: string, accepted_at: string | null = "2026-01-01") => ({
  organization_id: id, organization_name: `Org ${id[0]}`, role: "admin", interface_settings: {}, locale: null, accepted_at,
});

beforeEach(() => {
  h.header = null; h.cookie = undefined; h.setCookie.mockReset();
  h.user = { id: "u1", organizations: [org(A), org(B), org(C, null)], support: null, idioma: "pt-BR" };
});

describe("b) setActiveOrg aceita quem tem acesso (o que a RLS e o layout aceitam)", () => {
  it("vínculo sem accepted_at (dono entregue) e qualquer status de org: troca", async () => {
    const { setActiveOrg } = await import("@/app/actions/shell/setActiveOrg");
    const r = await setActiveOrg(C);
    expect(r.ok).toBe(true);
    expect(h.setCookie).toHaveBeenCalledWith("active_org", C, expect.anything());
  });
  it("org de que NÃO é membro continua recusada", async () => {
    const { setActiveOrg } = await import("@/app/actions/shell/setActiveOrg");
    const r = await setActiveOrg("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(h.setCookie).not.toHaveBeenCalled();
  });
});

describe("e) a org ativa é por aba, e o servidor valida o acesso", () => {
  it("header da aba vence o cookie compartilhado", async () => {
    const { resolveActiveOrg } = await import("@/lib/auth/server");
    h.cookie = B; h.header = A;
    expect((await resolveActiveOrg(h.user as never))?.orgId).toBe(A);
  });
  it("header de org que não é do usuário é ignorado (cai no cookie)", async () => {
    const { resolveActiveOrg } = await import("@/lib/auth/server");
    h.cookie = B; h.header = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    expect((await resolveActiveOrg(h.user as never))?.orgId).toBe(B);
  });
  it("header lixo é ignorado; sem header usa o cookie", async () => {
    const { resolveActiveOrg } = await import("@/lib/auth/server");
    h.cookie = B; h.header = "'; drop table";
    expect((await resolveActiveOrg(h.user as never))?.orgId).toBe(B);
    h.header = null;
    expect((await resolveActiveOrg(h.user as never))?.orgId).toBe(B);
  });
  it("fetch da aba anexa x-org-aba só para a mesma origem", async () => {
    const { instalarFetchComOrgDaAba, gravarOrgDaAba, HEADER_ORG_DA_ABA } = await import("@/lib/auth/org-da-aba");
    const chamadas: Array<[unknown, RequestInit | undefined]> = [];
    const original = window.fetch;
    window.fetch = (async (i: unknown, init?: RequestInit) => { chamadas.push([i, init]); return new Response("{}"); }) as typeof fetch;
    const desfaz = instalarFetchComOrgDaAba(window);
    try {
      window.sessionStorage.clear();
      await fetch("/api/v1/x");
      expect(new Headers(chamadas[0]![1]?.headers).has(HEADER_ORG_DA_ABA)).toBe(false); // aba sem escolha
      gravarOrgDaAba(A);
      await fetch("/api/v1/x", { headers: { accept: "json" } });
      expect(new Headers(chamadas[1]![1]?.headers).get(HEADER_ORG_DA_ABA)).toBe(A);
      await fetch("https://outro.exemplo/x");
      expect(new Headers(chamadas[2]![1]?.headers).has(HEADER_ORG_DA_ABA)).toBe(false);
    } finally { desfaz(); window.fetch = original; window.sessionStorage.clear(); }
  });
});

describe("c) clique no item do seletor pega na primeira e só troca uma vez", () => {
  it("um clique → setActiveOrg uma vez", async () => {
    vi.resetModules();
    const setActiveOrg = vi.fn(async () => ({ ok: false, error: "x" }));
    vi.doMock("@/app/actions/shell/setActiveOrg", () => ({ setActiveOrg }));
    vi.doMock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
    vi.doMock("sonner", () => ({ toast: { error: vi.fn() } }));
    vi.doMock("@/components/shell/OrganizationTransitionProvider", () => ({ useOrganizationTransition: () => ({ begin: vi.fn(), cancel: vi.fn() }) }));
    vi.doMock("@/hooks/auth/AuthProvider", () => ({
      useUser: () => ({ organizations: [org(A), org(B)], is_platform_admin: false, support: null }),
      useActiveOrg: () => ({ orgId: A, name: "Org a" }),
    }));
    const { TenantSwitcher } = await import("@/components/shell/TenantSwitcher");
    const u = userEvent.setup();
    render(<TenantSwitcher />);
    await u.click(screen.getByTestId("tenant-switcher"));
    await u.click(await screen.findByTestId(`tenant-switcher-item-${B}`));
    expect(setActiveOrg).toHaveBeenCalledTimes(1);
    expect(setActiveOrg).toHaveBeenCalledWith(B);
  });
});

describe("a) quadro não fica preso", () => {
  it("rota do board: GoTrue indisponível → 503 (sem getUser cru e sem 500)", async () => {
    vi.resetModules();
    h.auth.mockReset();
    const { AuthIndisponivelError } = await import("@/lib/auth/auth-indisponivel");
    vi.doMock("@/lib/auth/server", () => ({ loadAuthUser: async () => { throw new AuthIndisponivelError(); } }));
    const { GET } = await import("@/app/api/v1/pipelines/[id]/board/route");
    const res = await GET(new Request("http://x/api/v1/pipelines/p/board") as never, { params: Promise.resolve({ id: "p" }) });
    expect(res.status).toBe(503);
    expect(h.auth, "a rota não pode fazer um getUser sem prazo à parte").not.toHaveBeenCalled();
  });
  it("queryInBatches dispara os lotes em paralelo e mantém a ordem", async () => {
    const { queryInBatches } = await import("@/lib/supabase/query-in-batches");
    let emVoo = 0, pico = 0;
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
    const r = await queryInBatches<string>(ids, async (lote) => {
      emVoo++; pico = Math.max(pico, emVoo);
      await new Promise((ok) => setTimeout(ok, 5));
      emVoo--;
      return { data: lote, error: null };
    });
    expect(pico).toBe(3);
    expect(r.data).toEqual(ids);
  });
  it("comPrazoOuPadrao: lento ou falho cai no padrão sem segurar a tela", async () => {
    const { comPrazoOuPadrao } = await import("@/lib/async/com-prazo");
    expect(await comPrazoOuPadrao(new Promise(() => {}), 10, "padrao")).toBe("padrao");
    expect(await comPrazoOuPadrao(Promise.reject(new Error("x")), 1000, "padrao")).toBe("padrao");
    expect(await comPrazoOuPadrao(Promise.resolve("ok"), 1000, "padrao")).toBe("ok");
  });
});

describe("d) toda contagem do relatório sai inteira, em qualquer org/modelo", () => {
  it.each(["leads", "messages", "ecommerce"] as const)("modelo %s", async (model) => {
    const { buildTrafficReport } = await import("@/lib/windsor/report");
    const f = (d: string) => ({
      account_id: "meta", platform: "meta_ads" as const, occurred_on: d, campaign_id: "c", campaign_name: "C",
      adset_id: "s", adset_name: "S", ad_id: "a", ad_name: "A", impressions: 1000.4, reach: 800.3, clicks: 50.5,
      link_clicks: 40.6, spend: 100, conversions: { actions_lead: 70.52 }, revenue: 10, video_views: 3.3,
      video_p25: 2.2, video_p50: 1.5, video_p75: 1.4, video_p95: 0.6, thumbnail_url: null, story_id: null, destination_urls: [],
    });
    const [g] = buildTrafficReport({
      model, conversionFields: ["actions_lead"],
      accounts: [{ account_id: "meta", account_name: "M", platform: "meta_ads", currency: "BRL" }],
      facts: [f("2026-09-17"), f("2026-09-18")],
    } as never);
    const campos = ["leads", "conversions", "impressions", "clicks", "link_clicks", "landing_page_views", "add_to_cart",
      "initiate_checkout", "purchases", "messaging_conversations", "video_views", "video_p25", "video_p50", "video_p75", "video_p95"];
    const c = g!.campaigns[0]!;
    for (const nivel of [g!.summary, g!.platforms[0]!, c, c.adsets[0]!, c.adsets[0]!.ads[0]!] as unknown as Array<Record<string, number>>) {
      for (const campo of campos) expect(Number.isInteger(nivel[campo]), `${model}.${campo}=${nivel[campo]}`).toBe(true);
    }
    expect(g!.summary.leads).toBe(141); // 70,52 × 2 = 141,04
  });
});
