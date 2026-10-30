import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const createNoteMock = vi.fn();
const reply = vi.hoisted(() => ({
  draft: {
    id: "11000000-0000-4000-8000-000000000001",
    revision: "1",
    status: "pending",
    original_body: "Claro, posso ajudar por aqui.",
    edited_body: "Claro, posso ajudar por aqui.",
    error_code: null,
  },
  generateManually: vi.fn(),
  reject: vi.fn(),
  approve: vi.fn(),
}));

vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useCreateNote", () => ({
  useCreateNote: () => ({ mutate: createNoteMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/inbox/useReplySuggestion", () => ({
  useReplySuggestion: () => ({
    assistant: { enabled: true, auto_suggest: true },
    currentDraft: reply.draft,
    isLoading: false,
    isPreparing: false,
    isDeciding: false,
    generateManually: reply.generateManually,
    reject: reply.reject,
    approve: reply.approve,
  }),
}));

import { Composer } from "@/components/inbox/Composer";

function renderComposer() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Composer conversationId="conv-1" />
    </QueryClientProvider>,
  );
}

describe("sugestão fantasma no compositor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reply.approve.mockResolvedValue({ data: { status: "approved" } });
    reply.reject.mockResolvedValue(true);
  });

  it("aparece apagada na própria caixa e Tab apenas aceita", () => {
    renderComposer();
    const input = screen.getByRole("textbox", { name: "Mensagem" });
    expect(input).toHaveAttribute("placeholder", reply.draft.original_body);

    const browserPodeNavegar = fireEvent.keyDown(input, { key: "Tab" });

    expect(browserPodeNavegar).toBe(false);
    expect(input).toHaveValue(reply.draft.original_body);
    expect(sendMock).not.toHaveBeenCalled();
    expect(reply.approve).not.toHaveBeenCalled();
  });

  it("Enter depois do Tab autoriza o rascunho, sem usar o envio comum em paralelo", async () => {
    renderComposer();
    const input = screen.getByRole("textbox", { name: "Mensagem" });
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(reply.approve).toHaveBeenCalledWith(reply.draft, reply.draft.original_body),
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("Esc dispensa e registra rejeição sem enviar", async () => {
    renderComposer();
    const input = screen.getByRole("textbox", { name: "Mensagem" });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(reply.reject).toHaveBeenCalledWith(reply.draft));
    expect(input).not.toHaveAttribute("placeholder", reply.draft.original_body);
    expect(sendMock).not.toHaveBeenCalled();
    expect(reply.approve).not.toHaveBeenCalled();
  });

  it("digitar dispensa o fantasma sem rejeitar nem enviar", () => {
    renderComposer();
    const input = screen.getByRole("textbox", { name: "Mensagem" });
    fireEvent.change(input, { target: { value: "Vou responder eu mesmo" } });
    const browserPodeNavegar = fireEvent.keyDown(input, { key: "Tab" });

    expect(input).toHaveValue("Vou responder eu mesmo");
    expect(input).not.toHaveAttribute("placeholder", reply.draft.original_body);
    expect(reply.reject).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(browserPodeNavegar).toBe(true);
  });

  it("o chip de celular aceita como o Tab e mantém o foco editável", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Usar sugestão" }));
    expect(screen.getByRole("textbox", { name: "Mensagem" })).toHaveValue(
      reply.draft.original_body,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });
});
