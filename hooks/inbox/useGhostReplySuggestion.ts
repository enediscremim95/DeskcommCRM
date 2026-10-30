"use client";

import { useCallback, useState } from "react";
import type { ReplySuggestionDraft } from "./useReplySuggestion";

/** Estado local do texto fantasma. Nenhuma transição deste hook envia mensagem. */
export function useGhostReplySuggestion({
  conversationId,
  draft,
  text,
  enabled,
}: {
  conversationId: string;
  draft: ReplySuggestionDraft | null;
  text: string;
  enabled: boolean;
}) {
  const [dismissed, setDismissed] = useState<{
    conversationId: string;
    draftId: string;
  } | null>(null);
  const [accepted, setAccepted] = useState<{
    conversationId: string;
    draft: ReplySuggestionDraft;
  } | null>(null);
  const acceptedDraft = accepted?.conversationId === conversationId ? accepted.draft : null;

  const visible = Boolean(
    enabled &&
    draft?.original_body?.trim() &&
    text.length === 0 &&
    !(dismissed?.conversationId === conversationId && dismissed.draftId === draft.id) &&
    acceptedDraft?.id !== draft.id,
  );

  const accept = useCallback(() => {
    if (!visible || !draft?.original_body) return null;
    setAccepted({ conversationId, draft });
    return draft.original_body;
  }, [conversationId, draft, visible]);

  const dismiss = useCallback(() => {
    if (!draft || !visible) return null;
    setDismissed({ conversationId, draftId: draft.id });
    return draft;
  }, [conversationId, draft, visible]);

  const dismissByTyping = useCallback(
    (nextText: string) => {
      if (visible && draft && nextText.length > 0) {
        setDismissed({ conversationId, draftId: draft.id });
      }
    },
    [conversationId, draft, visible],
  );

  const restore = useCallback(
    (draftId: string) => {
      setAccepted((current) => (current?.conversationId === conversationId ? null : current));
      setDismissed((current) =>
        current?.conversationId === conversationId && current.draftId === draftId ? null : current,
      );
    },
    [conversationId],
  );

  const finish = useCallback(() => {
    if (acceptedDraft) setDismissed({ conversationId, draftId: acceptedDraft.id });
    setAccepted((current) => (current?.conversationId === conversationId ? null : current));
  }, [acceptedDraft, conversationId]);

  return {
    visible,
    ghostText: visible ? (draft?.original_body ?? "") : "",
    acceptedDraft,
    accept,
    dismiss,
    dismissByTyping,
    restore,
    finish,
  };
}
