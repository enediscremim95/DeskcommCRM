import { describe, expect, it } from "vitest";

import { IN_FILTER_BATCH_SIZE, queryInBatches } from "@/lib/supabase/query-in-batches";

describe("queryInBatches", () => {
  it("divide mais de mil ids antes que o filtro vire uma URL recusada", async () => {
    const ids = Array.from({ length: 1_001 }, (_, index) => `id-${index}`);
    const batchSizes: number[] = [];

    const result = await queryInBatches(
      ids,
      async (batch) => {
        batchSizes.push(batch.length);
        if (batch.length > IN_FILTER_BATCH_SIZE) {
          return { data: null, error: { message: "Bad Request" } };
        }
        return { data: batch.map((id) => ({ id })), error: null };
      },
      10_000,
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1_001);
    expect(batchSizes).toEqual([200, 200, 200, 200, 200, 1]);
    expect(Math.max(...batchSizes)).toBe(IN_FILTER_BATCH_SIZE);
  });
});
