import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BlocoRecolhivel, reportSectionStorageKey } from "./RelatorioRecolhivel";

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
});
