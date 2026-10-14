import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencias = vi.hoisted(() => ({
  calculaBucketsAtuais: vi.fn(),
  emitLeadActivity: vi.fn(),
  registraFalhaDeAtividade: vi.fn(),
  propoeReativacao: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/leads/risk-seed", () => ({
  calculaBucketsAtuais: dependencias.calculaBucketsAtuais,
}));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: dependencias.emitLeadActivity,
}));
vi.mock("@/lib/leads/activity-write-failure", () => ({
  registraFalhaDeAtividade: dependencias.registraFalhaDeAtividade,
}));
vi.mock("@/lib/leads/reactivation", () => ({
  propoeReativacao: dependencias.propoeReativacao,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: dependencias.logError },
}));

import { observaTravessias } from "@/lib/leads/risk-worker";

describe("observador de risco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencias.calculaBucketsAtuais.mockResolvedValue([
      {
        leadId: "lead-inconsistente",
        contactId: null,
        bucket: "em_voo",
        since: new Date("2026-10-14T13:00:00.000Z"),
        coldHours: 24,
      },
      {
        leadId: "lead-valido",
        contactId: null,
        bucket: "em_voo",
        since: new Date("2026-10-14T11:00:00.000Z"),
        coldHours: 24,
      },
    ]);
  });

  it("isola a falha de gravação por negócio e continua nos demais", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          message:
            'new row for relation "crm_lead_risk_states" violates check constraint "crm_lead_risk_states_since_no_passado"',
        },
      })
      .mockResolvedValueOnce({ error: null });
    const admin = {
      from: vi.fn((table: string) => {
        expect(table).toBe("crm_lead_risk_states");
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
          upsert,
        };
      }),
    };

    const resultado = await observaTravessias(
      admin as never,
      "org-imobiliaria-a",
      new Date("2026-10-14T12:00:00.000Z"),
    );

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(resultado.travessias).toBe(1);
    expect(dependencias.logError).toHaveBeenCalledWith(
      "[risk-worker] negócio falhou ao gravar estado",
      expect.objectContaining({
        organizationId: "org-imobiliaria-a",
        leadId: "lead-inconsistente",
        bucket: "em_voo",
      }),
    );
  });
});
