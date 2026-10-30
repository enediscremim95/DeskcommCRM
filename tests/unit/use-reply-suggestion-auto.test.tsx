import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { useReplySuggestion } from "@/hooks/inbox/useReplySuggestion";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe("geração automática da sugestão", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({
      data: { drafts: [], assistant: { enabled: true, auto_suggest: true } },
    });
    api.post.mockResolvedValue({
      data: {
        draft: "Sugestão automática",
        draft_id: "11000000-0000-4000-8000-000000000001",
        revision: "1",
        status: "pending",
        proposals: [],
        agent_managed: true,
      },
    });
  });

  it("prepara após o atraso sem chamar nenhum caminho de envio", async () => {
    renderHook(
      () =>
        useReplySuggestion({
          conversationId: "conv-1",
          autoEligible: true,
          autoContextKey: "2026-10-29T22:03:00.000Z",
          composerEmpty: true,
          delayMs: 0,
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/v1/conversations/conv-1/draft-reply", {
        trigger: "auto",
      }),
    );
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls.some(([url]) => url === "/api/v1/messages")).toBe(false);
    expect(api.post.mock.calls.some(([url]) => String(url).includes("/ai/replies/"))).toBe(false);
  });

  it("Esc rejeita um rascunho carregado sem gerar outro para o mesmo contexto", async () => {
    const loadedDraft = {
      id: "11000000-0000-4000-8000-000000000001",
      revision: "1",
      status: "pending",
      original_body: "Sugestão já preparada",
      edited_body: "Sugestão já preparada",
      error_code: null,
      proposals: [],
      agent_managed: true,
    };
    api.get.mockResolvedValue({
      data: {
        drafts: [loadedDraft],
        assistant: { enabled: true, auto_suggest: true },
      },
    });
    api.post.mockResolvedValue({ data: { status: "dismissed" } });

    const { result } = renderHook(
      () =>
        useReplySuggestion({
          conversationId: "conv-1",
          autoEligible: true,
          autoContextKey: "2026-10-29T22:03:00.000Z",
          composerEmpty: true,
          delayMs: 0,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.currentDraft?.id).toBe(loadedDraft.id));
    await act(async () => {
      await result.current.reject(loadedDraft);
    });

    await waitFor(() => expect(result.current.currentDraft).toBeNull());
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(`/api/v1/ai/replies/${loadedDraft.id}`, {
      action: "reject",
      revision: "1",
    });
  });
});
