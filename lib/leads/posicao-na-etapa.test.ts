import { describe, expect, it, vi } from "vitest";

import { reservarPosicaoNaEtapa } from "./posicao-na-etapa";

const params = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  stageId: "22222222-2222-4222-8222-222222222222",
  lado: "topo" as const,
  requestId: "33333333-3333-4333-8333-333333333333",
};

describe("reservarPosicaoNaEtapa", () => {
  it("devolve a posição reservada pelo banco e envia o escopo completo", async () => {
    const rpc = vi.fn(async () => ({ data: -2000, error: null }));

    await expect(reservarPosicaoNaEtapa({ rpc } as never, params)).resolves.toBe(-2000);
    expect(rpc).toHaveBeenCalledWith("fn_reservar_posicao_lead_na_etapa", {
      p_organization_id: params.organizationId,
      p_stage_id: params.stageId,
      p_lado: "topo",
    });
  });

  it("falha fechado quando o banco não confirma uma posição numérica", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));

    await expect(reservarPosicaoNaEtapa({ rpc } as never, params)).rejects.toMatchObject({
      code: "internal_error",
      status: 500,
    });
  });
});
