import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted((): {
  nativeEnabled: boolean;
  reportUrl: string | null;
  canViewWindsor: boolean;
} => ({
  nativeEnabled: true,
  reportUrl: "https://relatorio.exemplo/inexistente",
  canViewWindsor: false,
}));

const redirect = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(async () => ({ is_platform_admin: false, support: false })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: "org-1", role: "admin" })),
}));
vi.mock("@/lib/integrations/access", () => ({
  clientCanViewIntegration: vi.fn(async () => state.canViewWindsor),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: table === "organizations"
            ? { report_url: state.reportUrl }
            : state.nativeEnabled ? { organization_id: "org-1" } : null,
          error: null,
        })),
      };
      return query;
    }),
  })),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/app/app/relatorio/_components/TrafficDashboard", () => ({
  TrafficDashboard: () => <div>dashboard nativo</div>,
}));

import RelatorioPage from "@/app/app/relatorio/page";
import { RelatorioClient } from "@/app/app/relatorio/_client";

describe("acesso ao Relatório", () => {
  beforeEach(() => {
    state.nativeEnabled = true;
    state.reportUrl = "https://relatorio.exemplo/inexistente";
    state.canViewWindsor = false;
    redirect.mockClear();
  });

  it("não redireciona para 403 quando o relatório nativo está habilitado", async () => {
    const result = await RelatorioPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(result.props.nativeConfigured).toBe(true);
  });

  it("mantém o fechamento explícito quando não existe relatório nativo", async () => {
    state.nativeEnabled = false;

    await expect(RelatorioPage()).rejects.toThrow("redirect:/403");
  });

  it("mostra a tela explicativa quando falta configuração e o acesso está visível", async () => {
    state.nativeEnabled = false;
    state.reportUrl = null;
    state.canViewWindsor = true;

    const result = await RelatorioPage();
    const html = renderToStaticMarkup(result);

    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain("Seu relatório ainda não foi configurado.");
  });

  it("não exibe report_url externo quando o relatório nativo está ligado", () => {
    const html = renderToStaticMarkup(
      <RelatorioClient
        reportUrl="https://relatorio.exemplo/inexistente"
        nativeConfigured
      />,
    );

    expect(html).toContain("dashboard nativo");
    expect(html).not.toContain("relatorio.exemplo");
    expect(html).not.toContain("Abrir em nova aba");
  });
});
