import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ChatThread } from "./ChatThread";
import type { Message } from "@/lib/types/messaging";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./ForwardDialog", () => ({
  ForwardDialog: ({ messageIds }: { messageIds: string[] }) => (
    <div data-testid="forward-dialog-ids">{messageIds.join(",")}</div>
  ),
}));
vi.mock("@/hooks/inbox/useConversationNotes", () => ({ useConversationNotes: () => [] }));
vi.mock("@/hooks/inbox/useDeleteNote", () => ({ useDeleteNote: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/ai/useDebugToggle", () => ({ useDebugToggle: () => ({ enabled: false }) }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ role: "agent" }),
  useUser: () => ({ id: "user-1", support: null }),
  usePermission: () => false,
}));

const ids = Array.from(
  { length: 11 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const messages: Message[] = ids.map((id, index) => ({
  id,
  organization_id: "org-1",
  conversation_id: "conversation-1",
  channel_session_id: "session-1",
  contact_id: "contact-1",
  external_id: null,
  type: "text",
  direction: "inbound",
  status: "sent",
  ack: null,
  error_code: null,
  error_message: null,
  body: `Mensagem ${index + 1}`,
  media_url: null,
  media_mime: null,
  media_size_bytes: null,
  media_storage_path: null,
  sent_via: "user",
  sent_by_user_id: null,
  sent_at: `2026-11-06T10:${String(index).padStart(2, "0")}:00.000Z`,
  delivered_at: null,
  read_at: null,
  metadata: {},
  edited_at: null,
  revoked_at: null,
  reply_to_message_id: null,
  created_at: `2026-11-06T10:${String(index).padStart(2, "0")}:00.000Z`,
}));

vi.mock("@/hooks/inbox/useMessagesRealtime", () => ({
  useMessagesRealtime: () => ({
    data: { pages: [{ data: messages }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    realtimeStatus: "ativo",
    seguranca: { divergencias: 0 },
  }),
}));

describe("ChatThread, seleção para encaminhar", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("seleciona várias em ordem, limita em 10 e abre o envio", () => {
    render(<ChatThread conversationId="conversation-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Selecionar" }));
    const checkboxes = screen.getAllByRole("checkbox", { name: "Selecionar esta mensagem" });
    checkboxes.slice(0, 10).forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(checkboxes[10]!);

    expect(toastError).toHaveBeenCalledWith("Você pode selecionar até 10 mensagens.");
    expect(screen.getByText("10 selecionadas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    expect(screen.getByTestId("forward-dialog-ids")).toHaveTextContent(ids.slice(0, 10).join(","));
  });
});
