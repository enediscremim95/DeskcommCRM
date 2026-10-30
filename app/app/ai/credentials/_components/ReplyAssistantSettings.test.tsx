import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));

import { ReplyAssistantSettings } from "./ReplyAssistantSettings";

const estado = {
  enabled: false,
  state: "off",
  provider: "anthropic",
  credential_id: null,
  credential_last4: null,
  validation_error: null,
  team_style: "Responda de forma direta, cordial e humana.",
  history_message_window: 20,
  history_token_window: 4_000,
  hourly_limit: 20,
  daily_limit: 100,
  auto_suggest: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: estado });
});

describe("Assistente de resposta", () => {
  it("explica custo, revisão humana e estado desligado", async () => {
    render(<ReplyAssistantSettings canWrite />);
    expect(await screen.findByText("Desligado")).toBeInTheDocument();
    expect(screen.getByText(/Uma pessoa sempre revisa antes de enviar/)).toBeInTheDocument();
    expect(screen.getByText(/A chave e o custo são desta organização/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ligar assistente" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Sugerir sozinho ao chegar mensagem" })).toBeChecked();
  });

  it("manager sem permissão enxerga, mas não altera", async () => {
    render(<ReplyAssistantSettings canWrite={false} />);
    expect(await screen.findByText("Desligado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ligar assistente" })).toBeDisabled();
    expect(screen.getByText(/Somente uma pessoa administradora/)).toBeInTheDocument();
  });
});
