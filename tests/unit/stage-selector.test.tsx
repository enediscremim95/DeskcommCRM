import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StageSelector } from "@/components/leads/StageSelector";
import type { Stage } from "@/lib/kanban/types";

const stages: Stage[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    pipeline_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Primeiro contato com o cliente",
    slug: "primeiro-contato",
    position: 1000,
    color: null,
    is_won: false,
    is_lost: false,
    is_archived: false,
    expected_duration_hours: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    pipeline_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Proposta comercial apresentada",
    slug: "proposta",
    position: 2000,
    color: null,
    is_won: false,
    is_lost: false,
    is_archived: false,
    expected_duration_hours: null,
  },
];
const firstStage = stages[0]!;
const secondStage = stages[1]!;

describe("seletor de etapa da ficha", () => {
  it("mostra nomes inteiros no desktop e move com um clique", () => {
    const onSelect = vi.fn();
    render(
      <StageSelector
        stages={stages}
        stageId={firstStage.id}
        canEdit
        onSelect={onSelect}
      />,
    );

    const desktop = screen.getByRole("list", { name: "Etapas do funil" });
    const target = within(desktop).getByRole("button", {
      name: "Proposta comercial apresentada",
    });
    expect(target).toHaveClass("whitespace-normal");
    expect(target).not.toHaveClass("truncate");
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith(secondStage);
  });

  it("abre a lista móvel, usa alvo de 44px e fecha após escolher", () => {
    const onSelect = vi.fn();
    render(
      <StageSelector
        stages={stages}
        stageId={firstStage.id}
        canEdit
        onSelect={onSelect}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Etapa: Primeiro contato com o cliente",
    });
    expect(trigger).toHaveClass("min-h-11");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const target = within(dialog).getByRole("button", {
      name: "Proposta comercial apresentada",
    });
    expect(target).toHaveClass("min-h-11");
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith(secondStage);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("viewer vê a etapa, mas não recebe controle de movimento", () => {
    const onSelect = vi.fn();
    render(
      <StageSelector
        stages={stages}
        stageId={firstStage.id}
        canEdit={false}
        onSelect={onSelect}
      />,
    );

    const desktop = screen.getByRole("list", { name: "Etapas do funil" });
    expect(within(desktop).getAllByRole("button")).toEqual(
      expect.arrayContaining([expect.objectContaining({ disabled: true })]),
    );
    expect(screen.queryByRole("button", { name: /Etapa:/ })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
