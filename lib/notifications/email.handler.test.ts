import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/event-log/dispatcher";

const sendEmail = vi.hoisted(() => vi.fn());
const isEmailConfigured = vi.hoisted(() => vi.fn());
const marcaDaSaida = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/resend", () => ({ sendEmail, isEmailConfigured }));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida,
  NEUTROS_DE_SAIDA: { fundo: "#ffffff", texto: "#111111", suave: "#666666" },
}));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://crm.example" },
}));

import { handleLeadEmailEvent } from "./email.handler";

interface DbResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

function adminCom(respostas: Record<string, DbResponse[]>, emails: Record<string, string>) {
  const from = vi.fn((table: string) => {
    const response = respostas[table]?.shift() ?? { data: null, error: null };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      in: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => response),
      then: (resolve: (value: DbResponse) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(response).then(resolve, reject),
    };
    return builder;
  });
  return {
    from,
    auth: {
      admin: {
        getUserById: vi.fn(async (userId: string) => ({
          data: { user: emails[userId] ? { email: emails[userId] } : null },
          error: null,
        })),
      },
    },
  } as unknown as SupabaseClient;
}

function evento(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "event-1",
    organization_id: "org-1",
    event_type: "lead.created",
    entity_kind: "crm_lead",
    entity_id: "lead-1",
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("handleLeadEmailEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEmailConfigured.mockReturnValue(true);
    marcaDaSaida.mockResolvedValue({
      nome: "Marca do cliente",
      logoUrl: null,
      accent: "#123456",
      accentFg: "#ffffff",
    });
    sendEmail.mockResolvedValue({ ok: true, id: "mail-1" });
  });

  it("envia lead novo somente ao responsável ativo, com idempotência por pessoa", async () => {
    const admin = adminCom(
      {
        crm_leads: [
          { data: { id: "lead-1", owner_user_id: "owner-1", status: "open" }, error: null },
        ],
        user_organizations: [{ data: { user_id: "owner-1" }, error: null }],
        notification_email_preferences: [{ data: [], error: null }],
      },
      { "owner-1": "owner@example.com" },
    );

    const result = await handleLeadEmailEvent(evento(), admin);

    expect(result.status).toBe("ok");
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        idempotencyKey: "event-1:owner-1",
        fromName: "Marca do cliente",
      }),
    );
  });

  it("sem responsável usa administradores e respeita o opt-out individual", async () => {
    const admin = adminCom(
      {
        crm_leads: [{ data: { id: "lead-1", owner_user_id: null, status: "open" }, error: null }],
        user_organizations: [
          { data: [{ user_id: "admin-1" }, { user_id: "admin-2" }], error: null },
        ],
        notification_email_preferences: [
          {
            data: [
              { user_id: "admin-1", new_lead: true, urgent_lead: false },
              { user_id: "admin-2", new_lead: true, urgent_lead: true },
            ],
            error: null,
          },
        ],
      },
      { "admin-1": "one@example.com", "admin-2": "two@example.com" },
    );

    const result = await handleLeadEmailEvent(
      evento({ event_type: "lead.action_required", payload: { reason: "risk" } }),
      admin,
    );

    expect(result.status).toBe("ok");
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "two@example.com" }));
  });

  it("não dispara uma avalanche ao encontrar lead antigo no backlog", async () => {
    const admin = adminCom({}, {});

    const result = await handleLeadEmailEvent(
      evento({ created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() }),
      admin,
    );

    expect(result).toMatchObject({
      status: "skipped",
      detail: "lead antigo não gera aviso retroativo",
    });
    expect(admin.from).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
