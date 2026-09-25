import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";

const agentActions = vi.hoisted(() => ({
  createMcpAgentAction: vi.fn(),
  discardMcpDraftAction: vi.fn(),
  publishAgentAction: vi.fn(),
  revertToVersionAction: vi.fn(),
}));
const atendimentoActions = vi.hoisted(() => ({
  auditDisabledGuardrailsAction: vi.fn(),
  proposeAttendanceInstructionAction: vi.fn(),
  saveAtendimentoDraftAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const stableT = vi.hoisted(() => (text: string) => text);

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => stableT }));
vi.mock("@/app/app/ai/agents/[id]/_actions", () => agentActions);
vi.mock("@/app/app/ai/atendimento/_actions", () => atendimentoActions);
vi.mock("@/app/app/ai/followups/[id]/_components/FlowBuilder", () => ({
  FlowBuilderShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/app/ai/followups/[id]/_components/FlowCanvas", () => ({
  FlowCanvasSurface: ({ nodes, onNodeClick }: { nodes: Array<{ id: string; data: { label: string } }>; onNodeClick: (event: unknown, node: { id: string }) => void }) => (
    <div>
      {nodes.map((node) => <button key={node.id} onClick={() => onNodeClick({}, node)}>{node.data.label}</button>)}
    </div>
  ),
}));
vi.mock("@/app/app/ai/followups/[id]/_components/NodePalette", () => ({
  NodePalette: ({ items, onSelect }: { items: Array<{ type: string; label: string }>; onSelect: (type: string) => void }) => (
    <div>{items.map((item) => <button key={item.type} onClick={() => onSelect(item.type)}>{item.label}</button>)}</div>
  ),
}));
vi.mock("@/app/app/ai/followups/[id]/_components/NodeConfigPanel", () => ({
  NodeConfigPanel: ({ custom }: { custom: { content: React.ReactNode } }) => <div>{custom.content}</div>,
}));
vi.mock("@/app/app/ai/followups/[id]/_components/EdgeConfigPanel", () => ({
  EdgeConfigPanel: () => <div>Conexão do fluxo</div>,
}));
vi.mock("@/app/app/ai/followups/[id]/_components/PublishBar", () => ({
  PublishBar: ({ changes, actions }: { changes: string[]; actions: React.ReactNode }) => (
    <div><div>{changes.map((change) => <span key={change}>{change}</span>)}</div>{actions}</div>
  ),
}));

import { AtendimentoBuilder } from "@/app/app/ai/atendimento/AtendimentoBuilder";
import { novoAtendimentoDoModelo, travasDoEstado } from "@/lib/ai/atendimento/flow";
import { NAV_DESTINATIONS } from "@/lib/navigation/registry";

const channel = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "WhatsApp comercial",
  status: "WORKING",
  phone_number: "+5541999999999",
};
const agent = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Atendimento comercial",
  description: "Qualifica e encaminha",
  published_version_id: null,
};

function version(overrides: Partial<AgentVersionRow> = {}): AgentVersionRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: "44444444-4444-4444-8444-444444444444",
    agent_id: agent.id,
    version_number: 2,
    system_prompt: "Atenda com clareza.",
    provider: "anthropic",
    model: "claude-sonnet-5",
    credential_id: "55555555-5555-4555-8555-555555555555",
    tool_ids: ["crm_apply_channel_label"],
    trigger_config: { filters: { business_hours: { start: "08:00", end: "18:00" } } },
    channel_session_id: channel.id,
    max_steps: 10,
    token_budget: 50_000,
    cost_budget_cents: 50,
    history_message_window: 20,
    history_token_window: 8_000,
    handoff_keywords: ["humano"],
    handoff_tool_enabled: true,
    cases_enabled: true,
    operator_enabled: true,
    operator_model: null,
    operator_tool_ids: ["crm_apply_channel_label"],
    pipeline_ids: [],
    knowledge_source_ids: [],
    skill_names: [],
    channel_config: { window_start_hour: 8, window_end_hour: 18, throttle_ms: 2_000, max_concurrent_ai_conversations: 1 },
    split_messages: true,
    split_max_chars: 600,
    followup: { enabled: false, flow_pointer_ids: [] },
    status: "draft",
    published_at: null,
    superseded_at: null,
    created_at: "2026-09-25T12:00:00.000Z",
    created_by: null,
    ...overrides,
  };
}

const baseProps = {
  channels: [channel],
  provider: "anthropic",
  model: "claude-sonnet-5",
  credentialId: null,
  defaultToolIds: [] as string[],
  agent,
  versions: [version()],
  dailyMessageLimit: 80,
  followupFlows: [] as Array<{ id: string; name: string }>,
};

describe("atendimento em um fluxo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    atendimentoActions.saveAtendimentoDraftAction.mockResolvedValue({
      ok: true,
      data: { version_id: "66666666-6666-4666-8666-666666666666" },
    });
    atendimentoActions.auditDisabledGuardrailsAction.mockResolvedValue({
      ok: true,
      data: { version_id: "66666666-6666-4666-8666-666666666666" },
    });
  });

  it("deixa no menu principal somente Atendimento, Casos e Alertas", () => {
    const items = NAV_DESTINATIONS.filter((item) => item.group === "ia" && item.sidebar);
    expect(items.map((item) => item.label)).toEqual(["Atendimento", "Casos", "Alertas"]);
    expect(items[0]).toMatchObject({ href: "/app/ai/atendimento", minRole: "manager" });
  });

  it("cria qualquer modelo de nicho com todas as travas ligadas", () => {
    for (const template of ["servicos", "imobiliaria", "clinica"] as const) {
      const state = novoAtendimentoDoModelo(template);
      expect(travasDoEstado(state)).toHaveLength(7);
      expect(travasDoEstado(state).every((guardrail) => guardrail.enabled)).toBe(true);
    }
  });

  it("exige confirmação com consequência e registra a trava desligada ao salvar", async () => {
    const user = userEvent.setup();
    render(<AtendimentoBuilder {...baseProps} />);

    const limitsButton = screen.getAllByRole("button", { name: "Limites e travas" })[0];
    expect(limitsButton).toBeDefined();
    await user.click(limitsButton!);
    const guardrail = screen.getByTestId("guardrail-horario");
    await user.click(within(guardrail).getByRole("switch"));

    expect(screen.getByRole("alertdialog")).toHaveTextContent("mensagens podem sair fora do horário de atendimento");
    await user.click(screen.getByRole("button", { name: "Entendo a consequência e quero desligar" }));
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(atendimentoActions.saveAtendimentoDraftAction).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({ channel_session_id: channel.id }),
      expect.objectContaining({ name: agent.name }),
      ["horario"],
    );
  });

  it("mostra no canvas as mudanças do rascunho MCP e permite descartá-lo", async () => {
    const user = userEvent.setup();
    agentActions.discardMcpDraftAction.mockResolvedValue({ ok: true });
    const mcpVersion = version({
      provisioning_origin: "mcp",
      mcp_change_summary: ["Prompt ajustado", "Limite diário alterado"],
    });
    render(<AtendimentoBuilder {...baseProps} versions={[mcpVersion]} />);

    expect(screen.getByText("Prompt ajustado")).toBeVisible();
    expect(screen.getByText("Limite diário alterado")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(agentActions.discardMcpDraftAction).toHaveBeenCalledWith(agent.id, mcpVersion.id);
  });

  it("publica a versão revisada pelo mesmo fluxo", async () => {
    const user = userEvent.setup();
    agentActions.publishAgentAction.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<AtendimentoBuilder {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Publicar" }));
    expect(agentActions.publishAgentAction).toHaveBeenCalledWith(agent.id, baseProps.versions[0]!.id);
    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/pacing", expect.objectContaining({ method: "PUT" }));
    vi.unstubAllGlobals();
  });

  it("cria do zero e audita a trava sem fabricar uma segunda versão", async () => {
    const user = userEvent.setup();
    agentActions.createMcpAgentAction.mockResolvedValue({
      ok: true,
      data: {
        agent_id: agent.id,
        version_id: "66666666-6666-4666-8666-666666666666",
      },
    });
    agentActions.publishAgentAction.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<AtendimentoBuilder {...baseProps} agent={null} versions={[]} />);

    await user.click(screen.getAllByRole("button", { name: "Limites e travas" })[0]!);
    await user.click(within(screen.getByTestId("guardrail-uma_conversa")).getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "Entendo a consequência e quero desligar" }));
    await user.click(screen.getByRole("button", { name: "Publicar" }));

    expect(agentActions.createMcpAgentAction).toHaveBeenCalledOnce();
    expect(atendimentoActions.auditDisabledGuardrailsAction).toHaveBeenCalledWith(
      agent.id,
      "66666666-6666-4666-8666-666666666666",
      ["uma_conversa"],
    );
    expect(atendimentoActions.saveAtendimentoDraftAction).not.toHaveBeenCalled();
    expect(agentActions.publishAgentAction).toHaveBeenCalledWith(
      agent.id,
      "66666666-6666-4666-8666-666666666666",
    );
    vi.unstubAllGlobals();
  });

  it("permite voltar para uma versão anterior publicada", async () => {
    const user = userEvent.setup();
    const previous = version({
      id: "77777777-7777-4777-8777-777777777777",
      version_number: 1,
      status: "superseded",
    });
    agentActions.revertToVersionAction.mockResolvedValue({ ok: true });
    render(<AtendimentoBuilder {...baseProps} versions={[version(), previous]} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "v1" }));
    await user.click(screen.getByRole("button", { name: "Voltar" }));

    expect(agentActions.revertToVersionAction).toHaveBeenCalledWith(agent.id, previous.id);
  });
});
