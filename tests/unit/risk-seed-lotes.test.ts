import { describe, expect, it, vi } from "vitest";

const agenda = vi.hoisted(() => ({
  protecaoAgendaSupabase: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/agenda/protecao-followup", () => agenda);

import { calculaBucketsAtuais } from "@/lib/leads/risk-seed";

describe("seed de risco em organizações grandes", () => {
  it("limita stages e cron_jobs a 100 ids e lança se um lote de cron_jobs falhar", async () => {
    const leads = Array.from({ length: 2_500 }, (_, index) => ({
      id: `lead-${index}`,
      stage_id: `stage-${index}`,
      contact_id: `contact-${index}`,
      last_activity_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
    }));
    const lotes: Array<{ tabela: string; coluna: string; ids: string[] }> = [];
    let loteCron = 0;
    const admin = {
      from: (tabela: string) => {
        let idsIn: string[] = [];
        const q = {
          select: () => q,
          eq: () => q,
          gt: () => q,
          in: (coluna: string, ids: string[]) => {
            idsIn = ids;
            lotes.push({ tabela, coluna, ids: [...ids] });
            return q;
          },
          then: (resolve: (value: unknown) => unknown) => {
            if (tabela === "crm_leads") {
              return Promise.resolve({ data: leads, error: null }).then(resolve);
            }
            if (tabela === "crm_stages") {
              return Promise.resolve({
                data: idsIn.map((id) => ({ id, expected_duration_hours: 24 })),
                error: null,
              }).then(resolve);
            }
            if (tabela === "cron_jobs") {
              loteCron += 1;
              return Promise.resolve(
                loteCron === 3
                  ? { data: null, error: { message: "cron_jobs indisponível" } }
                  : { data: [], error: null },
              ).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return q;
      },
    };

    await expect(
      calculaBucketsAtuais(admin as never, "org", new Date("2026-10-11T12:00:00.000Z")),
    ).rejects.toThrow("seed de risco (cron_jobs): cron_jobs indisponível");

    const filtrosGrandes = lotes.filter(
      (lote) =>
        (lote.tabela === "crm_stages" && lote.coluna === "id") ||
        (lote.tabela === "cron_jobs" && lote.coluna === "contact_id"),
    );
    expect(filtrosGrandes.length).toBeGreaterThan(3);
    expect(Math.max(...filtrosGrandes.map((lote) => lote.ids.length))).toBe(100);
    expect(agenda.protecaoAgendaSupabase).not.toHaveBeenCalled();
  });
});
