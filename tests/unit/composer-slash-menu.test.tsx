import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();
const apiGetMock = vi.fn();

const templates = [
  {
    id: "saudacao",
    title: "Saudação inicial",
    body: "Olá, {{primeiro_nome}}! Como posso ajudar?",
    shortcut: "oi",
    owner_user_id: null,
    audio_storage_path: null,
    audio_mime_type: null,
    audio_file_name: null,
    audio_size_bytes: null,
  },
  {
    id: "fechamento",
    title: "Fechamento",
    body: "Obrigado, {{nome}}.",
    shortcut: "fechar",
    owner_user_id: null,
    audio_storage_path: "org/modelos/fechamento.ogg",
    audio_mime_type: "audio/ogg",
    audio_file_name: "fechamento.ogg",
    audio_size_bytes: 123,
  },
];

vi.mock("@/hooks/inbox/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: templates, isLoading: false }),
}));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useCreateNote", () => ({
  useCreateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: vi.fn(),
  },
}));

import { Composer } from "@/components/inbox/Composer";

function renderComposer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Composer conversationId="conv-1" contactName="Maria da Silva" />
    </QueryClientProvider>,
  );
}

describe("Composer + barra de modelos", () => {
  beforeEach(() => {
    sendMock.mockClear();
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({ data: { drafts: [] } });
  });

  it("abre somente com / no início e fecha com Esc", () => {
    renderComposer();
    const campo = screen.getByLabelText("Mensagem");

    fireEvent.change(campo, { target: { value: "R$ 10/20" } });
    expect(screen.queryByRole("listbox", { name: /modelos de mensagem/i })).not.toBeInTheDocument();

    fireEvent.change(campo, { target: { value: "/" } });
    expect(screen.getByRole("listbox", { name: /modelos de mensagem/i })).toBeInTheDocument();

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: /modelos de mensagem/i })).not.toBeInTheDocument();
  });

  it("usa setas e Enter para preencher, interpolar e não enviar", () => {
    renderComposer();
    const campo = screen.getByLabelText("Mensagem");

    fireEvent.change(campo, { target: { value: "/" } });
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /fechamento/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(campo, { key: "Enter" });

    expect(campo).toHaveValue("Obrigado, Maria da Silva.");
    expect(sendMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox", { name: /modelos de mensagem/i })).not.toBeInTheDocument();
  });

  it("clicar num modelo coloca o texto interpolado no campo sem enviar", () => {
    renderComposer();
    const campo = screen.getByLabelText("Mensagem");

    fireEvent.change(campo, { target: { value: "/oi" } });
    fireEvent.click(screen.getByRole("option", { name: /saudação inicial/i }));

    expect(campo).toHaveValue("Olá, Maria! Como posso ajudar?");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("mantém o campo fora da rolagem quando a assistência está expandida", async () => {
    apiGetMock.mockResolvedValue({
      data: {
        drafts: [
          {
            id: "draft-1",
            revision: "rev-1",
            status: "pending",
            original_body: "Resposta longa sugerida",
            edited_body: null,
            error_code: null,
            proposals: [{ tool: "consultar_agenda", arguments: {} }],
          },
        ],
      },
    });
    renderComposer();

    expect(await screen.findByLabelText("Resposta sugerida")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/ações propostas/i));
    expect(screen.getByText("consultar_agenda")).toBeInTheDocument();

    expect(screen.getByTestId("reply-review-scroll")).toHaveClass("min-h-0", "overflow-y-auto");
    expect(screen.getByTestId("composer-controls")).toHaveClass("shrink-0");
    await waitFor(() => expect(screen.getByLabelText("Mensagem")).toBeVisible());
  });
});
