import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { escapeMessageSearchTerm } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const MESSAGE_1 = "33333333-3333-4333-8333-333333333333";
const MESSAGE_2 = "44444444-4444-4444-8444-444444444444";
const MESSAGE_3 = "55555555-5555-4555-8555-555555555555";

type Operation = [string, string, unknown?];

function client(options: { conversation?: { id: string } | null; rows?: unknown[] } = {}) {
  const operations: Operation[] = [];
  const conversation = options.conversation === undefined ? { id: CONVERSATION } : options.conversation;
  const rows =
    options.rows ??
    [
      { id: MESSAGE_1, sent_at: "2026-11-06T12:00:00.000Z", body: "pedido azul", direction: "inbound", type: "text", sent_via: "user" },
      { id: MESSAGE_2, sent_at: "2026-11-06T11:00:00.000Z", body: "pedido verde", direction: "outbound", type: "text", sent_via: "user" },
      { id: MESSAGE_3, sent_at: "2026-11-06T10:00:00.000Z", body: "pedido antigo", direction: "inbound", type: "text", sent_via: "user" },
    ];

  return {
    operations,
    api: {
      from(table: string) {
        if (table === "conversations") {
          const chain: Record<string, unknown> = {
            eq(column: string, value: unknown) {
              operations.push(["conversation.eq", column, value]);
              return chain;
            },
            maybeSingle: async () => ({ data: conversation, error: null }),
          };
          return { select: () => chain };
        }

        const chain: Record<string, unknown> = {
          eq(column: string, value: unknown) {
            operations.push(["eq", column, value]);
            return chain;
          },
          is(column: string, value: unknown) {
            operations.push(["is", column, value]);
            return chain;
          },
          neq(column: string, value: unknown) {
            operations.push(["neq", column, value]);
            return chain;
          },
          not(column: string, operator: string, value: unknown) {
            operations.push(["not", column, `${operator}:${String(value)}`]);
            return chain;
          },
          ilike(column: string, value: unknown) {
            operations.push(["ilike", column, value]);
            return chain;
          },
          order(column: string, value: unknown) {
            operations.push(["order", column, value]);
            return chain;
          },
          limit(value: unknown) {
            operations.push(["limit", String(value)]);
            return chain;
          },
          in(column: string, value: unknown) {
            operations.push(["in", column, value]);
            return chain;
          },
          gte(column: string, value: unknown) {
            operations.push(["gte", column, value]);
            return chain;
          },
          lte(column: string, value: unknown) {
            operations.push(["lte", column, value]);
            return chain;
          },
          or(value: unknown) {
            operations.push(["or", String(value)]);
            return chain;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          },
        };
        return { select: () => chain };
      },
    },
  };
}

function request(query: string) {
  return new NextRequest(
    `http://localhost/api/v1/conversations/${CONVERSATION}/messages/search?${query}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user", idioma: "pt-BR" },
    org: { orgId: ORG },
  } as never);
});

describe("GET /conversations/:id/messages/search", () => {
  it("recusa conversa de outra organização com filtro explícito", async () => {
    const mock = client({ conversation: null });
    vi.mocked(createClient).mockResolvedValue(mock.api as never);
    const { GET } = await import("./route");
    const response = await GET(request("q=pedido"), {
      params: Promise.resolve({ id: CONVERSATION }),
    });

    expect(response.status).toBe(404);
    expect(mock.operations).toContainEqual(["conversation.eq", "organization_id", ORG]);
    expect(mock.operations.some(([operation]) => operation === "ilike")).toBe(false);
  });

  it("exclui apagadas e notas internas e pagina por cursor", async () => {
    const mock = client();
    vi.mocked(createClient).mockResolvedValue(mock.api as never);
    const { GET } = await import("./route");
    const first = await GET(request("q=pedido&limit=2"), {
      params: Promise.resolve({ id: CONVERSATION }),
    });
    const firstBody = await first.json();

    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.meta.has_more).toBe(true);
    expect(firstBody.meta.cursor).toEqual(expect.any(String));
    expect(mock.operations).toContainEqual(["is", "revoked_at", null]);
    expect(mock.operations).toContainEqual(["neq", "type", "internal_note"]);
    expect(mock.operations).toContainEqual(["not", "metadata->>internal_note", "eq:true"]);

    mock.operations.length = 0;
    await GET(request(`q=pedido&limit=2&cursor=${encodeURIComponent(firstBody.meta.cursor)}`), {
      params: Promise.resolve({ id: CONVERSATION }),
    });
    expect(mock.operations.some(([operation]) => operation === "or")).toBe(true);
  });

  it("recusa termo acima do limite antes de abrir o banco", async () => {
    const { GET } = await import("./route");
    const response = await GET(request(`q=${"x".repeat(201)}`), {
      params: Promise.resolve({ id: CONVERSATION }),
    });
    expect(response.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("escapa curingas de LIKE em vez de tratá-los como consulta", () => {
    expect(escapeMessageSearchTerm(String.raw`50%_\\fim`)).toBe(String.raw`50\%\_\\\\fim`);
  });
});

