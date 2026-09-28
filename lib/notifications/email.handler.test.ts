import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/event-log/dispatcher";

const sendEmail = vi.hoisted(() => vi.fn());
const isEmailConfigured = vi.hoisted(() => vi.fn());
const marcaDaSaida = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/resend", () => ({ sendEmail, isEmailConfigured }));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida,
  NEUTROS_DE_SAIDA: { fundo: "#ffffff", texto: "#111111", suave: "#666666" },
}));
vi.mock("@/lib/audit", () => ({ audit }));
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
      update: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      is: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => response),
      then: (resolve: (value: DbResponse) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(response).then(resolve, reject),
    };
    return builder;
  });
  return {
    from,
    rpc: vi.fn(async () => ({ data: [{ batch_id: "batch-1" }], error: null })),
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

  it("não enfileira lead novo sem opt-in do responsável", async () => {
    const admin = adminCom(
      {
        crm_leads: [
          {
            data: { id: "lead-1", owner_user_id: "owner-1", status: "open", title: "Jatobá" },
            error: null,
          },
        ],
        user_organizations: [{ data: { user_id: "owner-1" }, error: null }],
        notification_email_preferences: [{ data: [], error: null }],
        platform_admins: [{ data: [], error: null }],
      },
      { "owner-1": "owner@example.com" },
    );

    const result = await handleLeadEmailEvent(evento(), admin);

    expect(result).toMatchObject({
      status: "skipped",
      detail: "sem destinatário com email ligado",
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("não inscreve administrador da plataforma por padrão, só após opt-in na organização", async () => {
    const base = () => ({
      crm_leads: [
        {
          data: { id: "lead-1", owner_user_id: null, status: "open", title: "Jatobá" },
          error: null,
        },
      ],
      user_organizations: [{ data: [{ user_id: "platform-1" }], error: null }],
    });
    const defaultOff = adminCom(
      {
        ...base(),
        notification_email_preferences: [{ data: [], error: null }],
        platform_admins: [{ data: [{ user_id: "platform-1" }], error: null }],
      },
      {},
    );

    const skipped = await handleLeadEmailEvent(evento(), defaultOff);

    expect(skipped).toMatchObject({
      status: "skipped",
      detail: "sem destinatário com email ligado",
    });
    expect(defaultOff.rpc).not.toHaveBeenCalled();

    const optedIn = adminCom(
      {
        ...base(),
        notification_email_preferences: [
          {
            data: [{ user_id: "platform-1", new_lead: true, urgent_lead: true }],
            error: null,
          },
        ],
      },
      {},
    );

    const queued = await handleLeadEmailEvent(evento(), optedIn);

    expect(queued.status).toBe("ok");
    expect(optedIn.rpc).toHaveBeenCalledOnce();
  });

  it("sem responsável usa administradores, respeita opt-out e enfileira a urgência", async () => {
    const admin = adminCom(
      {
        crm_leads: [
          {
            data: { id: "lead-1", owner_user_id: null, status: "open", title: "Jatobá" },
            error: null,
          },
        ],
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
    expect(admin.rpc).toHaveBeenCalledOnce();
    expect(admin.rpc).toHaveBeenCalledWith("fn_queue_lead_email_batch", {
      p_event_id: "event-1",
      p_recipient_user_id: "admin-2",
      p_window_seconds: 30,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    { eventType: "lead.created", kind: "new_lead" },
    { eventType: "lead.action_required", kind: "urgent_lead" },
  ] as const)(
    "não enfileira $kind quando o mestre de e-mail da pessoa está desligado",
    async ({ eventType }) => {
      const admin = adminCom(
        {
          crm_leads: [
            {
              data: {
                id: "lead-1",
                owner_user_id: "owner-1",
                status: "open",
                title: "Jatobá",
              },
              error: null,
            },
          ],
          user_organizations: [{ data: { user_id: "owner-1" }, error: null }],
          notification_email_preferences: [
            {
              data: [
                {
                  user_id: "owner-1",
                  email_enabled: false,
                  new_lead: true,
                  urgent_lead: true,
                },
              ],
              error: null,
            },
          ],
        },
        { "owner-1": "owner@example.com" },
      );

      const result = await handleLeadEmailEvent(evento({ event_type: eventType }), admin);

      expect(result).toMatchObject({
        status: "skipped",
        detail: "sem destinatário com email ligado",
      });
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    },
  );

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

  it("entrega uma rajada como um resumo e não reenvia um lote já concluído", async () => {
    const due = new Date(Date.now() - 1_000).toISOString();
    const items = Array.from({ length: 21 }, (_, index) => ({
      lead_id: `lead-${index + 1}`,
      lead_title: `Lead ${index + 1}`,
      created_at: new Date(Date.now() + index).toISOString(),
    }));
    const admin = adminCom(
      {
        notification_email_batches: [
          {
            data: {
              id: "batch-1",
              recipient_user_id: "owner-1",
              kind: "new_lead",
              status: "pending",
              due_at: due,
              updated_at: due,
              deferred_count: 0,
            },
            error: null,
          },
          {
            data: {
              id: "batch-1",
              recipient_user_id: "owner-1",
              kind: "new_lead",
              status: "processing",
              due_at: due,
              updated_at: new Date().toISOString(),
              deferred_count: 0,
            },
            error: null,
          },
          { data: null, error: null },
        ],
        notification_email_batch_items: [{ data: items, error: null }],
        organizations: [
          {
            data: { display_name: "Bendito Ponto", legal_name: "Bendito Ponto Ltda" },
            error: null,
          },
        ],
      },
      { "owner-1": "owner@example.com" },
    );

    const result = await handleLeadEmailEvent(
      evento({ event_type: "notification.email_batch_due", entity_id: "batch-1" }),
      admin,
    );

    expect(result.status).toBe("ok");
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: "21 leads novos na Bendito Ponto | Marca do cliente",
        idempotencyKey: "lead-email-batch:batch-1:owner-1",
      }),
    );

    const alreadySent = adminCom(
      {
        notification_email_batches: [
          {
            data: {
              id: "batch-1",
              recipient_user_id: "owner-1",
              kind: "new_lead",
              status: "sent",
              due_at: due,
              updated_at: due,
              deferred_count: 0,
            },
            error: null,
          },
        ],
      },
      { "owner-1": "owner@example.com" },
    );
    const retry = await handleLeadEmailEvent(
      evento({ event_type: "notification.email_batch_due", entity_id: "batch-1" }),
      alreadySent,
    );

    expect(retry).toMatchObject({ status: "skipped", detail: "lote já enviado" });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("entrega 20 ações urgentes em um único resumo com etapa, motivo e idade", async () => {
    const due = new Date(Date.now() - 1_000).toISOString();
    const items = Array.from({ length: 20 }, (_, index) => ({
      lead_id: `lead-${index + 1}`,
      lead_title: `Lead ${index + 1}`,
      created_at: new Date(Date.now() - 90 * 60_000).toISOString(),
      urgency_reason: index === 0 ? "task_overdue" : "risk",
      stage_name: "Negociação",
      action_required_at: new Date(Date.now() - 90 * 60_000).toISOString(),
    }));
    const admin = adminCom(
      {
        notification_email_batches: [
          {
            data: {
              id: "batch-urgent",
              recipient_user_id: "owner-1",
              kind: "urgent_lead",
              status: "pending",
              due_at: due,
              updated_at: due,
              deferred_count: 3,
            },
            error: null,
          },
          {
            data: {
              id: "batch-urgent",
              recipient_user_id: "owner-1",
              kind: "urgent_lead",
              status: "processing",
              due_at: due,
              updated_at: new Date().toISOString(),
              deferred_count: 3,
            },
            error: null,
          },
          { data: null, error: null },
        ],
        notification_email_batch_items: [{ data: items, error: null }],
        organizations: [
          {
            data: { display_name: "Bendito Ponto", legal_name: "Bendito Ponto Ltda" },
            error: null,
          },
        ],
      },
      { "owner-1": "owner@example.com" },
    );

    const result = await handleLeadEmailEvent(
      evento({ event_type: "notification.email_batch_due", entity_id: "batch-urgent" }),
      admin,
    );

    expect(result.status).toBe("ok");
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "20 leads pedindo ação na Bendito Ponto | Marca do cliente",
        html: expect.stringContaining("Negociação"),
        text: expect.stringMatching(/tarefa vencida.*há 1 h/s),
        idempotencyKey: "lead-email-batch:batch-urgent:owner-1",
      }),
    );
    expect(sendEmail.mock.calls[0]?.[0].text).toContain("3 leads adiados pelo teto diário");
  });

  it("cota do provedor suprime o lote, audita e não entra em retry", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, error: "rate_limited", details: "quota" });
    const due = new Date(Date.now() - 1_000).toISOString();
    const admin = adminCom(
      {
        notification_email_batches: [
          {
            data: {
              id: "batch-urgent",
              recipient_user_id: "owner-1",
              kind: "urgent_lead",
              status: "pending",
              due_at: due,
              updated_at: due,
              deferred_count: 0,
            },
            error: null,
          },
          {
            data: {
              id: "batch-urgent",
              recipient_user_id: "owner-1",
              kind: "urgent_lead",
              status: "processing",
              due_at: due,
              updated_at: new Date().toISOString(),
              deferred_count: 0,
            },
            error: null,
          },
          { data: null, error: null },
        ],
        notification_email_batch_items: [
          {
            data: [
              {
                lead_id: "lead-1",
                lead_title: "Lead 1",
                created_at: due,
                urgency_reason: "risk",
                stage_name: "Contato",
                action_required_at: due,
              },
            ],
            error: null,
          },
        ],
        organizations: [{ data: { display_name: "Bendito Ponto", legal_name: null }, error: null }],
      },
      { "owner-1": "owner@example.com" },
    );

    const result = await handleLeadEmailEvent(
      evento({ event_type: "notification.email_batch_due", entity_id: "batch-urgent" }),
      admin,
    );

    expect(result).toMatchObject({
      status: "ok",
      detail: "lote suprimido após limite do provedor",
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "notification.email_quota_exceeded",
        organizationId: "org-1",
        resourceId: "batch-urgent",
      }),
    );
  });

  it("um segundo worker não envia enquanto o primeiro mantém o lease do lote", async () => {
    const now = new Date().toISOString();
    const admin = adminCom(
      {
        notification_email_batches: [
          {
            data: {
              id: "batch-1",
              recipient_user_id: "owner-1",
              kind: "new_lead",
              status: "processing",
              due_at: now,
              updated_at: now,
              deferred_count: 0,
            },
            error: null,
          },
        ],
      },
      { "owner-1": "owner@example.com" },
    );

    const result = await handleLeadEmailEvent(
      evento({ event_type: "notification.email_batch_due", entity_id: "batch-1" }),
      admin,
    );

    expect(result).toMatchObject({
      status: "retry",
      detail: "outro worker está enviando o lote",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("não envia um lote já enfileirado se o mestre for desligado antes do envio", async () => {
    const due = new Date(Date.now() - 1_000).toISOString();
    const batch = {
      id: "batch-1",
      recipient_user_id: "owner-1",
      kind: "new_lead",
      status: "pending",
      due_at: due,
      updated_at: due,
      deferred_count: 0,
    };
    const admin = adminCom(
      {
        notification_email_batches: [
          { data: batch, error: null },
          { data: { ...batch, status: "processing" }, error: null },
          { data: null, error: null },
        ],
        notification_email_batch_items: [
          {
            data: [
              {
                lead_id: "lead-1",
                lead_title: "Lead 1",
                created_at: due,
                urgency_reason: null,
                stage_name: null,
                action_required_at: null,
              },
            ],
            error: null,
          },
        ],
        notification_email_preferences: [
          { data: { email_enabled: false }, error: null },
        ],
      },
      { "owner-1": "owner@example.com" },
    );

    const result = await handleLeadEmailEvent(
      evento({ event_type: "notification.email_batch_due", entity_id: "batch-1" }),
      admin,
    );

    expect(result).toMatchObject({
      status: "skipped",
      detail: "lote suprimido porque o email da pessoa está desligado",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
