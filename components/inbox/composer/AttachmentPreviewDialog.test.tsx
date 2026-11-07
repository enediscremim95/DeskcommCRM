import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AttachmentPreviewDialog } from "./AttachmentPreviewDialog";
import { createAttachmentQueueItems } from "@/lib/inbox/attachment-queue";
import { desmontarDialogRadix } from "@/tests/helpers/radix-dialog";

function arquivo(): File {
  return new File([new Uint8Array([1, 2, 3])], "produto.png", { type: "image/png" });
}

describe("prévia editável de anexo", () => {
  it("mantém Enter para nova linha e envia somente com Ctrl/Cmd+Enter", async () => {
    const onSend = vi.fn();
    const view = render(
      <AttachmentPreviewDialog
        file={arquivo()}
        initialCaption={"Linha 1\nLinha 2"}
        sending={false}
        onCancel={vi.fn()}
        onSend={onSend}
      />,
    );
    const legenda = screen.getByLabelText("Legenda");

    expect(fireEvent.keyDown(legenda, { key: "Enter" })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(legenda, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(onSend).toHaveBeenCalledWith("Linha 1\nLinha 2");
    await desmontarDialogRadix(view.unmount);
  });

  it("mostra contador e bloqueia envio acima de 1024 caracteres sem cortar", async () => {
    const legendaLonga = "x".repeat(1025);
    const onSend = vi.fn();
    const view = render(
      <AttachmentPreviewDialog
        file={arquivo()}
        initialCaption={legendaLonga}
        sending={false}
        onCancel={vi.fn()}
        onSend={onSend}
      />,
    );

    expect(screen.getByLabelText("Legenda")).toHaveValue(legendaLonga);
    expect(screen.getByText("1025/1024")).toBeInTheDocument();
    expect(
      screen.getByText("A legenda passou de 1024 caracteres. Reduza o texto para enviar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Legenda"), { key: "Enter", metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
    await desmontarDialogRadix(view.unmount);
  });

  it("cinco imagens abrem uma prévia com os cinco itens e legenda individual", async () => {
    const items = createAttachmentQueueItems(
      Array.from({ length: 5 }, (_, index) =>
        new File([new Uint8Array([index + 1])], `${index + 1}.png`, { type: "image/png" }),
      ),
    ).accepted;
    const onCaptionChange = vi.fn();
    const view = render(
      <AttachmentPreviewDialog
        items={items}
        activeItemId={items[0]!.id}
        sending={false}
        onSelectItem={vi.fn()}
        onCaptionChange={onCaptionChange}
        onCancel={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByText("5 anexos na fila")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Selecionar anexo/ })).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("Legenda"), { target: { value: "legenda da primeira" } });
    expect(onCaptionChange).toHaveBeenCalledWith(items[0]!.id, "legenda da primeira");
    await desmontarDialogRadix(view.unmount);
  });

  it("bloqueia a fila quando a legenda de outro anexo passa do limite", async () => {
    const items = createAttachmentQueueItems([arquivo(), arquivo()]).accepted.map((item, index) => ({
      ...item,
      caption: index === 1 ? "x".repeat(1025) : "legenda curta",
    }));

    const view = render(
      <AttachmentPreviewDialog
        items={items}
        activeItemId={items[0]!.id}
        sending={false}
        onCancel={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Enviar 2 anexos" })).toBeDisabled();
    await desmontarDialogRadix(view.unmount);
  });

  it("expõe tentar novamente, pular e cancelar restantes quando a fila pausa", async () => {
    const [failed] = createAttachmentQueueItems([arquivo()]).accepted;
    const onRetry = vi.fn();
    const onSkip = vi.fn();
    const onCancelRemaining = vi.fn();

    const view = render(
      <AttachmentPreviewDialog
        items={[{ ...failed!, status: "failed", error: "falha controlada" }]}
        activeItemId={failed!.id}
        sending={false}
        onCancel={vi.fn()}
        onSend={vi.fn()}
        onRetry={onRetry}
        onSkip={onSkip}
        onCancelRemaining={onCancelRemaining}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    fireEvent.click(screen.getByRole("button", { name: "Pular" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar restantes" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onCancelRemaining).toHaveBeenCalledOnce();
    await desmontarDialogRadix(view.unmount);
  });
});
