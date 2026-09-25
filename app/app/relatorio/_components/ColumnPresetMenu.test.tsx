import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ColumnPresetMenu, columnPresetStorageKeys, reorderColumns } from "./ColumnPresetMenu";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt-BR" }));

const baseProps = {
  organizationKey: "org-1",
  viewerKey: "user-1",
  model: "leads" as const,
  platform: "meta_ads" as const,
  initialPresets: [],
  defaultPresetId: null,
  defaultColumns: ["spend"] as const,
  availableColumns: ["spend", "leads", "cpm"] as const,
  canManage: false,
  columnLabel: (column: string) =>
    ({ spend: "Investimento", leads: "Leads", cpm: "CPM" })[column] ?? column,
};

describe("ordem e escolha pessoal das colunas", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("move a coluna sem reordenar as demais", () => {
    expect(reorderColumns(["spend", "leads", "cpm", "ctr"], 3, 1)).toEqual([
      "spend",
      "ctr",
      "leads",
      "cpm",
    ]);
  });

  it("ignora um destino fora da lista", () => {
    const columns = ["spend", "leads"] as const;
    expect(reorderColumns([...columns], 0, 8)).toEqual(columns);
  });

  it("isola a escolha local por pessoa e plataforma", () => {
    const meta = columnPresetStorageKeys("org", "user", "leads", "meta_ads");
    const google = columnPresetStorageKeys("org", "user", "leads", "google_ads");

    expect(meta.columnsStorageKey).toBe("traffic-campaign-columns:org:user:leads:meta_ads");
    expect(google.columnsStorageKey).toBe("traffic-campaign-columns:org:user:leads:google_ads");
    expect(meta.presetStorageKey).not.toBe(google.presetStorageKey);
  });

  it("permite ao cliente escolher e reencontrar colunas mesmo sem predefinições", async () => {
    const onColumnsChange = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    const { unmount } = render(
      <ColumnPresetMenu
        {...baseProps}
        defaultColumns={[...baseProps.defaultColumns]}
        availableColumns={[...baseProps.availableColumns]}
        columnLabel={baseProps.columnLabel as never}
        onColumnsChange={onColumnsChange}
      />,
    );

    await user.click(screen.getByText("Colunas (1)"));
    expect(
      screen.getByText("Nenhuma predefinição foi liberada. Escolha as colunas abaixo."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar como nova" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como padrão" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Leads" }));

    const { columnsStorageKey } = columnPresetStorageKeys("org-1", "user-1", "leads", "meta_ads");
    expect(localStorage.getItem(columnsStorageKey)).toBe(JSON.stringify(["spend", "leads"]));
    expect(onColumnsChange).toHaveBeenLastCalledWith(["spend", "leads"]);
    expect(fetchMock).not.toHaveBeenCalled();

    unmount();
    const restored = vi.fn();
    render(
      <ColumnPresetMenu
        {...baseProps}
        defaultColumns={[...baseProps.defaultColumns]}
        availableColumns={[...baseProps.availableColumns]}
        columnLabel={baseProps.columnLabel as never}
        onColumnsChange={restored}
      />,
    );
    expect(screen.getByText("Colunas (2)")).toBeInTheDocument();
    expect(restored).toHaveBeenLastCalledWith(["spend", "leads"]);
  });

  it("volta ao padrão da organização e apaga a escolha pessoal", async () => {
    const { columnsStorageKey } = columnPresetStorageKeys("org-1", "user-1", "leads", "meta_ads");
    localStorage.setItem(columnsStorageKey, JSON.stringify(["spend", "leads"]));
    const onColumnsChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ColumnPresetMenu
        {...baseProps}
        defaultColumns={[...baseProps.defaultColumns]}
        availableColumns={[...baseProps.availableColumns]}
        columnLabel={baseProps.columnLabel as never}
        onColumnsChange={onColumnsChange}
      />,
    );

    await user.click(screen.getByText("Colunas (2)"));
    expect(screen.getByText("Esta é a sua visualização pessoal.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar ao padrão" }));

    expect(localStorage.getItem(columnsStorageKey)).toBeNull();
    expect(screen.getByText("Colunas (1)")).toBeInTheDocument();
    expect(onColumnsChange).toHaveBeenLastCalledWith(["spend"]);
  });
});
