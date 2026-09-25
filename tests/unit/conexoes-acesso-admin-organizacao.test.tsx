import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin",
  isPlatformAdmin: false,
  canView: true,
  partnerSession: null as { archivedAt: string | null } | null,
  voiceChoice: null as boolean | null,
  shellProps: null as Record<string, unknown> | null,
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
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ source: "session-client" })),
}));
vi.mock("@/lib/channels/connect", () => ({
  partnerSessionInUse: vi.fn(async () => Boolean(state.partnerSession?.archivedAt === null)),
}));
vi.mock("@/lib/voice/guarda", () => ({
  lerEscolhaDaOrg: vi.fn(async () => ({ escolha: state.voiceChoice, riscoAceitoEm: null })),
}));
vi.mock("@/lib/voice/opt-in", () => ({
  chamadaDeVozLigada: (escolha: boolean | null) => escolha === true,
}));
vi.mock("@/lib/i18n/dicionario", () => ({ traduzir: (texto: string) => texto }));
vi.mock("@/components/connections/ConexoesShell", () => ({
  ConexoesShell: (props: Record<string, unknown>) => {
    state.shellProps = props;
    return <div>Ações da conexão</div>;
  },
}));

import ConnectionsPage from "@/app/app/connections/page";

describe("acesso à tela de Conexões", () => {
  beforeEach(() => {
    state.role = "admin";
    state.isPlatformAdmin = false;
    state.canView = true;
    state.partnerSession = null;
    state.voiceChoice = null;
    state.shellProps = null;
    redirect.mockClear();
  });

  it("mostra as ações ao admin da organização", async () => {
    const html = renderToStaticMarkup(await ConnectionsPage());

    expect(html).toContain("Ações da conexão");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("mostra as ações ao admin da plataforma sem suporte mesmo sem papel admin na organização", async () => {
    state.role = "viewer";
    state.isPlatformAdmin = true;
    state.canView = false;

    const html = renderToStaticMarkup(await ConnectionsPage());

    expect(html).toContain("Ações da conexão");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("preserva o fechamento explícito da integração", async () => {
    state.canView = false;

    await expect(ConnectionsPage()).rejects.toThrow("redirect:/403");
  });

  it("esconde as abas opcionais quando a organização não usa os recursos", async () => {
    renderToStaticMarkup(await ConnectionsPage());
    expect(state.shellProps).toMatchObject({ parceiroEmUso: false, vozEmUso: false });
  });

  it("mantém visível cada aba cujo recurso já está em uso", async () => {
    state.partnerSession = { archivedAt: null };
    state.voiceChoice = true;
    renderToStaticMarkup(await ConnectionsPage());
    expect(state.shellProps).toMatchObject({ parceiroEmUso: true, vozEmUso: true });
  });
});
