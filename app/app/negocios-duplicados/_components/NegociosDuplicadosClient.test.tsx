import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NegociosDuplicadosClient } from "./NegociosDuplicadosClient";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

const SURVIVOR = "aaaaaaaa-0000-4000-8000-000000000003";
const ABSORBED = "aaaaaaaa-0000-4000-8000-000000000004";
const LOG = "aaaaaaaa-0000-4000-8000-000000000005";

function resposta(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : { error: data }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const grupo = {
  group_key: "contato:funil",
  contact_id: "aaaaaaaa-0000-4000-8000-000000000001",
  pipeline_id: "aaaaaaaa-0000-4000-8000-000000000002",
  classification: "vazio_com_contexto" as const,
  survivor: {
    id: SURVIVOR,
    title: "Card do formulário",
    source: "webhook",
    value_cents: null,
    custom_fields: { interesse: "Plano anual" },
    source_metadata: { page_url: "/captura", utm_campaign: "campanha-a" },
    tags: [],
    created_at: "2030-01-01T10:00:00Z",
    contact_name: "Maria",
    pipeline_name: "Comercial",
  },
  absorbed: [
    {
      id: ABSORBED,
      title: "Card do WhatsApp",
      source: "manual",
      value_cents: null,
      custom_fields: {},
      source_metadata: {},
      tags: [],
      created_at: "2030-01-02T10:00:00Z",
      contact_name: "Maria",
      pipeline_name: "Comercial",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("tela de negócios duplicados", () => {
  it("mostra a mensagem vazia decidida quando não há candidatos", async () => {
    mocks.fetch.mockImplementation(() => resposta([]));
    render(<NegociosDuplicadosClient />);

    expect(await screen.findByText("Nenhum negócio duplicado para conferir.")).toBeVisible();
    expect(screen.getByText("Junções recentes")).toBeVisible();
  });

  it("mostra os dois cards, pede confirmação e oferece desfazer no toast", async () => {
    let merged = false;
    mocks.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/leads/duplicates")) return resposta(merged ? [] : [grupo]);
      if (url.endsWith("/api/v1/leads/merges/recent")) return resposta([]);
      if (url.endsWith("/api/v1/leads/merge") && init?.method === "POST") {
        merged = true;
        return resposta({
          outcome: "merged",
          log_id: LOG,
          survivor_lead_id: SURVIVOR,
          absorbed_lead_id: ABSORBED,
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    });
    render(<NegociosDuplicadosClient />);

    expect(await screen.findByText("Card do formulário")).toBeVisible();
    expect(screen.getByText("Card do WhatsApp")).toBeVisible();
    expect(screen.getByText("campanha-a")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Juntar" }));
    expect(screen.getByRole("heading", { name: "Juntar estes negócios?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Juntar negócios" }));

    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/v1/leads/merge",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            survivor_lead_id: SURVIVOR,
            absorbed_lead_id: ABSORBED,
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        "Negócios juntados.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Desfazer" }) }),
      ),
    );
  });

  it("mantém textos técnicos longos recolhidos e os candidatos dentro da grade responsiva", async () => {
    const fbclid = `fbclid-${"x".repeat(143)}`;
    const pageUrl = `https://exemplo.com/pagina?${"utm_source=facebook&".repeat(16)}fim=1`;
    const grupoLongo = {
      ...grupo,
      survivor: {
        ...grupo.survivor,
        source_metadata: {
          ...grupo.survivor.source_metadata,
          page_name: "Página de captura",
          campaign_name: "Campanha principal",
          fbclid,
          page_url: pageUrl,
        },
      },
    };
    mocks.fetch.mockImplementation((input: RequestInfo | URL) =>
      String(input).endsWith("/api/v1/leads/duplicates") ? resposta([grupoLongo]) : resposta([]),
    );

    render(<NegociosDuplicadosClient />);

    const grid = await screen.findByTestId("candidatos-contato:funil");
    expect(grid).toHaveClass("grid", "gap-3", "min-w-0", "md:grid-cols-2", "xl:grid-cols-3");
    const cards = within(grid).getAllByTestId(/candidato-/);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toHaveClass("h-full", "min-w-0", "overflow-hidden");
      expect(card.className).not.toMatch(/(?:^|\s)(?:min-)?w-\[[^\]]+\]/);
    }

    const survivor = within(grid).getByTestId(`candidato-${SURVIVOR}`);
    const corpo = within(survivor).getByTestId("resumo-do-candidato");
    expect(corpo).not.toHaveTextContent(fbclid);
    expect(corpo).not.toHaveTextContent(pageUrl);
    expect(within(corpo).getByTitle("Campanha principal")).toHaveClass("truncate");

    const detalhes = within(survivor).getByTestId("detalhes-tecnicos");
    expect(within(detalhes).getByText(fbclid)).toHaveClass("break-all");
    expect(within(detalhes).getByText(pageUrl)).toHaveClass("break-all");
  });
});
