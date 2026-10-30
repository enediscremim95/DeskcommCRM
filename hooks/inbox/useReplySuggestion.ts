"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface ReplySuggestionDraft {
  id: string;
  revision: string;
  status: string;
  original_body: string | null;
  edited_body: string | null;
  error_code: string | null;
}

interface ReplySuggestionState {
  data: {
    drafts: ReplySuggestionDraft[];
    assistant: { enabled: boolean; auto_suggest: boolean };
  };
}

interface GeneratedReplySuggestion {
  data: {
    draft: string;
    draft_id: string;
    revision: string;
    status: string;
  };
}

interface Options {
  conversationId: string;
  autoEligible: boolean;
  autoContextKey: string | null;
  composerEmpty: boolean;
  delayMs?: number;
}

/**
 * Liga a sugestão do servidor ao contexto vivo da conversa aberta.
 *
 * O atraso agrupa rajadas de mensagens. O servidor repete as guardas e reutiliza
 * o rascunho do mesmo contexto, portanto este hook nunca é a fronteira de
 * autoridade e nunca possui caminho de envio.
 */
export function useReplySuggestion({
  conversationId,
  autoEligible,
  autoContextKey,
  composerEmpty,
  delayMs = 900,
}: Options) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["reply-drafts", conversationId] as const, [conversationId]);
  const attemptedAutoKey = useRef<string | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.get<ReplySuggestionState>(`/api/v1/conversations/${conversationId}/draft-reply`),
    retry: false,
  });

  const upsert = useCallback(
    (generated: GeneratedReplySuggestion) => {
      const next: ReplySuggestionDraft = {
        id: generated.data.draft_id,
        revision: generated.data.revision,
        status: generated.data.status,
        original_body: generated.data.draft,
        edited_body: generated.data.draft,
        error_code: null,
      };
      qc.setQueryData<ReplySuggestionState>(queryKey, (current) => ({
        data: {
          assistant: current?.data.assistant ?? { enabled: true, auto_suggest: true },
          drafts: [next, ...(current?.data.drafts ?? []).filter((draft) => draft.id !== next.id)],
        },
      }));
      return next;
    },
    [qc, queryKey],
  );

  const generation = useMutation({
    mutationFn: (trigger: "manual" | "auto") =>
      apiClient.post<GeneratedReplySuggestion>(
        `/api/v1/conversations/${conversationId}/draft-reply`,
        { trigger },
      ),
    onSuccess: upsert,
  });
  const requestGeneration = generation.mutate;
  const requestGenerationAsync = generation.mutateAsync;

  const decision = useMutation({
    mutationFn: (input: {
      draft: ReplySuggestionDraft;
      action: "approve" | "reject";
      body?: string;
    }) =>
      apiClient.post(`/api/v1/ai/replies/${input.draft.id}`, {
        action: input.action,
        revision: input.draft.revision,
        ...(input.body === undefined ? {} : { body: input.body }),
      }),
    onSuccess: (_response, input) => {
      qc.setQueryData<ReplySuggestionState>(queryKey, (current) =>
        current
          ? {
              data: {
                ...current.data,
                drafts: current.data.drafts.map((draft) =>
                  draft.id === input.draft.id
                    ? {
                        ...draft,
                        status: input.action === "approve" ? "approved" : "dismissed",
                        edited_body: input.body ?? draft.edited_body,
                      }
                    : draft,
                ),
              },
            }
          : current,
      );
    },
  });
  const decideAsync = decision.mutateAsync;

  const currentDraft =
    query.data?.data.drafts.find(
      (draft) => draft.status === "pending" && Boolean(draft.original_body?.trim()),
    ) ?? null;
  const assistant = query.data?.data.assistant ?? { enabled: false, auto_suggest: false };

  // Uma mudança de contexto pode tornar o rascunho em cache obsoleto. O GET é
  // barato e usa fn_reply_context_current, a autoridade dessa decisão.
  useEffect(() => {
    attemptedAutoKey.current = null;
    if (autoContextKey) void query.refetch();
    // query.refetch é estável no React Query; a chave é o evento que interessa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, autoContextKey]);

  useEffect(() => {
    if (
      !query.isSuccess ||
      !assistant.enabled ||
      !assistant.auto_suggest ||
      !autoEligible ||
      !autoContextKey ||
      !composerEmpty ||
      currentDraft ||
      generation.isPending ||
      attemptedAutoKey.current === autoContextKey
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      attemptedAutoKey.current = autoContextKey;
      requestGeneration("auto");
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    assistant.auto_suggest,
    assistant.enabled,
    autoContextKey,
    autoEligible,
    composerEmpty,
    currentDraft,
    delayMs,
    generation.isPending,
    query.isSuccess,
    requestGeneration,
  ]);

  const generateManually = useCallback(async () => {
    try {
      return upsert(await requestGenerationAsync("manual"));
    } catch (error) {
      showApiError(error);
      return null;
    }
  }, [requestGenerationAsync, upsert]);

  const reject = useCallback(
    async (draft: ReplySuggestionDraft) => {
      // Esc vale para este contexto inteiro. Sem esta marca, rejeitar um
      // rascunho carregado do servidor removeria o pending do cache e o efeito
      // automático o recriaria imediatamente para a mesma mensagem.
      attemptedAutoKey.current = autoContextKey;
      try {
        await decideAsync({ draft, action: "reject" });
        return true;
      } catch (error) {
        showApiError(error);
        return false;
      }
    },
    [autoContextKey, decideAsync],
  );

  const approve = useCallback(
    async (draft: ReplySuggestionDraft, body: string) => {
      attemptedAutoKey.current = autoContextKey;
      try {
        return await decideAsync({ draft, action: "approve", body });
      } catch (error) {
        showApiError(error);
        throw error;
      }
    },
    [autoContextKey, decideAsync],
  );

  return {
    assistant,
    currentDraft,
    isLoading: query.isPending,
    isPreparing: generation.isPending,
    isDeciding: decision.isPending,
    generateManually,
    reject,
    approve,
  };
}
