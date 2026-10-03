import type { ReactNode } from "react";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeadPageClient } from "@/components/leads/LeadPageClient";
import type { Lead } from "@/lib/types/leads";

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
  usePermission: () => true,
}));

vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

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

vi.mock("@/components/kanban/LeadFieldsForm", () => ({ LeadFieldsForm: () => null }));
vi.mock("@/components/kanban/LoseLeadDialog", () => ({ LoseLeadDialog: () => null }));
vi.mock("@/components/leads/DadosCompletosDoLead", () => ({ DadosCompletosDoLead: () => null }));
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

describe("rodapé da conversa na página do lead", () => {
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
});
