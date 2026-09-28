import { beforeEach, describe, expect, it, vi } from "vitest";

import { aplicarModeloAtendimento } from "@/lib/operacao/regras-automaticas";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "22222222-2222-4222-8222-222222222222";
const FUNIL = "33333333-3333-4333-8333-333333333333";
const ETAPA_1 = "44444444-4444-4444-8444-444444444441";
const ETAPA_2 = "44444444-4444-4444-8444-444444444442";
const FOLLOWUP = "44444444-4444-4444-8444-444444444443";
const USER = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;

function bancoDoModelo() {
  const regras = new Map<string, Row>();
  const base: Record<string, Row[]> = {
    channel_sessions: [{ id: CANAL, organization_id: ORG, status: "WORKING", created_at: "2026-01-01" }],
    crm_pipelines: [{ id: FUNIL, organization_id: ORG, is_default: true, is_archived: false, position: 1 }],
    crm_stages: [
      { id: ETAPA_1, organization_id: ORG, pipeline_id: FUNIL, name: "Novo", position: 1, is_archived: false, is_won: false, is_lost: false },
      { id: ETAPA_2, organization_id: ORG, pipeline_id: FUNIL, name: "Qualificado", position: 2, is_archived: false, is_won: false, is_lost: false },
      { id: FOLLOWUP, organization_id: ORG, pipeline_id: FUNIL, name: "Follow-up", position: 3, is_archived: false, is_won: false, is_lost: false },
    ],
    user_organizations: [{ user_id: USER, organization_id: ORG, role: "manager", revoked_at: null, created_at: "2026-01-01" }],
  };

  const from = (table: string) => {
    const filtros: Array<[string, unknown]> = [];
    let ids: unknown[] | null = null;
    let limite: number | null = null;
    let ordenar: string | null = null;
    const linhas = () => {
      const fonte = table === "automation_rules" ? [...regras.values()] : (base[table] ?? []);
      let resultado = fonte.filter((row) =>
        filtros.every(([campo, valor]) => (valor === null ? row[campo] == null : row[campo] === valor)),
      );
      if (ids) resultado = resultado.filter((row) => ids!.includes(row.id));
      if (ordenar) resultado = [...resultado].sort((a, b) => Number(a[ordenar!] ?? 0) - Number(b[ordenar!] ?? 0));
      return limite === null ? resultado : resultado.slice(0, limite);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: (campo: string, valor: unknown) => { filtros.push([campo, valor]); return chain; },
      is: (campo: string, valor: unknown) => { filtros.push([campo, valor]); return chain; },
      in: (campo: string, valores: unknown[]) => { if (campo === "id") ids = valores; return chain; },
      order: (campo: string) => { ordenar = campo; return chain; },
      limit: (n: number) => { limite = n; return chain; },
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      upsert: async (values: Row[]) => {
        for (const value of values) {
          const id = String(value.id);
          if (!regras.has(id)) {
            regras.set(id, {
              run_count: 0,
              last_run_at: null,
              created_at: "2026-01-01",
              updated_at: "2026-01-01",
              ...value,
            });
          }
        }
        return { error: null };
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: linhas(), error: null }).then(resolve),
    };
    return chain;
  };

  return { supabase: { from }, regras, base };
}

describe("fluxo modelo de atendimento", () => {
  let fake: ReturnType<typeof bancoDoModelo>;
  let deps: DepsDaOperacao;

  beforeEach(() => {
    fake = bancoDoModelo();
    deps = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: fake.supabase as any,
      organizationId: ORG,
      actor: { type: "user", id: USER, role: "manager" },
      requestId: "req-modelo",
    };
  });

  it("aplicar duas vezes não duplica nem sobrescreve edição humana", async () => {
    const primeira = await aplicarModeloAtendimento(deps);
    expect(primeira.criadas).toBe(4);
    expect(primeira.preservadas).toBe(0);
    expect(fake.regras.size).toBe(4);
    expect([...fake.regras.values()].every((regra) => regra.is_active === false)).toBe(true);

    const idEditado = primeira.regras[0]!.id;
    fake.regras.get(idEditado)!.name = "Texto que o dono editou";

    const segunda = await aplicarModeloAtendimento(deps);
    expect(segunda.criadas).toBe(0);
    expect(segunda.preservadas).toBe(4);
    expect(fake.regras.size).toBe(4);
    expect(fake.regras.get(idEditado)!.name).toBe("Texto que o dono editou");
  });

  it("marca toda mensagem como exemplo e aponta o follow-up para a etapa correta", async () => {
    await aplicarModeloAtendimento(deps);
    const regras = [...fake.regras.values()];
    const mensagens = regras.flatMap((regra) =>
      (regra.actions as Array<{ type: string; config: { template?: string } }>).filter(
        (acao) => acao.type === "send_whatsapp_message",
      ),
    );
    expect(mensagens).toHaveLength(2);
    expect(mensagens.every((acao) => acao.config.template?.startsWith("EXEMPLO, REVISE"))).toBe(true);
    const followup = regras.find((regra) => String(regra.name).includes("follow-up"))!;
    expect(followup.conditions).toEqual([{ field: "event.to_stage_id", op: "eq", value: FOLLOWUP }]);
  });

  it("não usa uma etapa arbitrária quando o funil não tem follow-up", async () => {
    fake.base.crm_stages = fake.base.crm_stages!.filter((etapa) => etapa.id !== FOLLOWUP);

    await expect(aplicarModeloAtendimento(deps)).rejects.toThrow(
      "Crie ou renomeie uma etapa de follow-up antes de aplicar o modelo.",
    );
    expect(fake.regras.size).toBe(0);
  });
});
