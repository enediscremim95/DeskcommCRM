import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AgentInboxList } from "@/app/app/ai/inbox/_components/AgentInboxList";
import { useAgentInbox, useResolveAllInboxItems, useUpdateInboxItem } from "@/hooks/ai/useAgentInbox";
import { useDecidirReativacao } from "@/hooks/kanban/useReativacao";
import { toast } from "sonner";

vi.mock("@/hooks/ai/useAgentInbox", () => ({
  useAgentInbox: vi.fn(),
  useUpdateInboxItem: vi.fn(),
  useResolveAllInboxItems: vi.fn(),
}));
vi.mock("@/hooks/kanban/useReativacao", () => ({ useDecidirReativacao: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useLocaleDeData: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mutateDecision = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAgentInbox).mockReturnValue({
    data: {
      open_count: 1,
      followups_today: 8,
      items: [{
        id: "55555555-5555-4555-8555-555555555555",
        kind: "followup_suggestion",
        severity: "info",
        title: "Retomar contato com Ana",
        body: "Mensagem fixa: Oi, ainda posso ajudar?",
        ref_kind: "lead",
        ref_id: "66666666-6666-4666-8666-666666666666",
        status: "open",
        created_at: new Date().toISOString(),
        metadata: { proposal_id: "77777777-7777-4777-8777-777777777777" },
        destination: { estado: "disponivel", rotulo: "Abrir negócio", href: "/app/leads/lead" },
      }],
    },
    isLoading: false,
  } as unknown as ReturnType<typeof useAgentInbox>);
  vi.mocked(useUpdateInboxItem).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateInboxItem>);
  vi.mocked(useResolveAllInboxItems).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useResolveAllInboxItems>);
  vi.mocked(useDecidirReativacao).mockReturnValue({
    mutate: mutateDecision,
    isPending: false,
  } as unknown as ReturnType<typeof useDecidirReativacao>);
});

describe("Central de avisos: follow-up aprovável", () => {
  it("mostra contador do dia e os dois botões, sem oferecer resolução genérica", () => {
    render(<AgentInboxList canResolve />);

    expect(screen.getByText("8 follow-ups aprovados hoje")).toBeVisible();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Não aprovar" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Marcar resolvido" })).toBeNull();
  });

  it("aprovar envia a identidade da proposta e mostra que aguardará a janela", () => {
    mutateDecision.mockImplementation((_input, options) => options.onSuccess({
      data: {
        status: "accepted",
        delivery_status: "queued_window",
        scheduled_for: "2026-09-27T10:00:00.000Z",
      },
    }));
    render(<AgentInboxList canResolve />);
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    expect(mutateDecision).toHaveBeenCalledWith(
      {
        leadId: "66666666-6666-4666-8666-666666666666",
        proposalId: "77777777-7777-4777-8777-777777777777",
        decision: "accept",
      },
      expect.any(Object),
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("janela de envio abrir"));
  });

  it("não aprovar registra a recusa pela rota de decisão", () => {
    render(<AgentInboxList canResolve />);
    fireEvent.click(screen.getByRole("button", { name: "Não aprovar" }));

    expect(mutateDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "dismiss" }),
      expect.any(Object),
    );
  });
});
