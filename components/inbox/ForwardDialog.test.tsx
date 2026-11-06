import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForwardDialog } from "./ForwardDialog";

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/hooks/contacts/useContactList", () => ({
  useContactList: () => ({
    data: {
      pages: [{ data: [
        { id: "contact-1", name: "Ana", display_name: null, phone_number: "+5532999990001", is_anonymized: false },
        { id: "contact-2", name: "Bia", display_name: null, phone_number: "+5532999990002", is_anonymized: false },
      ] }],
    },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));

describe("ForwardDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("abre os destinos pelo caminho canônico e dispara o encaminhamento em lote", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("open-with-contact")) {
        const body = JSON.parse(String(init?.body)) as { contact_id: string };
        return new Response(JSON.stringify({ data: { conversation_id: `conv-${body.contact_id}` } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: {
          destinations: [
            { conversation_id: "conv-contact-1", status: "sent", messages: [{ status: "sent" }] },
            { conversation_id: "conv-contact-2", status: "sent", messages: [{ status: "sent" }] },
          ],
        },
      }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ForwardDialog
        open
        onOpenChange={vi.fn()}
        messageIds={["message-2", "message-1"]}
        channelSessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ana/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar (2)" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const forwardCall = fetchMock.mock.calls.find(([url]) => url === "/api/v1/messages/forward");
    expect(JSON.parse(String(forwardCall?.[1]?.body))).toEqual({
      message_ids: ["message-2", "message-1"],
      destination_conversation_ids: ["conv-contact-1", "conv-contact-2"],
      request_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    });
    expect(await screen.findAllByText("Enviado")).toHaveLength(2);
  });

  it("gera um request_id novo a cada clique em Encaminhar", async () => {
    const requestIds: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("open-with-contact")) {
        return new Response(JSON.stringify({ data: { conversation_id: "conv-contact-1" } }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { request_id: string };
      requestIds.push(body.request_id);
      return new Response(JSON.stringify({
        data: {
          destinations: [
            { conversation_id: "conv-contact-1", status: "sent", messages: [{ status: "sent" }] },
          ],
        },
      }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    async function encaminharUmaVez() {
      const view = render(
        <ForwardDialog
          open
          onOpenChange={vi.fn()}
          messageIds={["message-1"]}
          channelSessionId="session-1"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Ana/ }));
      fireEvent.click(screen.getByRole("button", { name: "Encaminhar (1)" }));
      await screen.findByText("Enviado");
      view.unmount();
    }

    await encaminharUmaVez();
    await encaminharUmaVez();

    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).not.toBe(requestIds[1]);
  });
});
