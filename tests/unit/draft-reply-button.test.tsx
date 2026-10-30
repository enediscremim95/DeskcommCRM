import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { DraftReplyButton } from "@/components/inbox/composer/DraftReplyButton";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DraftReplyButton", () => {
  it("clicar pede a sugestão, mas não possui caminho de envio", () => {
    const onClick = vi.fn();
    render(<DraftReplyButton onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Sugerir resposta" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fica ocupado e desabilitado enquanto prepara", () => {
    render(<DraftReplyButton onClick={vi.fn()} pending />);
    const button = screen.getByRole("button", { name: "Sugerir resposta" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("disabled prop desabilita o botão", () => {
    render(<DraftReplyButton onClick={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Sugerir resposta" })).toBeDisabled();
  });
});
