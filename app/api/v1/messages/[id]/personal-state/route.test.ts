import type * as SupportTypes from "@/lib/impersonate/support";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { salvarEstadoPessoalDaMensagem } from "@/lib/inbox/preferencias-pessoais";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ cookie: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/inbox/preferencias-pessoais", () => ({
  lerEstadoPessoalDaMensagem: vi.fn(async () => ({ starred_at: null })),
  salvarEstadoPessoalDaMensagem: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof SupportTypes>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID, idioma: "pt-BR" },
    org: { orgId: ORG_ID },
  } as never);
  vi.mocked(salvarEstadoPessoalDaMensagem).mockResolvedValue({
    starred_at: "2026-11-07T10:00:00.000Z",
  });
});

describe("estado pessoal da mensagem", () => {
  it("usa organização e usuário da sessão, nunca os valores do body", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/v1/messages/${MESSAGE_ID}/personal-state`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starred: true, organization_id: "outra", user_id: "outro" }),
      }),
      { params: Promise.resolve({ id: MESSAGE_ID }) },
    );
    expect(response.status).toBe(200);
    expect(salvarEstadoPessoalDaMensagem).toHaveBeenCalledWith(
      expect.anything(), ORG_ID, USER_ID, MESSAGE_ID, true,
    );
  });
});
