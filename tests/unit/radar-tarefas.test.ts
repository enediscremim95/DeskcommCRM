import { describe, expect, it } from "vitest";

import { carregaRadarDeRisco } from "@/lib/leads/radar-de-risco";

const ORG = "aaaaaaaa-1111-4111-8111-111111111111";

interface Consulta {
  table: string;
  cols: string;
  filtros: Record<string, unknown>;
}

function clienteFalso(
  tarefas: Array<Record<string, unknown>>,
  leads: Array<Record<string, unknown>> = [],
) {
  const consultas: Consulta[] = [];
  const from = (table: string) => {
    const consulta: Consulta = { table, cols: "", filtros: {} };
    // O stub imita só o encadeamento usado pelo Radar e registra a tenancy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: (cols: string) => {
        consulta.cols = cols;
        return chain;
      },
      eq: (col: string, value: unknown) => {
        consulta.filtros[col] = value;
        return chain;
      },
      in: (col: string, value: unknown) => {
        consulta.filtros[col] = value;
        return chain;
      },
      not: (col: string, operator: string, value: unknown) => {
        consulta.filtros[`${col}_${operator}`] = value;
        return chain;
      },
      is: () => chain,
      gt: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown) => unknown) => {
        consultas.push({ ...consulta, filtros: { ...consulta.filtros } });
        const data = table === "crm_tasks" && consulta.cols.includes("contact_id")
          ? tarefas
          : table === "crm_leads" && consulta.cols.includes("last_activity_at")
            ? leads
            : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return chain;
  };
  return { client: { from } as never, consultas };
}

describe("tarefas no Radar", () => {
  it("inclui toda tarefa aberta com prazo, sem exigir lead ou contato, na ordem mais urgente", async () => {
    const { client, consultas } = clienteFalso([
      {
        id: "futura",
        title: "Enviar relatório",
        description: null,
        due_date: "2026-09-18T16:00:00.000Z",
        status: "pending",
        lead_id: null,
        contact_id: null,
      },
      {
        id: "vencida",
        title: "Conferir contrato",
        description: "Sem vínculo com CRM",
        due_date: "2026-09-18T10:00:00.000Z",
        status: "in_progress",
        lead_id: null,
        contact_id: null,
      },
      {
        id: "encerrada",
        title: "Não deve aparecer",
        description: null,
        due_date: "2026-09-18T09:00:00.000Z",
        status: "done",
        lead_id: null,
        contact_id: null,
      },
    ]);

    const radar = await carregaRadarDeRisco(client, {
      organizationId: ORG,
      includeTasks: true,
      now: new Date("2026-09-18T12:00:00.000Z"),
    });

    expect(radar.tasks?.map((t) => t.id)).toEqual(["vencida", "futura"]);
    expect(radar.tasks?.[0]).toMatchObject({
      status: "in_progress",
      lead_id: null,
      contact_id: null,
    });
    expect(radar.tasks?.[1]?.status).toBe("pending");

    const leitura = consultas.find(
      (c) => c.table === "crm_tasks" && c.cols.includes("contact_id"),
    );
    expect(leitura?.filtros).toMatchObject({
      organization_id: ORG,
      status: ["pending", "in_progress"],
      due_date_is: null,
    });
  });

  it("consulta as tarefas do pool de 500 leads em blocos que cabem no PostgREST", async () => {
    const leads = Array.from({ length: 500 }, (_, i) => ({
      id: `lead-${i}`,
      title: `Negócio ${i}`,
      contact_id: null,
      owner_user_id: null,
      owner_kind: null,
      owner_agent_id: null,
      stage_id: `stage-${i % 2}`,
      last_activity_at: "2026-09-01T00:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
      pipeline_id: "pipeline-1",
    }));
    const { client, consultas } = clienteFalso([], leads);

    await carregaRadarDeRisco(client, {
      organizationId: ORG,
      now: new Date("2026-09-25T12:00:00.000Z"),
    });

    const lotes = consultas
      .filter((c) => c.table === "crm_tasks" && Array.isArray(c.filtros.lead_id))
      .map((c) => c.filtros.lead_id as string[]);
    expect(lotes).toHaveLength(5);
    expect(lotes.every((ids) => ids.length === 100)).toBe(true);
    expect(new Set(lotes.flat()).size).toBe(500);
  });
});
