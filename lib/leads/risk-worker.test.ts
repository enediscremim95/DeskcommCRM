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
  logger: { error: dependencias.logError, info() {}, warn() {} },
}));

import { observaTravessias } from "@/lib/leads/risk-worker";

describe("observador de risco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencias.emitLeadActivity.mockResolvedValue({ ok: true });
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
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          range: () => q,
          upsert,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return q;
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

  function adminDoEpisodio(opts: {
    estados: Array<{ lead_id: string; bucket: string }>;
    atividades: Array<{ id?: string; lead_id: string; type: string; performed_at: string }>;
    tetoSemRange?: number;
    leitura?: { falha: boolean };
  }) {
    const inseridos: Array<{ type: string; lead_id: string }> = [];
    const upsert = vi.fn(async (row: { lead_id: string; bucket: string }) => {
      const indice = opts.estados.findIndex((linha) => linha.lead_id === row.lead_id);
      const gravado = { lead_id: row.lead_id, bucket: row.bucket };
      if (indice >= 0) opts.estados[indice] = gravado;
      else opts.estados.push(gravado);
      return { error: null };
    });
    const from = vi.fn((table: string) => {
      if (table === "crm_lead_risk_states") {
        let faixa: { de: number; ate: number } | null = null;
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          range: (de: number, ate: number) => {
            faixa = { de, ate };
            return q;
          },
          upsert,
          then: (resolve: (value: unknown) => unknown) => {
            const ordenados = [...opts.estados].sort((a, b) => a.lead_id.localeCompare(b.lead_id));
            const pagina = faixa
              ? ordenados.slice(faixa.de, faixa.ate + 1)
              : ordenados.slice(0, opts.tetoSemRange ?? ordenados.length);
            return Promise.resolve({ data: pagina, error: null }).then(resolve);
          },
        };
        return q;
      }
      if (table === "crm_lead_activities") {
        const filtros: Record<string, string> = {};
        let tipos: string[] | null = null;
        let depoisDe: string | null = null;
        let depoisDoId: string | null = null;
        const q = {
          select: () => q,
          eq: (coluna: string, valor: string) => {
            filtros[coluna] = valor;
            return q;
          },
          in: (_coluna: string, valores: string[]) => {
            tipos = valores;
            return q;
          },
          gt: (coluna: string, valor: string) => {
            if (coluna === "id") depoisDoId = valor;
            else depoisDe = valor;
            return q;
          },
          order: () => q,
          limit: () => q,
          maybeSingle: async () => {
            if (opts.leitura?.falha) {
              return { data: null, error: { message: "leitura do episódio falhou" } };
            }
            const linhas = opts.atividades
              .filter((linha) => {
                if (filtros.lead_id && linha.lead_id !== filtros.lead_id) return false;
                if (filtros.type && linha.type !== filtros.type) return false;
                if (filtros.performed_at && linha.performed_at !== filtros.performed_at) return false;
                if (tipos && !tipos.includes(linha.type)) return false;
                if (depoisDe && linha.performed_at <= depoisDe) return false;
                if (depoisDoId && (linha.id ?? "") <= depoisDoId) return false;
                return true;
              })
              .sort((a, b) => {
                const porTempo = b.performed_at.localeCompare(a.performed_at);
                if (porTempo !== 0) return porTempo;
                return (b.id ?? "").localeCompare(a.id ?? "");
              });
            return { data: linhas[0] ?? null, error: null };
          },
          insert: (row: { type: string; lead_id: string }) => {
            inseridos.push({ type: row.type, lead_id: row.lead_id });
            opts.atividades.push({
              lead_id: row.lead_id,
              type: row.type,
              performed_at: "2026-10-14T12:00:00.000Z",
            });
            return Promise.resolve({ error: null });
          },
        };
        return q;
      }
      throw new Error(`tabela inesperada: ${table}`);
    });
    return { from, upsert, inseridos };
  }

  function bucket(
    leadId: string,
    nome: "em_dia" | "em_voo" | "em_risco" | "critico",
  ) {
    return {
      leadId,
      contactId: null,
      bucket: nome,
      since: new Date("2026-10-10T12:00:00.000Z"),
      coldHours: 24,
    };
  }

  it("não grava outro esfriamento enquanto o negócio segue parado", async () => {
    const admin = adminDoEpisodio({
      estados: [{ lead_id: "lead-frio", bucket: "em_risco" }],
      atividades: [
        {
          lead_id: "lead-frio",
          type: "lead_cooled",
          performed_at: "2026-10-01T12:00:00.000Z",
        },
      ],
    });
    dependencias.calculaBucketsAtuais.mockResolvedValue([bucket("lead-frio", "critico")]);

    const resultado = await observaTravessias(admin as never, "org", new Date("2026-10-14T12:00:00.000Z"));

    expect(admin.inseridos).toEqual([]);
    expect(resultado.esfriaram).toBe(0);
    expect(resultado.esfriamentosJaRegistrados).toBe(0);
    expect(admin.upsert).toHaveBeenCalledTimes(1);
  });

  it("não grava de novo quando o estado gravado ficou fora da primeira página", async () => {
    const estados = Array.from({ length: 1001 }, (_, index) => ({
      lead_id: `lead-${String(index).padStart(4, "0")}`,
      bucket: "critico",
    }));
    const admin = adminDoEpisodio({
      estados,
      atividades: [],
      tetoSemRange: 1000,
    });
    dependencias.calculaBucketsAtuais.mockResolvedValue([bucket("lead-1000", "critico")]);

    const resultado = await observaTravessias(admin as never, "org", new Date("2026-10-14T12:00:00.000Z"));

    expect(admin.inseridos).toEqual([]);
    expect(resultado.travessias).toBe(0);
    expect(resultado.esfriaram).toBe(0);
  });

  it("grava um esfriamento novo depois que o negócio voltou a andar", async () => {
    const admin = adminDoEpisodio({
      estados: [{ lead_id: "lead-frio", bucket: "em_dia" }],
      atividades: [
        {
          lead_id: "lead-frio",
          type: "lead_cooled",
          performed_at: "2026-09-01T12:00:00.000Z",
        },
        {
          lead_id: "lead-frio",
          type: "note",
          performed_at: "2026-10-01T12:00:00.000Z",
        },
        {
          lead_id: "lead-frio",
          type: "lead_reactivated",
          performed_at: "2026-10-01T12:05:00.000Z",
        },
      ],
    });
    dependencias.calculaBucketsAtuais.mockResolvedValue([bucket("lead-frio", "em_risco")]);
    dependencias.emitLeadActivity.mockImplementation(
      async (_cliente: unknown, input: { type: string; leadId: string }) => {
        admin.inseridos.push({ type: input.type, lead_id: input.leadId });
        return { ok: true };
      },
    );

    const primeira = await observaTravessias(
      admin as never,
      "org",
      new Date("2026-10-14T12:00:00.000Z"),
    );
    dependencias.calculaBucketsAtuais.mockResolvedValue([bucket("lead-frio", "critico")]);
    const segunda = await observaTravessias(
      admin as never,
      "org",
      new Date("2026-10-14T18:00:00.000Z"),
    );

    expect(primeira.esfriaram).toBe(1);
    expect(admin.inseridos.map((linha) => linha.type)).toEqual(["lead_cooled"]);
    expect(segunda.esfriaram).toBe(0);
    expect(segunda.travessias).toBe(1);
    expect(admin.inseridos).toHaveLength(1);
  });

  it("segura o esfriamento quando o estado sumiu mas a timeline já tem o episódio", async () => {
    const admin = adminDoEpisodio({
      estados: [],
      atividades: [
        {
          lead_id: "lead-frio",
          type: "lead_cooled",
          performed_at: "2026-10-01T12:00:00.000Z",
        },
      ],
    });
    dependencias.calculaBucketsAtuais.mockResolvedValue([bucket("lead-frio", "critico")]);

    const resultado = await observaTravessias(admin as never, "org", new Date("2026-10-14T12:00:00.000Z"));

    expect(admin.inseridos).toEqual([]);
    expect(resultado.esfriamentosJaRegistrados).toBe(1);
    expect(resultado.esfriaram).toBe(0);
    expect(admin.upsert).toHaveBeenCalledTimes(1);
  });

  it("não grava o estado quando a leitura do episódio falha, e tenta de novo", async () => {
    const leitura = { falha: true };
    const admin = adminDoEpisodio({
      estados: [],
      atividades: [],
      leitura,
    });
    dependencias.calculaBucketsAtuais.mockResolvedValue([bucket("lead-frio", "critico")]);
    dependencias.emitLeadActivity.mockImplementation(
      async (_cliente: unknown, input: { type: string; leadId: string }) => {
        admin.inseridos.push({ type: input.type, lead_id: input.leadId });
        return { ok: true };
      },
    );

    const primeira = await observaTravessias(
      admin as never,
      "org",
      new Date("2026-10-14T12:00:00.000Z"),
    );

    expect(primeira.falhasDeAtividade).toBe(1);
    expect(primeira.esfriaram).toBe(0);
    expect(primeira.travessias).toBe(0);
    expect(admin.upsert).not.toHaveBeenCalled();
    expect(dependencias.propoeReativacao).not.toHaveBeenCalled();
    expect(admin.inseridos).toEqual([]);

    leitura.falha = false;
    const segunda = await observaTravessias(
      admin as never,
      "org",
      new Date("2026-10-14T12:15:00.000Z"),
    );

    expect(segunda.esfriaram).toBe(1);
    expect(admin.inseridos.map((linha) => linha.type)).toEqual(["lead_cooled"]);
    expect(admin.upsert).toHaveBeenCalledTimes(1);
    expect(dependencias.propoeReativacao).toHaveBeenCalledTimes(1);
  });

  it("grava esfriamento novo ao sair de em voo mesmo sem atividade que encerre o episódio", async () => {
    const admin = adminDoEpisodio({
      estados: [{ lead_id: "lead-frio", bucket: "em_voo" }],
      atividades: [
        {
          lead_id: "lead-frio",
          type: "lead_cooled",
          performed_at: "2026-09-01T12:00:00.000Z",
        },
      ],
    });
    dependencias.calculaBucketsAtuais.mockResolvedValue([bucket("lead-frio", "em_risco")]);
    dependencias.emitLeadActivity.mockImplementation(
      async (_cliente: unknown, input: { type: string; leadId: string }) => {
        admin.inseridos.push({ type: input.type, lead_id: input.leadId });
        return { ok: true };
      },
    );

    const resultado = await observaTravessias(
      admin as never,
      "org",
      new Date("2026-10-14T12:00:00.000Z"),
    );

    expect(resultado.esfriaram).toBe(1);
    expect(admin.inseridos.map((linha) => linha.type)).toEqual(["lead_cooled"]);
    expect(resultado.esfriamentosJaRegistrados).toBe(0);
  });
});
