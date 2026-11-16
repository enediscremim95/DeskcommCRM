import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow } from "@/lib/event-log/dispatcher";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  email: vi.fn(),
  boundary: vi.fn(),
  validate: vi.fn(),
  agenda: vi.fn(),
}));
vi.mock("@/lib/automation/throttle", () => ({
  espacarEnvio: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/automation/janela-do-canal", () => ({
  adiarAteAJanelaAbrir: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: mocks.send }));
vi.mock("@/lib/atendimento/origem", () => ({ serviceForEvent: mocks.boundary }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: mocks.email }));
vi.mock("@/lib/channels", () => ({ CHANNEL_SESSION_REF_COLUMNS: "provider" }));
vi.mock("@/lib/channels/telefone-formulario", () => ({
  validarTelefoneFormulario: mocks.validate,
}));
vi.mock("@/lib/agenda/efeito", () => ({ assertAgendaEffectSupabase: mocks.agenda }));
import { processarFormulario } from "./handler";
const now = new Date("2026-11-16T14:00Z");
const channel = "ffffffff-0000-4000-8000-000000000001";
const event = (org: string) =>
  ({
    id: "event",
    organization_id: org,
    event_type: "lead.created",
    entity_kind: "crm_lead",
    entity_id: "lead",
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: "2026-11-16T13:30Z",
  }) satisfies EventRow;
function fixture(
  org: string,
  options: { enabled?: boolean; responded?: boolean; form?: boolean; channelOrg?: string } = {},
) {
  const tables: Record<string, Record<string, unknown>[]> = {
    organizations: [
      {
        id: org,
        timezone: "America/Sao_Paulo",
        settings: {
          form_proactivity: { enabled: options.enabled ?? true, channel_session_id: channel },
          form_proactivity_enabled_at: "2026-11-16T13:00Z",
        },
      },
    ],
    crm_leads: [
      {
        id: "lead",
        organization_id: org,
        contact_id: "contact",
        status: "open",
        created_at: "2026-11-16T13:30Z",
        source_metadata: options.form === false ? {} : { webhook_source_id: "form" },
      },
    ],
    contacts: [
      {
        id: "contact",
        organization_id: org,
        phone_number: "+5541999799652",
        email: "teste@example.test",
      },
    ],
    messages: options.responded
      ? [{ id: "inbound", organization_id: org, contact_id: "contact" }]
      : [],
    channel_sessions: [
      {
        id: channel,
        organization_id: options.channelOrg ?? org,
        status: "WORKING",
        provider: "fake",
      },
    ],
    form_proactivity_attempts: [],
  };
  const scopes: Array<[string, string, unknown]> = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let mode = "read";
    let patch: Record<string, unknown> = {};
    let single = false;
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        scopes.push([table, key, value]);
        return q;
      },
      or: () => q,
      limit: () => q,
      maybeSingle: () => {
        single = true;
        return q;
      },
      insert: (p: Record<string, unknown>) => {
        mode = "insert";
        patch = p;
        return q;
      },
      update: (p: Record<string, unknown>) => {
        mode = "update";
        patch = p;
        return q;
      },
      then: (resolve: (r: unknown) => unknown) => {
        if (mode === "insert") {
          if (tables[table]!.some((r) => r.lead_id === patch.lead_id && r.phase === patch.phase))
            return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve);
          tables[table]!.push({ ...patch, outcome: "started", created_at: now.toISOString() });
        }
        const rows = tables[table]!.filter((r) => filters.every(([k, v]) => r[k] === v));
        if (mode === "update") rows.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(
          resolve,
        );
      },
    };
    return q;
  };
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return { db: { from, rpc } as unknown as SupabaseClient, tables, scopes, rpc };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue({ status: "failed" });
  mocks.email.mockResolvedValue({ ok: true });
  mocks.validate.mockResolvedValue("+5541999799652");
  mocks.boundary.mockResolvedValue({ conversation_id: "conversation" });
  mocks.agenda.mockResolvedValue(undefined);
});
describe("handler real com transportes mockados", () => {
  it.each(["org-a", "org-b"])(
    "executa WhatsApp -> validado -> e-mail em %s sem envio real",
    async (org) => {
      const f = fixture(org);
      for (let i = 0; i < 3; i++) await processarFormulario(f.db, event(org), now);
      expect(mocks.send).toHaveBeenCalledTimes(2);
      expect(mocks.email).toHaveBeenCalledOnce();
      expect(f.tables.form_proactivity_attempts!.map((a) => a.outcome)).toEqual([
        "failed",
        "failed",
        "sent",
      ]);
      expect(
        f.scopes
          .filter(([t, k]) => t !== "organizations" && k === "organization_id")
          .every(([, , v]) => v === org),
      ).toBe(true);
    },
  );
  it("desligado não cria tentativa nem chama transporte", async () => {
    const f = fixture("a", { enabled: false });
    expect((await processarFormulario(f.db, event("a"), now)).status).toBe("skipped");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(f.tables.form_proactivity_attempts).toHaveLength(0);
  });
  it.each([{ responded: true }, { form: false }])(
    "resposta ou origem manual não envia %s",
    async (options) => {
      const f = fixture("a", options);
      await processarFormulario(f.db, event("a"), now);
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.email).not.toHaveBeenCalled();
    },
  );
  it("êxito WhatsApp encerra, replay não duplica", async () => {
    mocks.send.mockResolvedValue({ status: "sent" });
    const f = fixture("a");
    await processarFormulario(f.db, event("a"), now);
    await processarFormulario(f.db, event("a"), now);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("não usa canal de outra organização", async () => {
    const f = fixture("a", { channelOrg: "b" });
    await processarFormulario(f.db, event("a"), now);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("três falhas sinalizam tag de atenção", async () => {
    const f = fixture("a");
    mocks.email.mockResolvedValue({ ok: false, error: "not_configured" });
    for (let i = 0; i < 3; i++) await processarFormulario(f.db, event("a"), now);
    expect(f.rpc).toHaveBeenCalledWith(
      "fn_form_proactivity_attention",
      expect.objectContaining({ p_org: "a", p_lead: "lead" }),
    );
  });
  it("ligar não dispara backlog", async () => {
    const f = fixture("a");
    await processarFormulario(f.db, { ...event("a"), created_at: "2026-11-15T12:00Z" }, now);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
});
