import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useGhostReplySuggestion } from "@/hooks/inbox/useGhostReplySuggestion";
import type { ReplySuggestionDraft } from "@/hooks/inbox/useReplySuggestion";

const draft: ReplySuggestionDraft = {
  id: "11000000-0000-4000-8000-000000000001",
  revision: "1",
  status: "pending",
  original_body: "Sugestão pronta",
  edited_body: "Sugestão pronta",
  error_code: null,
  proposals: [],
  agent_managed: true,
};

describe("estado local da sugestão fantasma", () => {
  it("aceitar transforma em rascunho editável sem produzir envio", () => {
    const { result, rerender } = renderHook(
      (props: { text: string }) =>
        useGhostReplySuggestion({
          conversationId: "conv-1",
          draft,
          text: props.text,
          enabled: true,
        }),
      { initialProps: { text: "" } },
    );

    expect(result.current.visible).toBe(true);
    let accepted: string | null = null;
    act(() => {
      accepted = result.current.accept();
    });
    expect(accepted).toBe("Sugestão pronta");
    expect(result.current.acceptedDraft).toEqual(draft);
    rerender({ text: "Sugestão pronta com edição" });
    expect(result.current.visible).toBe(false);
  });

  it("digitar ou dispensar impede o mesmo fantasma de reaparecer", () => {
    const { result, rerender } = renderHook(
      (props: { text: string }) =>
        useGhostReplySuggestion({
          conversationId: "conv-1",
          draft,
          text: props.text,
          enabled: true,
        }),
      { initialProps: { text: "" } },
    );

    act(() => result.current.dismissByTyping("oi"));
    rerender({ text: "oi" });
    rerender({ text: "" });
    expect(result.current.visible).toBe(false);

    act(() => result.current.restore(draft.id));
    expect(result.current.visible).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
  });
});
