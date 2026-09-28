import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@hello-pangea/dnd", () => ({
  Droppable: ({
    children,
  }: {
    children: (provided: unknown, snapshot: unknown) => React.ReactNode;
  }) =>
    children(
      { innerRef: vi.fn(), droppableProps: {}, placeholder: null },
      { isDraggingOver: false },
    ),
}));
vi.mock("@/components/kanban/KanbanCard", () => ({
  KanbanCard: ({ lead }: { lead: Lead }) => <div>{lead.title}</div>,
}));

import { StageColumn } from "@/components/kanban/StageColumn";

class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];
  constructor(private readonly callback: IntersectionObserverCallback) {}
  disconnect() {}
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve() {}
}

const stage = { id: "stage-1", name: "Entrada", color: null } as Stage;
const loadedLead = {
  id: "lead-1",
  title: "Negócio carregado",
  stage_id: stage.id,
  position_in_stage: 1_000,
  value_cents: 50_000,
} as Lead;

describe("coluna paginada do quadro", () => {
  it("mostra o total real e pede a próxima página ao chegar ao fim", async () => {
    vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
    const loadMore = vi.fn();

    render(
      <StageColumn
        stage={stage}
        leads={[loadedLead]}
        total={1_631}
        hasMore
        onLoadMore={loadMore}
        pipelineId="pipeline-1"
      />,
    );

    expect(screen.getByText(/1631 leads/)).toBeInTheDocument();
    expect(screen.queryByText(/^1 lead$/)).not.toBeInTheDocument();
    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));

    vi.unstubAllGlobals();
  });
});
