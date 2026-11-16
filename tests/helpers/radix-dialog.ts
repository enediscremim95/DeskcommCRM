import { act, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * O FocusScope do Radix restaura o foco numa macrotarefa ao desmontar.
 * O teste precisa consumir essa tarefa enquanto o realm do jsdom ainda existe.
 */
export async function aguardarDialogRadixFechado(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

export async function desmontarDialogRadix(unmount: () => void): Promise<void> {
  unmount();
  await aguardarDialogRadixFechado();
}
