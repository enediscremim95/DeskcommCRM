import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useBulkAction } from "@/hooks/kanban/useBulkAction";
import type { BoardData } from "@/lib/kanban/types";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

describe("exclusão em lote atualiza o quadro", () => {
  it("remove os ids excluídos do cache depois do sucesso", async () => {
    post.mockResolvedValueOnce({ data: { updated_count: 2 } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<BoardData>(["board", "pipeline-1"], {
      pipeline: { id: "pipeline-1" },
      stages: [],
      leads: [{ id: "lead-1" }, { id: "lead-2" }, { id: "lead-3" }],
    } as unknown as BoardData);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBulkAction("pipeline-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        action: "delete",
        lead_ids: ["lead-1", "lead-3"],
        params: {},
      });
    });

    expect(post).toHaveBeenCalledWith("/api/v1/leads/bulk", {
      action: "delete",
      lead_ids: ["lead-1", "lead-3"],
      params: {},
    });
    expect(
      queryClient.getQueryData<BoardData>(["board", "pipeline-1"])?.leads.map((lead) => lead.id),
    ).toEqual(["lead-2"]);
  });
});
