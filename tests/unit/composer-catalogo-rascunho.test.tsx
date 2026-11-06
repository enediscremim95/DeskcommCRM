import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn(async ({ file }: { file: File }) => ({
  storage_path: `org/conv/${file.name}`,
  media_mime: file.type,
  media_size_bytes: file.size,
  kind: "image" as const,
}));
const sendMock = vi.fn(
  (_payload: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.(),
);

vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: uploadMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [], isPending: false }),
}));
vi.mock("@/hooks/inbox/useReplySuggestion", () => ({
  useReplySuggestion: () => ({
    currentDraft: null,
    isPreparing: false,
    assistant: { enabled: false },
    generateManually: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  }),
}));
vi.mock("@/hooks/inbox/useGhostReplySuggestion", () => ({
  useGhostReplySuggestion: () => ({
    acceptedDraft: null,
    visible: false,
    ghostText: "",
    accept: vi.fn(),
    dismiss: vi.fn(),
    dismissByTyping: vi.fn(),
    finish: vi.fn(),
    restore: vi.fn(),
  }),
}));
vi.mock("@/components/inbox/composer/ReplyReviewPanel", () => ({
  ReplyReviewPanel: () => null,
}));
vi.mock("@/components/inbox/composer/ContactPickerDialog", () => ({
  ContactPickerDialog: () => null,
}));
vi.mock("@/components/inbox/composer/CatalogPickerDialog", () => ({
  CatalogPickerDialog: ({
    open,
    onDrafts,
  }: {
    open: boolean;
    onDrafts: (drafts: unknown[]) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onDrafts([
            {
              product_id: "produto-1",
              nome: "Produto 1",
              legenda: "Legenda 1",
              excede_limite: false,
              foto: { url: "/foto-1", mime: "image/png", nome_do_arquivo: "foto-1.png" },
            },
            {
              product_id: "produto-2",
              nome: "Produto 2",
              legenda: "Legenda 2",
              excede_limite: false,
              foto: { url: "/foto-2", mime: "image/png", nome_do_arquivo: "foto-2.png" },
            },
            {
              product_id: "produto-3",
              nome: "Produto 3",
              legenda: "Legenda 3 sem foto",
              excede_limite: false,
              foto: null,
            },
          ])
        }
      >
        Gerar rascunhos do catálogo
      </button>
    ) : null,
}));

import { Composer } from "@/components/inbox/Composer";

function respostaComBlob(blob: Blob): Response {
  return {
    ok: true,
    blob: async () => blob,
  } as unknown as Response;
}

function renderComposer() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Composer conversationId="conv-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      respostaComBlob(new Blob([new Uint8Array([1])], { type: "image/png" })),
    )
    .mockResolvedValueOnce(
      respostaComBlob(new Blob([new Uint8Array([2])], { type: "image/png" })),
    );
});

describe("fila de rascunhos do catálogo no compositor", () => {
  it("abre um preview por vez, avança após enviar ou cancelar e leva item sem foto ao texto", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    fireEvent.click(screen.getByRole("button", { name: "Catálogo" }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar rascunhos do catálogo" }));

    expect(await screen.findByDisplayValue("Legenda 1")).toBeInTheDocument();
    expect(screen.getByText("Produto 1 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByDisplayValue("Legenda 2")).toBeInTheDocument();
    expect(screen.getByText("Produto 2 de 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Mensagem")).toHaveValue("Legenda 3 sem foto"),
    );
    expect(screen.getByText("Produto 3 de 3")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission: () => true }));
