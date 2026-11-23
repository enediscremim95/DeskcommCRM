import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), resolveActiveOrg: vi.fn(), admin: vi.fn(), integration: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireAuth: mocks.requireAuth, resolveActiveOrg: mocks.resolveActiveOrg }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/integrations/access", () => ({ clientCanViewIntegration: mocks.integration }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/app/app/relatorio/_client", () => ({ RelatorioClient: () => null }));
import RelatorioPage from "@/app/app/relatorio/page";
import { requireHumanKanban } from "@/lib/leads/human-kanban";
import type { HandlerCtx } from "@/lib/api/handlers/types";
const orgs = ["11111111-0000-4000-8000-000000000001", "22222222-0000-4000-8000-000000000002", "33333333-0000-4000-8000-000000000003"];
describe("relatório e Kanban sem exceções por organização", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.requireAuth.mockResolvedValue({ is_platform_admin: false, idioma: "pt-BR" }); mocks.integration.mockResolvedValue(false); });
 it.each(orgs)("configuração nativa de %s não exige permissão externa antiga", async (organizationId) => {
  mocks.resolveActiveOrg.mockResolvedValue({ orgId: organizationId, role: "viewer" });
  const filters: unknown[][] = [];
  mocks.admin.mockReturnValue({ from: (table: string) => {
   const chain = { select: () => chain, eq: (column: string, value: unknown) => { filters.push([table,column,value]); return chain; }, maybeSingle: async () => ({ data: table === "traffic_dashboard_configs" ? { organization_id: organizationId } : { report_url: null }, error: null }) };
   return chain;
  } });
  const page = await RelatorioPage();
  expect(page.props.nativeConfigured).toBe(true);
  expect(filters).toContainEqual(["traffic_dashboard_configs","organization_id",organizationId]);
  expect(filters).toContainEqual(["traffic_dashboard_configs","enabled",true]);
 });
 it.each(orgs)("trava automática e decisão humana valem para %s", (organization_id) => {
  const ctx = { organization_id, requestId:"review", actor:{ type:"ai_agent", id:"agent", role:"admin" } } as HandlerCtx;
  expect(() => requireHumanKanban(ctx)).toThrow();
  expect(() => requireHumanKanban({ ...ctx,actor:{ type:"user",id:"human",role:"agent" } })).not.toThrow();
 });

 it.each(["lib/leads/human-kanban.ts", "app/app/relatorio/page.tsx", "supabase/migrations/20261116150000_0310_kanban_decisao_humana.sql"])(
  "%s não tem exceção por ID de organização",
  (arquivo) => {
   const texto = readFileSync(arquivo, "utf8");
   expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  },
 );
});
