import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { BoardData } from "@/lib/kanban/types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  onChange: null as ((payload: unknown) => void) | null,
}));

vi.mock("@/lib/api/client", () => ({ apiClient: { get: mocks.get } }));
vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { onChange: (payload: unknown) => void }) => {
    mocks.onChange = opts.onChange;
    return { status: "subscribed", ultimaEntrega: { current: null } };
  },
}));
vi.mock("@/hooks/realtime/useRefetchDeSeguranca", () => ({
  useRefetchDeSeguranca: () => ({
    divergencias: 0,
    ultimaDivergencia: null,
    ultimaVerificacao: null,
  }),
}));

import { useBoard } from "./useBoard";

const PIPELINE_ID = "22222222-2222-4222-8222-222222222222";
const STAGE_ID = "33333333-3333-4333-8333-333333333333";

const board = {
  pipeline: { id: PIPELINE_ID },
  stages: [{ id: STAGE_ID }],
  leads: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      pipeline_id: PIPELINE_ID,
      stage_id: STAGE_ID,
      status: "open",
      title: "Já estava no quadro",
      position_in_stage: 1_000,
    },
  ],
  stage_pages: {
    [STAGE_ID]: {
      total: 1,
      cursor: null,
      has_more: false,
      next_position_in_stage: null,
    },
  },
} as unknown as BoardData;

describe("useBoard agrupa a reconciliação depois do realtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onChange = null;
    mocks.get.mockResolvedValue({ data: board });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aplica o lead imediatamente e faz um único refetch após uma rajada", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useBoard(PIPELINE_ID), { wrapper });
    await waitFor(() => expect(result.current.data?.leads).toHaveLength(1));
    expect(mocks.onChange).not.toBeNull();

    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    vi.useFakeTimers();

    act(() => {
      mocks.onChange?.({
        eventType: "UPDATE",
        new: {
          id: "66666666-6666-4666-8666-666666666666",
          pipeline_id: PIPELINE_ID,
          stage_id: STAGE_ID,
          status: "open",
          title: "Card ainda não paginado",
          position_in_stage: 99_000,
        },
      });
    });
    expect(client.getQueryData<BoardData>(["board", PIPELINE_ID])?.leads).toHaveLength(1);
    expect(
      client.getQueryData<BoardData>(["board", PIPELINE_ID])?.stage_pages?.[STAGE_ID]?.total,
    ).toBe(1);

    act(() => {
      mocks.onChange?.({
        eventType: "INSERT",
        new: {
          id: "55555555-5555-4555-8555-555555555555",
          pipeline_id: PIPELINE_ID,
          stage_id: STAGE_ID,
          status: "open",
          title: "Chegou agora",
          position_in_stage: 500,
        },
      });
      mocks.onChange?.({
        eventType: "UPDATE",
        new: {
          id: "55555555-5555-4555-8555-555555555555",
          pipeline_id: PIPELINE_ID,
          stage_id: STAGE_ID,
          status: "open",
          title: "Chegou agora, atualizado",
          position_in_stage: 500,
        },
      });
    });

    const atualizado = client.getQueryData<BoardData>(["board", PIPELINE_ID]);
    expect(atualizado?.leads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "55555555-5555-4555-8555-555555555555",
          title: "Chegou agora, atualizado",
        }),
      ]),
    );
    expect(atualizado?.stage_pages?.[STAGE_ID]?.total).toBe(2);
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["board", PIPELINE_ID] });

    unmount();
    client.clear();
  });
});
