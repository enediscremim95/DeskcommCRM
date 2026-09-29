import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { PIPE, authOk, etapa, funilRow, makeDb } from "@/tests/helpers/stages-db-double";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/pipelines/entry-options", () => {
  it("exige gerente antes de ler os destinos", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden", "Sem permissão.", 403, {}),
    });
    const db = makeDb();
    const { GET } = await import("./route");

    expect((await GET()).status).toBe(403);
    expect(db.escritas).toEqual([]);
  });

  it("devolve só funis ativos e etapas onde um lead pode nascer", async () => {
    authOk();
    const funilPadrao = Object.assign(
      funilRow({ id: PIPE, name: "Pedidos", is_default: true, position: 1000 }),
      { vocabulary: { lead: "Pedido" } },
    );
    const funilAlternativo = Object.assign(
      funilRow({ id: "pipeline-b", name: "Atendimento", position: 2000 }),
      { vocabulary: { lead: "Cliente" } },
    );
    const funilArquivado = funilRow({
      id: "pipeline-arquivado",
      name: "Antigo",
      is_archived: true,
      position: 3000,
    });
    makeDb({
      pipelines: [funilAlternativo, funilArquivado, funilPadrao],
      stages: [
        etapa({ id: "pago", name: "Pago", position: 3000, is_won: true }),
        etapa({ id: "carrinho", name: "Carrinho abandonado", position: 1000 }),
        etapa({ id: "cancelado", name: "Cancelado", position: 4000, is_lost: true }),
        etapa({
          id: "oculta",
          name: "Oculta",
          position: 500,
          is_archived: true,
        }),
        etapa({ id: "aguardando", name: "Aguardando pagamento", position: 2000 }),
        etapa({
          id: "triagem",
          name: "Triagem",
          pipeline_id: "pipeline-b",
          position: 1000,
        }),
        etapa({
          id: "etapa-arquivada",
          name: "Etapa de funil arquivado",
          pipeline_id: "pipeline-arquivado",
          position: 1000,
        }),
      ],
    });
    const { GET } = await import("./route");
    const response = await GET();
    const body = (await response.json()) as {
      data: {
        pipelines: Array<{ id: string; stages: Array<{ id: string; name: string }> }>;
        default_pipeline_id: string | null;
        default_stage_id: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.pipelines.map((pipeline) => pipeline.id)).toEqual([PIPE, "pipeline-b"]);
    expect(body.data.pipelines[0]?.stages.map((stage) => stage.name)).toEqual([
      "Carrinho abandonado",
      "Aguardando pagamento",
    ]);
    expect(body.data.pipelines[1]?.stages.map((stage) => stage.name)).toEqual(["Triagem"]);
    expect(body.data.default_pipeline_id).toBe(PIPE);
    expect(body.data.default_stage_id).toBe("carrinho");
  });

  it("mantém o funil padrão visível quando ele não tem etapa de entrada", async () => {
    authOk();
    makeDb({
      pipelines: [funilRow({ id: PIPE, name: "Pedidos", is_default: true })],
      stages: [
        etapa({ id: "pago", name: "Pago", is_won: true }),
        etapa({ id: "cancelado", name: "Cancelado", is_lost: true }),
      ],
    });
    const { GET } = await import("./route");
    const response = await GET();
    const body = (await response.json()) as {
      data: {
        pipelines: Array<{ id: string; stages: unknown[] }>;
        default_pipeline_id: string | null;
        default_stage_id: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.pipelines).toEqual([expect.objectContaining({ id: PIPE, stages: [] })]);
    expect(body.data.default_pipeline_id).toBe(PIPE);
    expect(body.data.default_stage_id).toBeNull();
  });
});
