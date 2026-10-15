import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as TimelineQueryTypes from "@/lib/leads/timeline-query";
import { loadAuthUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { TimelineItem } from "@/lib/types/contacts";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/leads/timeline-query", async (importOriginal) => {
  const actual = await importOriginal<typeof TimelineQueryTypes>();
  return {
    ...actual,
    comNomeDoAtor: vi.fn(async (_supabase, rows) =>
      rows.map((row: TimelineItem) => ({ ...row, actor_user_name: "Ana SDR" })),
    ),
  };
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "33333333-3333-4333-8333-333333333333";

function leadBuilder() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: { id: LEAD_ID, contact_id: null }, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function timelineBuilder(note: Record<string, unknown>) {
  const result = { data: [note], error: null, count: 1 };
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<typeof result>["then"];
  } = {};
  for (const method of ["select", "order", "limit", "or", "eq", "in"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAuthUser).mockResolvedValue({ idioma: "pt-BR" } as never);
});

describe("GET /api/v1/leads/[id]/timeline?type=note", () => {
  it("lê as anotações do lead em ordem decrescente e mantém o autor", async () => {
    const note = {
      id: "44444444-4444-4444-8444-444444444444",
      organization_id: "22222222-2222-4222-8222-222222222222",
      lead_id: LEAD_ID,
      contact_id: null,
      source_module: "crm",
      source_id: null,
      type: "note",
      payload: { text: "Está capitalizado" },
      metadata: {},
      performed_at: "2026-10-15T15:30:00.000Z",
      performed_by_user_id: USER_ID,
      actor_kind: "user",
      actor_agent_id: null,
      reason: null,
      evidence: null,
    };
    const leadQuery = leadBuilder();
    const activitiesQuery = timelineBuilder(note);
    const from = vi.fn((table: string) => (table === "crm_leads" ? leadQuery : activitiesQuery));
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
      from,
    } as never);
    const { GET } = await import("./route");

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/leads/${LEAD_ID}/timeline?type=note&limit=100`),
      { params: Promise.resolve({ id: LEAD_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: note.id,
          type: "note",
          payload: { text: "Está capitalizado" },
          actor_user_name: "Ana SDR",
        },
      ],
      meta: { total: 1, has_more: false },
    });
    expect(activitiesQuery.order).toHaveBeenNthCalledWith(1, "performed_at", {
      ascending: false,
    });
    expect(activitiesQuery.in).toHaveBeenCalledWith("type", ["note"]);
  });
});
