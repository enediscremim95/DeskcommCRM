import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api/client";
import type { TimelineItemView } from "@/lib/types/contacts";
import { AnotacoesDoLead } from "./AnotacoesDoLead";

vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const CURRENT_USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "11111111-1111-4111-8111-111111111112";
const LEAD_ID = "33333333-3333-4333-8333-333333333333";

function note(
  id: string,
  text: string,
  authorId: string,
  authorName: string,
  performedAt: string,
): TimelineItemView {
  return {
    id,
    organization_id: "22222222-2222-4222-8222-222222222222",
    lead_id: LEAD_ID,
    contact_id: null,
    source_module: "crm",
    source_id: null,
    type: "note",
    payload: { text },
    metadata: {},
    performed_at: performedAt,
    performed_by_user_id: authorId,
    actor_kind: "user",
    actor_agent_id: null,
    reason: null,
    evidence: null,
    actor_user_name: authorName,
  };
}

function renderNotes(canManage = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AnotacoesDoLead leadId={LEAD_ID} currentUserId={CURRENT_USER_ID} canManage={canManage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnotacoesDoLead", () => {
  it("lista as anotações com autora e horário de São Paulo, na ordem recebida", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        note(
          "note-new",
          "Está capitalizado",
          OTHER_USER_ID,
          "Beatriz Gerente",
          "2026-10-15T15:30:00.000Z",
        ),
        note("note-old", "Lead respondeu", CURRENT_USER_ID, "Ana SDR", "2026-10-15T14:00:00.000Z"),
      ],
    });

    renderNotes();

    expect(await screen.findByText("Está capitalizado")).toBeVisible();
    expect(screen.getByText("Beatriz Gerente")).toBeVisible();
    expect(screen.getByText("15/10/2026, 12:30")).toBeVisible();
    const items = screen.getAllByRole("listitem");
    const [primeiro, segundo] = items;
    if (!primeiro || !segundo) throw new Error("Esperava duas anotações na lista");
    expect(within(primeiro).getByText("Está capitalizado")).toBeVisible();
    expect(within(segundo).getByText("Lead respondeu")).toBeVisible();
  });

  it("cria uma anotação e a coloca no topo da lista", async () => {
    const created = note(
      "note-created",
      "Lead respondeu hoje",
      CURRENT_USER_ID,
      "Ana SDR",
      "2026-10-15T16:00:00.000Z",
    );
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
    vi.mocked(apiClient.post).mockResolvedValue({ data: created });
    const user = userEvent.setup();
    renderNotes();

    const field = await screen.findByRole("textbox", { name: "Nova anotação" });
    await user.type(field, "Lead respondeu hoje");
    await user.click(screen.getByRole("button", { name: "Criar anotação" }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(`/api/v1/leads/${LEAD_ID}/notes`, {
        text: "Lead respondeu hoje",
      }),
    );
    expect(await screen.findByText("Lead respondeu hoje")).toBeVisible();
    expect(field).toHaveValue("");
  });

  it("permite apagar só a própria anotação para atendente", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        note(
          "note-other",
          "Nota de outra pessoa",
          OTHER_USER_ID,
          "Beatriz",
          "2026-10-15T15:30:00Z",
        ),
        note("note-own", "Minha nota", CURRENT_USER_ID, "Ana", "2026-10-15T15:00:00Z"),
      ],
    });
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderNotes();

    expect(await screen.findByText("Minha nota")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Apagar anotação" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Apagar anotação" }));
    await user.click(screen.getByRole("button", { name: "Apagar" }));

    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith(`/api/v1/leads/${LEAD_ID}/notes/note-own`),
    );
    await waitFor(() => expect(screen.queryByText("Minha nota")).not.toBeInTheDocument());
    expect(screen.getByText("Nota de outra pessoa")).toBeVisible();
  });

  it("mostra a ação de apagar todas as anotações para gerente", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: [
        note(
          "note-other",
          "Nota de outra pessoa",
          OTHER_USER_ID,
          "Beatriz",
          "2026-10-15T15:30:00Z",
        ),
        note("note-own", "Minha nota", CURRENT_USER_ID, "Ana", "2026-10-15T15:00:00Z"),
      ],
    });

    renderNotes(true);

    expect(await screen.findByText("Minha nota")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Apagar anotação" })).toHaveLength(2);
  });
});
