import { describe, expect, it } from "vitest";
import { boardDateRange, boardDatesToParams } from "./date-range";
import { applyFilters, filtersFromParams, filtersToParams } from "./filters";
import type { Lead } from "@/lib/types/leads";

describe("período do Kanban em São Paulo", () => {
  it("inclui o dia final inteiro e não mistura UTC com o dia local", () => {
    expect(boardDateRange({ dateFrom: "2026-11-16", dateUntil: "2026-11-16" })).toEqual({
      field: "created_at", from: "2026-11-16T03:00:00.000Z", before: "2026-11-17T03:00:00.000Z",
    });
  });
  it("respeita a mudança histórica do horário de verão", () => {
    expect(boardDateRange({ dateFrom: "2018-11-04", dateUntil: "2018-11-04" })).toMatchObject({
      from: "2018-11-04T03:00:00.000Z", before: "2018-11-05T02:00:00.000Z",
    });
  });
  it.each([{ dateFrom: "2026-02-30" }, { dateUntil: "inválida" }, { dateFrom: "2026-11-17", dateUntil: "2026-11-16" }])("recusa período inválido %j", (f) => {
    expect(() => boardDateRange(f)).toThrow("invalid_date_range");
  });
  it("permite períodos abertos e preserva o filtro no link", () => {
    const f = { dateField: "last_activity_at" as const, dateUntil: "2026-11-16" };
    expect(boardDateRange(f)).toEqual({ field: "last_activity_at", before: "2026-11-17T03:00:00.000Z" });
    expect(filtersFromParams(new URLSearchParams(filtersToParams(f)))).toMatchObject(f);
    expect(boardDatesToParams({})).toBe("");
  });
  it("usa a coluna escolhida, exclui atividade nula e guarda os limites", () => {
    const base = { status: "open", tags: [], title: "Teste", owner_user_id: null, owner_agent_id: null };
    const dates = ["2026-11-16T02:59:59.999Z", "2026-11-16T03:00:00.000Z", "2026-11-17T02:59:59.999Z", "2026-11-17T03:00:00.000Z", null];
    const leads = dates.map((last_activity_at, id) => ({ ...base, id: String(id), created_at: "2026-01-01T00:00:00Z", last_activity_at })) as unknown as Lead[];
    expect(applyFilters(leads, { dateField: "last_activity_at", dateFrom: "2026-11-16", dateUntil: "2026-11-16" }).map((l) => l.id)).toEqual(["1", "2"]);
  });
});
