import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BlocoRecolhivel,
  ControleEdicaoRelatorio,
  ControleTodasAsSecoes,
  ProvedorModoApresentacao,
  ProvedorRelatorioRecolhivel,
  reportSectionStorageKey,
} from "./RelatorioRecolhivel";

function Example() {
  return (
    <BlocoRecolhivel
      organizationKey="org-1"
      viewerKey="user-1"
      sectionKey="meta"
      idioma="pt-BR"
      label="Meta Ads"
      header={<span>Meta Ads</span>}
    >
      <p>Conteúdo Meta</p>
    </BlocoRecolhivel>
  );
}

describe("bloco recolhível do relatório", () => {
  const storageKey = reportSectionStorageKey({
    organizationKey: "org-1",
    viewerKey: "user-1",
    sectionKey: "meta",
  });

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("abre por padrão, recolhe pelo teclado e persiste por usuário", async () => {
    const user = userEvent.setup();
    const first = render(<Example />);
    const trigger = screen.getByRole("button", { name: "Recolher Meta Ads" });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Conteúdo Meta").parentElement).toHaveAttribute("hidden");
    expect(localStorage.getItem(storageKey)).toBe("closed");

    first.unmount();
    render(<Example />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Expandir Meta Ads" })).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );

    const restored = screen.getByRole("button", { name: "Expandir Meta Ads" });
    restored.focus();
    await user.keyboard(" ");
    expect(restored).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("continua funcionando quando o navegador bloqueia a persistência", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    render(<Example />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Recolher Meta Ads" }));

    expect(screen.getByRole("button", { name: "Expandir Meta Ads" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("recolhe e expande todos os blocos, persistindo cada seção para a mesma pessoa", async () => {
    const user = userEvent.setup();
    render(
      <ProvedorRelatorioRecolhivel>
        <ControleTodasAsSecoes recolherLabel="Recolher tudo" expandirLabel="Expandir tudo" />
        <BlocoRecolhivel
          organizationKey="org-1"
          viewerKey="user-1"
          sectionKey="meta"
          idioma="pt-BR"
          label="Meta Ads"
          header={<span>Meta Ads</span>}
        >
          Meta
        </BlocoRecolhivel>
        <BlocoRecolhivel
          organizationKey="org-1"
          viewerKey="user-1"
          sectionKey="google"
          idioma="pt-BR"
          label="Google Ads"
          header={<span>Google Ads</span>}
        >
          Google
        </BlocoRecolhivel>
      </ProvedorRelatorioRecolhivel>,
    );

    await user.click(await screen.findByRole("button", { name: "Recolher tudo" }));
    expect(screen.getByRole("button", { name: "Expandir Meta Ads" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Expandir Google Ads" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      localStorage.getItem(
        reportSectionStorageKey({
          organizationKey: "org-1",
          viewerKey: "user-1",
          sectionKey: "meta",
        }),
      ),
    ).toBe("closed");

    await user.click(screen.getByRole("button", { name: "Expandir tudo" }));
    expect(screen.getByRole("button", { name: "Recolher Meta Ads" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(localStorage.length).toBe(0);
  });

  it("remove controles de edição da árvore durante a apresentação", () => {
    const { rerender } = render(
      <ProvedorModoApresentacao ativo>
        <ControleEdicaoRelatorio>
          <button type="button">Editar</button>
        </ControleEdicaoRelatorio>
        <p>Conteúdo</p>
      </ProvedorModoApresentacao>,
    );
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByText("Conteúdo")).toBeInTheDocument();

    rerender(
      <ProvedorModoApresentacao ativo={false}>
        <ControleEdicaoRelatorio>
          <button type="button">Editar</button>
        </ControleEdicaoRelatorio>
        <p>Conteúdo</p>
      </ProvedorModoApresentacao>,
    );
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });
});
