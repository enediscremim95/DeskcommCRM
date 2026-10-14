import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { fetchAllPages } from "./fetch-all-pages";

interface Row {
  id: string;
  occurred_on: string;
}

describe("fetchAllPages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lê 2.500 linhas sem perder nem duplicar, com ordem e desempate estáveis", async () => {
    const rows = Array.from({ length: 2_500 }, (_, index): Row => ({
      id: `id-${String(2_499 - index).padStart(4, "0")}`,
      occurred_on: `2026-10-${String((index % 3) + 1).padStart(2, "0")}`,
    }));
    const ordered = [...rows].sort(
      (left, right) =>
        left.occurred_on.localeCompare(right.occurred_on) || left.id.localeCompare(right.id),
    );
    const ranges: Array<[number, number]> = [];
    const log = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const result = await fetchAllPages<Row>(
      (from, to) => {
        ranges.push([from, to]);
        return Promise.resolve({ data: ordered.slice(from, to + 1), error: null });
      },
      { resource: "test.facts" },
    );

    expect(ranges).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_999],
    ]);
    expect(result).toEqual(ordered);
    expect(new Set(result.map((row) => row.id)).size).toBe(2_500);
    expect(log).toHaveBeenCalledWith("supabase.fetch_all_pages.completed", {
      resource: "test.facts",
      page_count: 3,
      row_count: 2_500,
    });
  });

  it("propaga o erro de uma página sem devolver o prefixo parcial", async () => {
    const sourceError = { message: "database unavailable" };
    const queryPage = vi.fn((from: number) =>
      Promise.resolve(
        from === 0
          ? { data: Array.from({ length: 1_000 }, (_, id) => ({ id })), error: null }
          : { data: null, error: sourceError },
      ),
    );

    await expect(
      fetchAllPages(queryPage, { resource: "test.facts" }),
    ).rejects.toMatchObject({
      name: "FetchAllPagesError",
      message: "fetch_all_pages_query_failed: test.facts; page=2",
      cause: sourceError,
    });
    expect(queryPage).toHaveBeenCalledTimes(2);
  });

  it("interrompe explicitamente ao atingir o teto de segurança", async () => {
    await expect(
      fetchAllPages(
        (from, to) =>
          Promise.resolve({
            data: Array.from({ length: to - from + 1 }, (_, index) => ({ id: from + index })),
            error: null,
          }),
        { resource: "test.facts", pageSize: 2, maxRows: 4 },
      ),
    ).rejects.toThrow("fetch_all_pages_row_limit_reached: test.facts; max_rows=4");
  });
});
