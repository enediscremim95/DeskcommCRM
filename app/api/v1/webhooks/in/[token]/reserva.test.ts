import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const TOKEN = "fonte-cacheada-123456";

const enfileirar = vi.fn();
let cachedSourceAvailable = true;
let cachedSourceSecret: string | null = null;
let bancoDisponivel = false;
const leads = new Map<string, { id: string; contact_id: null }>();
const criarLead = vi.fn(
  async (
    _admin: unknown,
    context: { organization_id: string },
    input: { external_id?: string },
  ) => {
    const key = `${context.organization_id}:${input.external_id}`;
    const lead = { id: `lead-${leads.size + 1}`, contact_id: null };
    leads.set(key, lead);
    return lead;
  },
);

const source = {
  id: SOURCE,
  name: "LP",
  organization_id: ORG,
  secret_encrypted: null,
  source_secret: null,
  default_pipeline_id: "33333333-3333-4333-8333-333333333333",
  default_stage_id: "44444444-4444-4444-8444-444444444444",
  default_owner_user_id: null,
  field_map: {},
  redirect_to: null,
  is_active: true,
  merge_repeated_submissions: false,
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let externalId = "";
      const chain = {
        select: () => chain,
        insert: async () => ({ data: null, error: null }),
        update: () => chain,
        eq: (column: string, value: unknown) => {
          if (column === "external_id") externalId = String(value);
          return chain;
        },
        maybeSingle: async () => {
          if (!bancoDisponivel) {
            return { data: null, error: { code: "PGRST000", message: "fetch failed" } };
          }
          if (table === "webhook_sources") return { data: source, error: null };
          if (table === "crm_leads") {
            return { data: leads.get(`${ORG}:${externalId}`) ?? null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: { data: null; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: null, error: null })),
      };
      return chain;
    },
  }),
}));

vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: (
    admin: unknown,
    context: { organization_id: string },
    input: { external_id?: string },
  ) => criarLead(admin, context, input),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/webhooks/captacao", () => ({
  origemDaPagina: () => ({}),
  registrarCaptacao: vi.fn(),
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ kickLocalPipeline: vi.fn() }));

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, count: 1, limit: 60, window_sec: 60 }),
}));

vi.mock("@/lib/webhooks/lead-reserve", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    cacheDeFontesEstaCompleto: async () => true,
    lerFonteWebhookDoCache: async () =>
      cachedSourceAvailable
        ? { ...source, secret_encrypted: cachedSourceSecret ? "encrypted" : null, source_secret: cachedSourceSecret }
        : null,
    guardarFonteWebhookEmCache: vi.fn(async () => undefined),
    enfileirarWebhook: (...args: unknown[]) => enfileirar(...args),
  };
});

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`https://crm.example.com/api/v1/webhooks/in/${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("reserva de lead quando o banco está indisponível", () => {
  beforeEach(() => {
    cachedSourceAvailable = true;
    cachedSourceSecret = null;
    bancoDisponivel = false;
    leads.clear();
    criarLead.mockClear();
    enfileirar.mockReset();
    enfileirar.mockImplementation(async (item) => ({ status: "enfileirado", count: 1, item }));
  });

  it("responde 202 e guarda o item na organização resolvida pelo token", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ nome: "Ana", telefone: "11999999999" }), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ data: { accepted: true, queued: true } });
    expect(enfileirar).toHaveBeenCalledTimes(1);
    expect(enfileirar.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG,
      sourceId: SOURCE,
      token: TOKEN,
    });
  });

  it("recusa corpo sem campo mapeável e não o transforma em lixo na reserva", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ campo_desconhecido: "valor" }), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(400);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("recusa assinatura inválida durante a queda e não enfileira", async () => {
    cachedSourceSecret = "segredo-da-fonte";
    const { POST } = await import("./route");
    const response = await POST(request({ nome: "Ana" }), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(401);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("cache completo mantém token desconhecido como 404 durante a queda", async () => {
    cachedSourceAvailable = false;
    const { POST } = await import("./route");
    const response = await POST(request({ nome: "Ana" }), {
      params: Promise.resolve({ token: "token-que-nao-existe" }),
    });

    expect(response.status).toBe(404);
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it("quando o teto acabou, responde 503 e não mente que aceitou", async () => {
    enfileirar.mockResolvedValueOnce({ status: "cheia", count: 3600 });
    const { POST } = await import("./route");
    const response = await POST(request({ nome: "Ana" }), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "service_unavailable", message: "webhook_reserve_full" },
    });
  });

  it("ao voltar, reprocessa pelo mesmo caminho e duas drenagens mantêm um lead no tenant certo", async () => {
    bancoDisponivel = true;
    const { processarWebhookReservado } = await import("./route");
    const reservado = {
      id: "55555555-5555-4555-8555-555555555555",
      token: TOKEN,
      organizationId: ORG,
      sourceId: SOURCE,
      receivedAt: "2026-09-30T14:42:00.000Z",
      rawBody: JSON.stringify({ nome: "Ana" }),
      contentType: "application/json",
      signature: null,
      origin: null,
      referer: null,
      userAgent: null,
      forwardedFor: null,
      externalId: "reserve:55555555-5555-4555-8555-555555555555",
    };

    expect(await processarWebhookReservado(reservado)).toBe(true);
    expect(await processarWebhookReservado(reservado)).toBe(true);

    expect(criarLead).toHaveBeenCalledTimes(1);
    expect(criarLead.mock.calls[0]?.[1]).toMatchObject({ organization_id: ORG });
    expect(criarLead.mock.calls[0]?.[2]).toMatchObject({ external_id: reservado.externalId });
    expect(leads).toHaveLength(1);
  });
});
