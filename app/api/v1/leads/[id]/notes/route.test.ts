import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "11111111-1111-4111-8111-111111111112";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "33333333-3333-4333-8333-333333333333";
const NOTE_ID = "44444444-4444-4444-8444-444444444444";

function auth(role: "agent" | "manager" = "agent") {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {
      id: USER_ID,
      full_name: "Ana SDR",
      idioma: "pt-BR",
      is_platform_admin: false,
      support: null,
    },
    org: { orgId: ORG_ID, role },
  } as never);
}

function builder(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "insert", "delete", "order", "limit", "or", "in"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => result);
  query.maybeSingle = vi.fn(async () => result);
  return query;
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/leads/${LEAD_ID}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "req-note-create" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): NextRequest {
  return new NextRequest(`http://localhost/api/v1/leads/${LEAD_ID}/notes/${NOTE_ID}`, {
    method: "DELETE",
    headers: { "x-request-id": "req-note-delete" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth();
});

describe("POST /api/v1/leads/[id]/notes", () => {
  it("cria uma anotação no lead visível e registra audit", async () => {
    const leadQuery = builder({
      data: { id: LEAD_ID, organization_id: ORG_ID, contact_id: null },
      error: null,
    });
    const note = {
      id: NOTE_ID,
      organization_id: ORG_ID,
      lead_id: LEAD_ID,
      contact_id: null,
      source_module: "crm",
      source_id: null,
      type: "note",
      payload: { text: "Lead respondeu" },
      metadata: {},
      performed_at: "2026-10-15T15:30:00.000Z",
      performed_by_user_id: USER_ID,
      actor_kind: "user",
      actor_agent_id: null,
      reason: null,
      evidence: null,
    };
    const activityQuery = builder({ data: note, error: null });
    const from = vi.fn((table: string) => (table === "crm_leads" ? leadQuery : activityQuery));
    vi.mocked(createClient).mockResolvedValue({ from } as never);
    const { POST } = await import("./route");

    const response = await POST(postRequest({ text: "  Lead respondeu  " }), {
      params: Promise.resolve({ id: LEAD_ID }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("req-note-create");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: NOTE_ID,
        payload: { text: "Lead respondeu" },
        actor_user_name: "Ana SDR",
      },
    });
    expect(activityQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORG_ID,
        lead_id: LEAD_ID,
        type: "note",
        payload: { text: "Lead respondeu" },
        performed_by_user_id: USER_ID,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lead.note_created",
        resourceId: NOTE_ID,
        requestId: "req-note-create",
      }),
    );
  });

  it.each([
    ["vazio", { text: "   " }],
    ["maior que 2000", { text: "x".repeat(2001) }],
    ["com HTML", { text: "Lead <strong>respondeu</strong>" }],
  ])("rejeita texto %s", async (_case, body) => {
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn() } as never);
    const { POST } = await import("./route");

    const response = await POST(postRequest(body), {
      params: Promise.resolve({ id: LEAD_ID }),
    });

    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("não revela lead fora da organização e filtra a organização ativa", async () => {
    const leadQuery = builder({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => leadQuery) } as never);
    const { POST } = await import("./route");

    const response = await POST(postRequest({ text: "Tentativa cruzada" }), {
      params: Promise.resolve({ id: LEAD_ID }),
    });

    expect(response.status).toBe(404);
    expect(leadQuery.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
  });
});

describe("DELETE /api/v1/leads/[id]/notes/[noteId]", () => {
  function arrangeDelete(authorId: string, role: "agent" | "manager" = "agent") {
    auth(role);
    const leadQuery = builder({ data: { id: LEAD_ID }, error: null });
    const noteQuery = builder({
      data: { id: NOTE_ID, performed_by_user_id: authorId },
      error: null,
    });
    const deleteQuery = builder({ data: { id: NOTE_ID }, error: null });
    let activityCall = 0;
    const from = vi.fn((table: string) => {
      if (table === "crm_leads") return leadQuery;
      activityCall += 1;
      return activityCall === 1 ? noteQuery : deleteQuery;
    });
    vi.mocked(createClient).mockResolvedValue({ from } as never);
    return { leadQuery, noteQuery, deleteQuery };
  }

  it("apaga a anotação pelo próprio autor", async () => {
    const { deleteQuery } = arrangeDelete(USER_ID);
    const { DELETE } = await import("./[noteId]/route");

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: LEAD_ID, noteId: NOTE_ID }),
    });

    expect(response.status).toBe(204);
    expect(deleteQuery.delete).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "lead.note_deleted", resourceId: NOTE_ID }),
    );
  });

  it("apaga a anotação de outro autor quando o papel é gerente", async () => {
    const { deleteQuery } = arrangeDelete(OTHER_USER_ID, "manager");
    const { DELETE } = await import("./[noteId]/route");

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: LEAD_ID, noteId: NOTE_ID }),
    });

    expect(response.status).toBe(204);
    expect(deleteQuery.delete).toHaveBeenCalledTimes(1);
  });

  it("bloqueia outro atendente", async () => {
    const { deleteQuery } = arrangeDelete(OTHER_USER_ID);
    const { DELETE } = await import("./[noteId]/route");

    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: LEAD_ID, noteId: NOTE_ID }),
    });

    expect(response.status).toBe(403);
    expect(deleteQuery.delete).not.toHaveBeenCalled();
  });
});
