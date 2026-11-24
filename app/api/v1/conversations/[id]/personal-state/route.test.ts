import type * as SupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import {
  lerEstadoPessoalDaConversa,
  salvarEstadoPessoalDaConversa,
} from "@/lib/inbox/preferencias-pessoais";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ cookie: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/inbox/preferencias-pessoais", () => ({
  lerEstadoPessoalDaConversa: vi.fn(),
  salvarEstadoPessoalDaConversa: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof SupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";

const ctx = { params: Promise.resolve({ id: CONVERSATION_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID, idioma: "pt-BR" },
    org: { orgId: ORG_ID },
  } as never);
  vi.mocked(lerEstadoPessoalDaConversa).mockResolvedValue({
    favorited_at: null,
    pinned_at: null,
    muted_until: null,
    marked_unread_at: null,
  });
  vi.mocked(salvarEstadoPessoalDaConversa).mockResolvedValue({
    favorited_at: "2026-11-07T10:00:00.000Z",
    pinned_at: null,
    muted_until: null,
    marked_unread_at: null,
  });
});

describe("estado pessoal da conversa", () => {
  it("lê sempre com organização e usuário vindos da sessão", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(`http://localhost/api/v1/conversations/${CONVERSATION_ID}/personal-state?organization_id=${OUTRA_ORG}`),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(lerEstadoPessoalDaConversa).toHaveBeenCalledWith(
      expect.anything(), ORG_ID, USER_ID, CONVERSATION_ID,
    );
  });

  it("ignora organization_id e user_id do body e aplica o toggle idempotente", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/v1/conversations/${CONVERSATION_ID}/personal-state`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorited: true, organization_id: OUTRA_ORG, user_id: OUTRA_ORG }),
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(salvarEstadoPessoalDaConversa).toHaveBeenCalledWith(
      expect.anything(), ORG_ID, USER_ID, CONVERSATION_ID, { favorited: true },
    );
  });

  it("devolve conflito claro ao exceder cinco fixadas", async () => {
    vi.mocked(salvarEstadoPessoalDaConversa).mockRejectedValueOnce(new Error("inbox_pin_limit"));
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/v1/conversations/${CONVERSATION_ID}/personal-state`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      }),
      ctx,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "inbox_pin_limit_reached" } });
  });
});
