import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const searchSchema = z
  .object({
    q: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(40).regex(/^[a-z_]+$/).optional(),
    author: z.enum(["client", "human", "ai"]).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "invalid_date_range",
    path: ["to"],
  });

interface SearchCursor {
  sent_at: string;
  id: string;
}

interface SearchRow {
  id: string;
  sent_at: string;
  body: string | null;
  direction: "inbound" | "outbound";
  type: string;
  sent_via: string;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export function escapeMessageSearchTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): SearchCursor | null {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SearchCursor;
    const parsed = z
      .object({ id: z.string().uuid(), sent_at: z.string().datetime({ offset: true }) })
      .safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function snippet(body: string, term: string): string {
  const normalizedBody = body.replace(/\s+/g, " ").trim();
  const index = normalizedBody.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  const start = Math.max(0, (index < 0 ? 0 : index) - 60);
  const end = Math.min(normalizedBody.length, (index < 0 ? 0 : index) + term.length + 90);
  return `${start > 0 ? "…" : ""}${normalizedBody.slice(start, end)}${end < normalizedBody.length ? "…" : ""}`;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "conversation_messages" });
  if (!authz.ok) return authz.response;
  const t = (text: string) => traduzir(text, authz.user.idioma);
  const { id: conversationId } = await ctx.params;
  const parsed = searchSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return fail("validation_failed", t("Busca inválida."), 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) {
    return fail("invalid_cursor", t("Cursor inválido."), 400, { requestId });
  }

  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (conversationError) {
    return fail("internal_error", t("Erro ao validar conversa."), 500, { requestId });
  }
  if (!conversation) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  let query = supabase
    .from("messages")
    .select("id, sent_at, body, direction, type, sent_via")
    .eq("conversation_id", conversationId)
    .eq("organization_id", authz.org.orgId)
    .is("revoked_at", null)
    .neq("type", "internal_note")
    .not("metadata->>internal_note", "eq", "true")
    .ilike("body", `%${escapeMessageSearchTerm(parsed.data.q)}%`)
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(parsed.data.limit + 1);

  if (parsed.data.type) query = query.eq("type", parsed.data.type);
  if (parsed.data.author === "client") query = query.eq("direction", "inbound");
  if (parsed.data.author === "ai") {
    query = query.eq("direction", "outbound").eq("sent_via", "ai");
  }
  if (parsed.data.author === "human") {
    query = query
      .eq("direction", "outbound")
      .in("sent_via", ["user", "crm", "external_device"]);
  }
  if (parsed.data.from) query = query.gte("sent_at", parsed.data.from);
  if (parsed.data.to) query = query.lte("sent_at", parsed.data.to);
  if (cursor) {
    query = query.or(
      `sent_at.lt.${cursor.sent_at},and(sent_at.eq.${cursor.sent_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return fail("internal_error", t("Erro ao buscar mensagens."), 500, { requestId });

  const rows = (data ?? []) as SearchRow[];
  const hasMore = rows.length > parsed.data.limit;
  const page = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  const last = page.at(-1);
  return ok(
    page.map((row) => ({
      message_id: row.id,
      sent_at: row.sent_at,
      snippet: snippet(row.body ?? "", parsed.data.q),
      direction: row.direction,
      type: row.type,
    })),
    {
      requestId,
      meta: {
        cursor: hasMore && last ? encodeCursor({ sent_at: last.sent_at, id: last.id }) : null,
        has_more: hasMore,
      },
    },
  );
}

