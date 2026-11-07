import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api/client";
import { useUpdateConversationPersonalState } from "./useInboxPersonalState";

vi.mock("@/lib/api/client", () => ({ apiClient: { patch: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

describe("mutação otimista do estado pessoal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aplica imediatamente e restaura o cache quando a API falha", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["conversations", { favorited: true }] as const;
    qc.setQueryData(queryKey, {
      pages: [{ data: [{ id: "c1", favorited_at: null }] }],
      pageParams: [undefined],
    });
    let rejeitar: ((error: Error) => void) | undefined;
    vi.mocked(apiClient.patch).mockReturnValue(
      new Promise((_resolve, reject) => { rejeitar = reject; }) as never,
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateConversationPersonalState(), { wrapper });

    act(() => result.current.mutate({ conversation_id: "c1", favorited: true }));
    await waitFor(() => {
      const data = qc.getQueryData(queryKey) as { pages: Array<{ data: Array<{ favorited_at: string | null }> }> };
      expect(data.pages[0]?.data[0]?.favorited_at).not.toBeNull();
    });

    act(() => rejeitar?.(new Error("falha")));
    await waitFor(() => {
      const data = qc.getQueryData(queryKey) as { pages: Array<{ data: Array<{ favorited_at: string | null }> }> };
      expect(data.pages[0]?.data[0]?.favorited_at).toBeNull();
    });
  });
});
