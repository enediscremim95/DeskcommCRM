import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ aba: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.aba ? `aba=${nav.aba}` : ""),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/components/connections/ManagedQrConnector", () => ({
  ManagedQrConnector: () => <div>Conteúdo QR</div>,
}));
vi.mock("@/components/connections/ConnectionsClient", () => ({
  ConnectionsClient: () => <div>Fallback QR</div>,
}));
vi.mock("@/components/connections/CanalOficialClient", () => ({
  CanalOficialClient: () => <div>Conteúdo oficial</div>,
}));
vi.mock("@/components/connections/TemplatesClient", () => ({
  TemplatesClient: () => <div>Templates oficiais</div>,
}));
vi.mock("@/components/connections/CanalParceiroClient", () => ({
  CanalParceiroClient: () => <div>Conteúdo parceiro</div>,
}));
vi.mock("@/components/connections/TemplatesParceiroClient", () => ({
  TemplatesParceiroClient: () => <div>Templates parceiro</div>,
}));
vi.mock("@/components/connections/CanalVozClient", () => ({
  CanalVozClient: () => <div>Conteúdo voz</div>,
}));

import { ConexoesShell } from "@/components/connections/ConexoesShell";

function renderShell(parceiroEmUso = false, vozEmUso = false) {
  return render(
    <ConexoesShell
      wahaConfigured
      wacallsConfigured
      parceiroEmUso={parceiroEmUso}
      vozEmUso={vozEmUso}
    />,
  );
}

afterEach(() => {
  cleanup();
  nav.aba = null;
});

describe("abas condicionais de Conexões", () => {
  it("esconde parceiro e voz quando a organização não usa nenhum deles", () => {
    renderShell();
    expect(screen.queryByRole("tab", { name: "Provedor parceiro" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Chamada de voz" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Números por QR" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("mostra somente a aba do recurso que já está em uso", () => {
    const { rerender } = renderShell(true, false);
    expect(screen.getByRole("tab", { name: "Provedor parceiro" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Chamada de voz" })).toBeNull();

    rerender(
      <ConexoesShell
        wahaConfigured
        wacallsConfigured
        parceiroEmUso={false}
        vozEmUso
      />,
    );
    expect(screen.queryByRole("tab", { name: "Provedor parceiro" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Chamada de voz" })).toBeVisible();
  });

  it("mantém a URL direta do parceiro mesmo com o gatilho oculto", () => {
    nav.aba = "parceiro";
    renderShell();
    expect(screen.queryByRole("tab", { name: "Provedor parceiro" })).toBeNull();
    expect(screen.getByText("Conteúdo parceiro")).toBeVisible();
  });

  it("mantém a URL direta da voz mesmo com o gatilho oculto", () => {
    nav.aba = "voz";
    renderShell();
    expect(screen.queryByRole("tab", { name: "Chamada de voz" })).toBeNull();
    expect(screen.getByText("Conteúdo voz")).toBeVisible();
  });
});
