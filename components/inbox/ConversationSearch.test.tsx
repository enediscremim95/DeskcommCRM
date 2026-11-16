import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationSearch } from "./ConversationSearch";

afterEach(() => vi.unstubAllGlobals());

describe("busca dentro da conversa", () => {
  it("mostra anterior/próxima e salta inclusive para resultado fora da página carregada", async () => {
    const onJump = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { message_id: "message-old", sent_at: "2026-01-01T00:00:00Z", snippet: "primeiro trecho", direction: "inbound", type: "text" },
              { message_id: "message-older", sent_at: "2025-12-01T00:00:00Z", snippet: "segundo trecho", direction: "outbound", type: "text" },
            ],
            meta: { cursor: null, has_more: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(
      <ConversationSearch
        conversationId="conversation"
        open
        onOpenChange={vi.fn()}
        onJump={onJump}
      />,
    );
    fireEvent.change(screen.getByLabelText("Buscar nesta conversa"), {
      target: { value: "pedido antigo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => expect(onJump).toHaveBeenCalledWith("message-old"));
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próximo resultado" }));
    await waitFor(() => expect(onJump).toHaveBeenLastCalledWith("message-older"));
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resultado anterior" }));
    await waitFor(() => expect(onJump).toHaveBeenLastCalledWith("message-old"));
  });

  it("busca a página seguinte quando avança além dos resultados carregados", async () => {
    const onJump = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { message_id: "message-1", sent_at: "2026-01-01T00:00:00Z", snippet: "um", direction: "inbound", type: "text" },
            ],
            meta: { cursor: "next-page", has_more: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { message_id: "message-2", sent_at: "2025-12-01T00:00:00Z", snippet: "dois", direction: "outbound", type: "text" },
            ],
            meta: { cursor: null, has_more: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ConversationSearch
        conversationId="conversation"
        open
        onOpenChange={vi.fn()}
        onJump={onJump}
      />,
    );
    fireEvent.change(screen.getByLabelText("Buscar nesta conversa"), {
      target: { value: "pedido" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(onJump).toHaveBeenLastCalledWith("message-1"));

    fireEvent.click(screen.getByRole("button", { name: /ximo resultado$/ }));

    await waitFor(() => expect(onJump).toHaveBeenLastCalledWith("message-2"));
    expect(fetchMock.mock.calls[1]?.[0]).toContain("cursor=next-page");
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });
});
