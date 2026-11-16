import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMessagesHandler } from "@/app/api/v1/messages/_handler";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/app/api/v1/messages/_handler", () => ({ listMessagesHandler: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn(), resolveActiveOrg: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user" } }, error: null })) },
  } as never);
  vi.mocked(loadAuthUser).mockResolvedValue({ id: "user", idioma: "pt-BR" } as never);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: "org" } as never);
  vi.mocked(listMessagesHandler).mockResolvedValue({ messages: [], cursor: null, has_more: false });
});

describe("GET /conversations/:id/messages", () => {
  it("aceita carregar uma janela ao redor do message_id", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(
      `http://localhost/api/v1/conversations/${CONVERSATION}/messages?around_message_id=${MESSAGE}&limit=50`,
    );
    const response = await GET(request, { params: Promise.resolve({ id: CONVERSATION }) });

    expect(response.status).toBe(200);
    expect(listMessagesHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: "org" }),
      CONVERSATION,
      expect.objectContaining({ around_message_id: MESSAGE, limit: 50 }),
    );
  });

  it("recusa message_id inválido antes do handler", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(
      `http://localhost/api/v1/conversations/${CONVERSATION}/messages?around_message_id=invalido`,
    );
    const response = await GET(request, { params: Promise.resolve({ id: CONVERSATION }) });
    expect(response.status).toBe(422);
    expect(listMessagesHandler).not.toHaveBeenCalled();
  });
});

