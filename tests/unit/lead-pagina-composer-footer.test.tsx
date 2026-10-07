import type { ReactNode } from "react";

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LeadPageClient } from "@/components/leads/LeadPageClient";
import { useContactLeads } from "@/hooks/contacts/useContactLeads";
import type { Lead, LeadComContexto } from "@/lib/types/leads";

const { mockUsePermission } = vi.hoisted(() => ({
  mockUsePermission: vi.fn(() => true),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: { role: "admin" }, user: { support: null } }),
  usePermission: mockUsePermission,
}));

vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/contacts/useContactLeads", () => ({ useContactLeads: vi.fn() }));

vi.mock("@/hooks/inbox/useConversation", () => ({
  isNotFound: () => false,
  useConversation: () => ({
    data: {
      id: "conversation-1",
      contact_id: "contact-1",
      status: "open",
      unread_count_for_assignee: 0,
      last_inbound_at: new Date().toISOString(),
      channel_sessions: { provider: "waha" },
      contacts: { name: "Maria", is_blocked: false, is_anonymized: false },
    },
    error: null,
    isLoading: false,
    isPending: false,
  }),
}));

vi.mock("@/hooks/inbox/useMarkAsRead", () => ({ useMarkAsRead: () => undefined }));

vi.mock("@/hooks/leads/useLeadTimeline", () => ({
  useLeadTimeline: () => ({
    itens: [],
    isError: false,
    realtimeStatus: "connected",
    seguranca: { divergencias: 0 },
  }),
}));

vi.mock("@/hooks/webhooks/useWebhookSources", () => ({
  usePipelineStages: () => ({
    data: {
      data: {
        stages: [{ id: "stage-1", name: "Novo", position: 1, is_lost: false, is_won: false }],
      },
    },
  }),
}));

vi.mock("@/hooks/notifications/OpenConversationContext", () => ({
  OpenConversationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/inbox/ChatThread", () => ({
  ChatThread: () => <div data-testid="chat-thread" />,
}));
vi.mock("@/components/inbox/Composer", () => ({
  Composer: () => <div data-testid="composer" />,
}));
vi.mock("@/components/inbox/ConversationHeader", () => ({
  ConversationHeader: () => <div data-testid="conversation-header" />,
}));
vi.mock("@/components/inbox/JanelaFechadaAviso", () => ({
  JanelaFechadaAviso: () => <div data-testid="window-notice" />,
}));
vi.mock("@/components/inbox/RetentionNotice", () => ({
  RetentionNotice: () => <div data-testid="retention-notice" />,
}));

vi.mock("@/components/kanban/LeadFieldsForm", () => ({
  LeadFieldsForm: () => <div data-testid="lead-fields-form" />,
}));
vi.mock("@/components/kanban/LoseLeadDialog", () => ({ LoseLeadDialog: () => null }));
vi.mock("@/components/leads/DadosCompletosDoLead", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/leads/DadosCompletosDoLead")>();
  return {
    ...original,
    DadosCompletosDoLead: () => <div data-testid="dados-completos">Dados informados</div>,
  };
});
vi.mock("@/components/leads/DeleteLeadDialog", () => ({ DeleteLeadDialog: () => null }));
vi.mock("@/components/leads/FollowupsDoLead", () => ({ FollowupsDoLead: () => null }));
vi.mock("@/components/leads/LeadQualification", () => ({ LeadQualification: () => null }));
vi.mock("@/components/leads/ProximasTarefasDoLead", () => ({
  ProximasTarefasDoLead: () => null,
}));
vi.mock("@/components/leads/StageSelector", () => ({ StageSelector: () => null }));

const lead: Lead = {
  id: "lead-1",
  organization_id: "org-1",
  pipeline_id: "pipeline-1",
  stage_id: "stage-1",
  contact_id: "contact-1",
  title: "Negócio de teste",
  description: null,
  status: "open",
  qualification: null,
  lost_reason: null,
  position_in_stage: 1,
  value_cents: null,
  currency: "BRL",
  owner_user_id: null,
  owner_kind: null,
  owner_agent_id: null,
  assigned_at: null,
  last_activity_at: null,
  stage_entered_at: "2026-10-02T12:00:00.000Z",
  expected_close_date: null,
  closed_at: null,
  source: "manual",
  source_metadata: {},
  external_id: null,
  custom_fields: {},
  tags: [],
  created_at: "2026-10-02T12:00:00.000Z",
  updated_at: "2026-10-02T12:00:00.000Z",
  created_by_user_id: null,
};

const outroNegocio: LeadComContexto = {
  ...lead,
  id: "lead-2",
  title: "Negócio do formulário",
  pipeline_name: "Funil principal",
  stage_name: "Novo",
  field_defs: [],
};

function mockNegociosDoContato(data: LeadComContexto[]) {
  vi.mocked(useContactLeads).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useContactLeads>);
}

describe("rodapé da conversa na página do lead", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUsePermission.mockReturnValue(true);
    mockNegociosDoContato([]);
  });

  it("limita a grade à tela no desktop e dá rolagem própria às colunas", () => {
    render(
      <LeadPageClient
        lead={lead}
        pipelineName="Funil principal"
        stageName="Novo"
        fieldDefs={[]}
        contact={null}
        conversationId="conversation-1"
        hasConnectedChannel
        canReplyInConversation
      />,
    );

    const workspace = screen.getByTestId("lead-page-workspace");
    expect(workspace).toHaveClass("lg:h-[calc(100dvh-5.5rem)]");

    const [leadDetails, conversation] = Array.from(workspace.children);
    expect(leadDetails).toHaveClass("lg:h-full", "lg:min-h-0", "lg:overflow-y-auto");
    expect(conversation).toHaveClass("lg:h-full", "lg:min-h-0");

    const voltar = screen.getByRole("link", { name: "Voltar ao funil" });
    expect(voltar).toHaveAttribute("href", "/app/pipelines/pipeline-1");
    expect(screen.getByText("Funil principal").closest("header")).toContainElement(voltar);
  });

  it("mantém o chat flexível e limita avisos e compositor no rodapé", () => {
    render(
      <LeadPageClient
        lead={lead}
        pipelineName="Funil principal"
        stageName="Novo"
        fieldDefs={[]}
        contact={null}
        conversationId="conversation-1"
        hasConnectedChannel
        canReplyInConversation
      />,
    );

    const footer = screen.getByTestId("conversation-footer");
    expect(footer).toHaveClass(
      "flex",
      "max-h-[min(52%,28rem)]",
      "shrink-0",
      "flex-col",
      "overflow-hidden",
    );
    expect(within(footer).getByTestId("composer")).toBeInTheDocument();

    const notices = within(footer).getByTestId("conversation-footer-notices");
    expect(notices).toHaveClass("max-h-28", "shrink-0", "overflow-y-auto");
    expect(within(notices).getByTestId("retention-notice")).toBeInTheDocument();

    const chatWrapper = screen.getByTestId("chat-thread").parentElement;
    expect(chatWrapper).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
    expect(chatWrapper?.parentElement).toBe(footer.parentElement);
    expect(footer).not.toContainElement(screen.getByTestId("chat-thread"));
  });

  it("mostra outros negócios recolhidos com a contagem na ficha do lead", () => {
    mockNegociosDoContato([outroNegocio]);

    render(
      <LeadPageClient
        lead={lead}
        pipelineName="Funil principal"
        stageName="Novo"
        fieldDefs={[]}
        contact={null}
        conversationId="conversation-1"
        hasConnectedChannel
        canReplyInConversation
      />,
    );

    const secao = screen.getByRole("button", { name: "Outros negócios deste contato (1)" });
    expect(secao).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(secao.getAttribute("aria-controls")!)).toHaveAttribute(
      "hidden",
    );
  });

  it("não mostra a seção na ficha quando o contato não tem outro negócio", () => {
    render(
      <LeadPageClient
        lead={lead}
        pipelineName="Funil principal"
        stageName="Novo"
        fieldDefs={[]}
        contact={null}
        conversationId="conversation-1"
        hasConnectedChannel
        canReplyInConversation
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Outros negócios deste contato/ }),
    ).not.toBeInTheDocument();
  });

  it("deixa Excluir depois de todas as seções da coluna, fora do cabeçalho", () => {
    render(
      <LeadPageClient
        lead={lead}
        pipelineName="Funil principal"
        stageName="Novo"
        fieldDefs={[]}
        contact={null}
        conversationId="conversation-1"
        hasConnectedChannel
        canReplyInConversation
      />,
    );

    const excluir = screen.getByRole("button", { name: "Excluir" });
    const dados = screen.getByTestId("dados-completos");
    const formulario = screen.getByTestId("lead-fields-form");
    const header = screen.getByText("Funil principal").closest("header");

    expect(header).not.toContainElement(excluir);
    expect(dados.compareDocumentPosition(excluir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      formulario.compareDocumentPosition(excluir) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(excluir.parentElement).toHaveClass("mt-8", "border-t", "pt-4");
  });

  it("não mostra Excluir sem a permissão lead.delete", () => {
    mockUsePermission.mockReturnValue(false);

    render(
      <LeadPageClient
        lead={lead}
        pipelineName="Funil principal"
        stageName="Novo"
        fieldDefs={[]}
        contact={null}
        conversationId="conversation-1"
        hasConnectedChannel
        canReplyInConversation
      />,
    );

    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
  });
});
