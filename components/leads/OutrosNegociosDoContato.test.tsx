import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useContactLeads } from "@/hooks/contacts/useContactLeads";
import type { LeadComContexto } from "@/lib/types/leads";
import { OutrosNegociosDoContato } from "./OutrosNegociosDoContato";

vi.mock("@/hooks/contacts/useContactLeads", () => ({ useContactLeads: vi.fn() }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));

function negocio(overrides: Partial<LeadComContexto> = {}): LeadComContexto {
  return {
    id: "lead-atual",
    organization_id: "org-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Funil comercial",
    stage_id: "stage-1",
    stage_name: "Novo",
    field_defs: [],
    contact_id: "contact-1",
    title: "Negócio atual",
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
    source: "whatsapp",
    source_metadata: {},
    external_id: null,
    custom_fields: {},
    tags: [],
    created_at: "2026-10-02T12:00:00.000Z",
    updated_at: "2026-10-02T12:00:00.000Z",
    created_by_user_id: null,
    ...overrides,
  };
}

function mockLeads(data: LeadComContexto[]) {
  vi.mocked(useContactLeads).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useContactLeads>);
}

describe("OutrosNegociosDoContato", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("nasce recolhido e mostra origem, campanha e campos do outro negócio ao abrir", async () => {
    const user = userEvent.setup();
    mockLeads([
      negocio(),
      negocio({
        id: "lead-formulario",
        title: "Interesse no plano anual",
        source: "webhook",
        source_metadata: {
          pagina: "https://exemplo.com/plano",
          utm_campaign: "Campanha Primavera",
          utm_content: "Anúncio 03",
        },
        custom_fields: { cidade: "Curitiba", fbclid: "fb-123" },
        tags: ["formulário"],
        value_cents: 250000,
      }),
    ]);

    render(<OutrosNegociosDoContato contactId="contact-1" leadIdAtual="lead-atual" />);

    const secao = screen.getByRole("button", { name: "Outros negócios deste contato (1)" });
    const conteudo = document.getElementById(secao.getAttribute("aria-controls")!);
    expect(secao).toHaveAttribute("aria-expanded", "false");
    expect(conteudo).toHaveAttribute("hidden");

    await user.click(secao);
    expect(secao).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Interesse no plano anual")).toBeVisible();
    expect(screen.getByText("Origem: webhook")).toBeVisible();

    const contexto = screen.getByRole("button", { name: "Contexto" });
    expect(contexto).toHaveAttribute("aria-expanded", "false");
    await user.click(contexto);

    expect(screen.getByText("Campanha Primavera")).toBeVisible();
    expect(screen.getByText("https://exemplo.com/plano")).toBeVisible();
    expect(screen.getByText("Curitiba")).toBeVisible();
    expect(screen.getByText("fb-123")).toBeVisible();
  });

  it("não ocupa espaço quando não há outro negócio", () => {
    mockLeads([negocio()]);

    render(<OutrosNegociosDoContato contactId="contact-1" leadIdAtual="lead-atual" />);

    expect(
      screen.queryByRole("button", { name: /Outros negócios deste contato/ }),
    ).not.toBeInTheDocument();
  });

  it("nunca inclui o negócio atual na lista", async () => {
    mockLeads([
      negocio({ title: "Negócio que está aberto na tela" }),
      negocio({ id: "lead-outro", title: "Outro negócio" }),
    ]);

    render(<OutrosNegociosDoContato contactId="contact-1" leadIdAtual="lead-atual" />);
    await userEvent.setup().click(
      screen.getByRole("button", { name: "Outros negócios deste contato (1)" }),
    );

    expect(screen.queryByText("Negócio que está aberto na tela")).not.toBeInTheDocument();
    expect(screen.getByText("Outro negócio")).toBeVisible();
  });
});
