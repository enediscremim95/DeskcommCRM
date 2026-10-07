import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Lead } from "@/lib/types/leads";
import { DadosCompletosDoLead, leadSectionStorageKey } from "./DadosCompletosDoLead";

vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    organization_id: "org-1",
    pipeline_id: "pipeline-1",
    stage_id: "stage-1",
    contact_id: null,
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
    ...overrides,
  };
}

describe("seções recolhíveis dos dados do lead", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("abre e fecha por clique e por teclado com os atributos acessíveis", async () => {
    const user = userEvent.setup();
    render(
      <DadosCompletosDoLead
        lead={lead({ source_metadata: { utm_campaign: "Campanha A" } })}
        pipelineName="Funil principal"
        stageName="Novo"
      />,
    );

    const negocio = screen.getByRole("button", { name: "Negócio" });
    const negocioContent = document.getElementById(negocio.getAttribute("aria-controls")!);
    expect(negocio).toHaveAttribute("aria-expanded", "true");
    expect(negocioContent).not.toHaveAttribute("hidden");

    await user.click(negocio);
    expect(negocio).toHaveAttribute("aria-expanded", "false");
    expect(negocioContent).toHaveAttribute("hidden");

    const origem = screen.getByRole("button", { name: "Origem, campanha e anúncio" });
    origem.focus();
    await user.keyboard("{Enter}");
    expect(origem).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(origem).toHaveAttribute("aria-expanded", "false");
  });

  it("abre dados informados somente quando há conteúdo e mantém seções vazias recolhidas", () => {
    const { rerender } = render(
      <DadosCompletosDoLead
        lead={lead({ custom_fields: { cidade: "Curitiba" } })}
        pipelineName="Funil principal"
        stageName="Novo"
      />,
    );

    expect(screen.getByRole("button", { name: "Dados informados" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    rerender(
      <DadosCompletosDoLead
        lead={lead({ id: "lead-2", custom_fields: {}, source_metadata: {} })}
        pipelineName="Funil principal"
        stageName="Novo"
      />,
    );

    const dadosVazios = screen.getByRole("button", { name: "Dados informados (vazio)" });
    const origemVazia = screen.getByRole("button", {
      name: "Origem, campanha e anúncio (vazio)",
    });
    expect(dadosVazios).toHaveAttribute("aria-expanded", "false");
    expect(origemVazia).toHaveAttribute("aria-expanded", "false");
    expect(dadosVazios).toBeDisabled();
    expect(origemVazia).toBeDisabled();
  });

  it("lembra a preferência pelo tipo da seção entre leads e montagens", async () => {
    const user = userEvent.setup();
    const first = render(
      <DadosCompletosDoLead
        lead={lead({ custom_fields: { cidade: "Curitiba" } })}
        pipelineName="Funil principal"
        stageName="Novo"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Dados informados" }));
    expect(localStorage.getItem(leadSectionStorageKey("dados-informados"))).toBe("closed");

    first.unmount();
    render(
      <DadosCompletosDoLead
        lead={lead({ id: "lead-2", custom_fields: { cidade: "São Paulo" } })}
        pipelineName="Outro funil"
        stageName="Em contato"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dados informados" })).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
  });

  it("continua funcionando quando o localStorage está indisponível", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    render(<DadosCompletosDoLead lead={lead()} pipelineName="Funil principal" stageName="Novo" />);

    const negocio = screen.getByRole("button", { name: "Negócio" });
    await userEvent.setup().click(negocio);
    expect(negocio).toHaveAttribute("aria-expanded", "false");
  });

  it("mantém os atalhos úteis sem renderizar Abrir no quadro", () => {
    render(
      <DadosCompletosDoLead
        lead={lead({ contact_id: "contact-1" })}
        pipelineName="Funil principal"
        stageName="Novo"
        conversationId="conversation-1"
      />,
    );

    expect(screen.queryByText("Abrir no quadro")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver contato" })).toHaveAttribute(
      "href",
      "/app/contacts/contact-1",
    );
    expect(screen.getByRole("link", { name: "Abrir conversa" })).toHaveAttribute(
      "href",
      "/app/inbox?id=conversation-1",
    );
  });

  it("mostra cada informação uma vez e recolhe identificadores técnicos no Sistema", async () => {
    const user = userEvent.setup();
    const fbclid = "IwAR1234567890abcdefghijklmnopqrstuv";
    const fonteId = "82fc1854-1548-4a9d-97ab-260d789f447d";
    const paginaCompleta =
      "https://exemplo.com/professores?utm_source=facebook&utm_campaign=Professores";

    render(
      <DadosCompletosDoLead
        lead={lead({
          source: "webhook",
          source_metadata: {
            source: "LP Professores SC",
            page_url: paginaCompleta,
            fbclid,
            webhook_source_id: fonteId,
            campaign_name: "Matrículas 2027",
            adset_name: "Professoras de SC",
            ad_name: "Vídeo 02",
            utm_source: "facebook",
            utm_medium: "paid_social",
            utm_campaign: "Professores",
            utm_content: "video-02",
            utm_term: "educação infantil",
          },
          external_id: "lead-externo-98765432109876543210",
          custom_fields: {
            fbclid: `  ${fbclid.toLocaleLowerCase("pt-BR")}  `,
            page_url: `  ${paginaCompleta}  `,
            webhook_source_id: fonteId,
            cidade: "Florianópolis",
          },
          description: "Pediu informações sobre a turma de novembro.",
          tags: ["professora"],
          value_cents: 350000,
        })}
        pipelineName="Funil principal"
        stageName="Novo"
      />,
    );

    const negocio = screen.getByRole("button", { name: "Negócio" });
    const negocioContent = document.getElementById(negocio.getAttribute("aria-controls")!)!;
    expect(within(negocioContent).queryByText("Funil", { exact: true })).not.toBeInTheDocument();
    expect(within(negocioContent).queryByText("Etapa", { exact: true })).not.toBeInTheDocument();
    expect(within(negocioContent).getByText("Negócio de teste")).toBeInTheDocument();
    expect(
      within(negocioContent).getByText("Pediu informações sobre a turma de novembro."),
    ).toBeInTheDocument();

    expect(screen.getAllByText(fbclid)).toHaveLength(1);
    expect(screen.getAllByText(fonteId)).toHaveLength(1);

    const sistema = screen.getByRole("button", { name: "Sistema" });
    const sistemaContent = document.getElementById(sistema.getAttribute("aria-controls")!)!;
    expect(sistema).toHaveAttribute("aria-expanded", "false");
    expect(sistemaContent).toContainElement(screen.getByText(fbclid));
    expect(sistemaContent).toContainElement(screen.getByText(fonteId));
    expect(within(sistemaContent).getByText("Canal de entrada")).toBeInTheDocument();
    expect(within(sistemaContent).getByText("webhook")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Origem, campanha e anúncio" }));
    expect(screen.getByText("LP Professores SC")).toBeVisible();
    expect(screen.getByText("Matrículas 2027")).toBeVisible();
    expect(screen.getByText("Professoras de SC")).toBeVisible();
    expect(screen.getByText("Vídeo 02")).toBeVisible();
    expect(screen.getByText("Florianópolis")).toBeVisible();

    const pagina = screen.getByTitle(paginaCompleta);
    expect(pagina).toHaveTextContent("https://exemplo.com/professores");
    expect(pagina).toHaveAttribute("href", paginaCompleta);
    expect(screen.getAllByTitle(paginaCompleta)).toHaveLength(1);
  });
});
