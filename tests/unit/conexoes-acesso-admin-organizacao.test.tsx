import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin",
  isPlatformAdmin: false,
  canView: true,
}));

const redirect = vi.hoisted(() => vi.fn((path: string): never => {
  throw new Error(`redirect:${path}`);
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(async () => ({
    id: "user-1",
    idioma: "pt-BR",
    is_platform_admin: state.isPlatformAdmin,
    support: false,
  })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: "org-1", role: state.role })),
}));
vi.mock("@/lib/integrations/access", () => ({
  clientCanViewIntegration: vi.fn(async () => state.canView),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ source: "admin-client" })),
}));
vi.mock("@/lib/i18n/dicionario", () => ({ traduzir: (texto: string) => texto }));
vi.mock("@/components/connections/ConexoesShell", () => ({
  ConexoesShell: () => <div>Ações da conexão</div>,
}));

import ConnectionsPage from "@/app/app/connections/page";

describe("acesso à tela de Conexões", () => {
  beforeEach(() => {
    state.role = "admin";
    state.isPlatformAdmin = false;
    state.canView = true;
    redirect.mockClear();
  });

  it("mostra as ações ao admin da organização", async () => {
    const html = renderToStaticMarkup(await ConnectionsPage());

    expect(html).toContain("Ações da conexão");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("não usa o papel de plataforma para liberar quem não administra a organização", async () => {
    state.role = "manager";
    state.isPlatformAdmin = true;

    await expect(ConnectionsPage()).rejects.toThrow("redirect:/403");
  });

  it("preserva o fechamento explícito da integração", async () => {
    state.canView = false;

    await expect(ConnectionsPage()).rejects.toThrow("redirect:/403");
  });
});
