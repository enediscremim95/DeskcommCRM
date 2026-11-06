import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AttachmentPreviewDialog } from "./AttachmentPreviewDialog";
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
});
