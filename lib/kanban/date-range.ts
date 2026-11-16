import { primeiroInstanteDoDia } from "@/lib/agenda/google/tempo";

export const KANBAN_TIMEZONE = "America/Sao_Paulo";
export type BoardDateField = "created_at" | "last_activity_at";
export interface BoardDateFilter { dateField?: BoardDateField; dateFrom?: string; dateUntil?: string }
export interface BoardDateRange { field: BoardDateField; from?: string; before?: string }
export function validBoardDate(day: string): boolean {
  return day <= "9999-12-30" && /^\d{4}-\d{2}-\d{2}$/.test(day) && primeiroInstanteDoDia(day, KANBAN_TIMEZONE) !== null;
}
/** Até inclui o dia inteiro no fuso de São Paulo. O limite superior é exclusivo. */
export function boardDateRange(f: BoardDateFilter): BoardDateRange {
  if ((f.dateFrom && !validBoardDate(f.dateFrom)) || (f.dateUntil && !validBoardDate(f.dateUntil)) ||
      (f.dateFrom && f.dateUntil && f.dateFrom > f.dateUntil)) throw new Error("invalid_date_range");
  const range: BoardDateRange = { field: f.dateField ?? "created_at" };
  if (f.dateFrom) range.from = primeiroInstanteDoDia(f.dateFrom, KANBAN_TIMEZONE)!.toISOString();
  if (f.dateUntil) {
    const next = new Date(f.dateUntil + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    range.before = primeiroInstanteDoDia(next.toISOString().slice(0, 10), KANBAN_TIMEZONE)!.toISOString();
  }
  return range;
}
export function boardDatesToParams(f: BoardDateFilter): string {
  const p = new URLSearchParams();
  if (f.dateFrom || f.dateUntil) p.set("date_field", f.dateField ?? "created_at");
  if (f.dateFrom) p.set("date_from", f.dateFrom);
  if (f.dateUntil) p.set("date_until", f.dateUntil);
  return p.toString();
}
export function applyBoardDateRange<T extends { gte(column: string, value: string): T; lt(column: string, value: string): T }>(query: T, range: BoardDateRange): T {
  if (range.from) query = query.gte(range.field, range.from);
  if (range.before) query = query.lt(range.field, range.before);
  return query;
}
