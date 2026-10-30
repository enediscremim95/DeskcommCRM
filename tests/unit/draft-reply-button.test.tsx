import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { DraftReplyButton } from "@/components/inbox/composer/DraftReplyButton";

beforeEach(() => {
  vi.clearAllMocks();
});

function getOnlySuggestionButton() {
  const buttons = screen.getAllByRole("button", { name: "Sugerir resposta" });
  expect(buttons).toHaveLength(1);
  return buttons[0]!;
}

describe("DraftReplyButton", () => {
  it("clicar pede a sugestão, mas não possui caminho de envio", () => {
    const onClick = vi.fn();
    render(<DraftReplyButton onClick={onClick} />);
    const btn = getOnlySuggestionButton();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fica ocupado e desabilitado enquanto prepara", () => {
    render(<DraftReplyButton onClick={vi.fn()} pending />);
    const button = getOnlySuggestionButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("disabled prop desabilita o botão", () => {
    render(<DraftReplyButton onClick={vi.fn()} disabled />);
    expect(getOnlySuggestionButton()).toBeDisabled();
  });
});
