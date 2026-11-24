import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import { criarFakeSupabase } from "@/lib/tarefas/fake-supabase.test-helper";

import { moverEtapaDoFluxo } from "./mover-etapa";

const ETAPA_A = "11111111-1111-4111-8111-111111111111";
const ETAPA_B = "22222222-2222-4222-8222-222222222222";

function banco() {
  return criarFakeSupabase({
    crm_stages: [
      { id: ETAPA_A, organization_id: "org-A", pipeline_id: "funil-A" },
      { id: ETAPA_B, organization_id: "org-B", pipeline_id: "funil-B" },
    ],
    crm_leads: [
      { id: "lead-A", organization_id: "org-A", contact_id: "c-A", pipeline_id: "funil-A", status: "open" },
    ],
  });
}

const base = { organizationId: "org-A", contactId: "c-A", requestId: "followup:x", flowPointerId: "ptr" };

describe("moverEtapaDoFluxo", () => {
  it("sem destino: no-op, nem consulta o handler", async () => {
    const mover = vi.fn();
    expect(await moverEtapaDoFluxo(banco() as unknown as SupabaseClient, { ...base, stageId: null }, { mover })).toEqual({
      movido: false,
      motivo: "sem_destino",
    });
    expect(mover).not.toHaveBeenCalled();
  });

  it("etapa de outra organização é destino inválido (isolamento)", async () => {
    const mover = vi.fn();
    expect(
      await moverEtapaDoFluxo(banco() as unknown as SupabaseClient, { ...base, stageId: ETAPA_B }, { mover }),
    ).toEqual({ movido: false, motivo: "destino_invalido" });
    expect(mover).not.toHaveBeenCalled();
  });

  it("delega ao handler com ator automático (nunca 'user') — é ele que aplica a guarda do Kanban", async () => {
    const mover = vi.fn().mockResolvedValue({});
    const r = await moverEtapaDoFluxo(banco() as unknown as SupabaseClient, { ...base, stageId: ETAPA_A }, { mover });
    expect(r).toEqual({ movido: true, lead_id: "lead-A", to_stage_id: ETAPA_A });
    const [, ctx, leadId, input] = mover.mock.calls[0]!;
    expect(ctx).toMatchObject({ organization_id: "org-A", actor: { type: "webhook_source", id: "ptr" } });
    expect(leadId).toBe("lead-A");
    expect(input).toMatchObject({ to_stage_id: ETAPA_A });
  });

  it.each(["so_avanca", "etapa_final_so_humano", "ja_esta_la"])("recusa da guarda (%s) vira no-op com o motivo", async (reason) => {
    const mover = vi.fn().mockRejectedValue(new ApiError(403, "forbidden", { reason }, "req"));
    expect(
      await moverEtapaDoFluxo(banco() as unknown as SupabaseClient, { ...base, stageId: ETAPA_A }, { mover }),
    ).toEqual({ movido: false, motivo: reason, lead_id: "lead-A" });
  });

  it("contato sem negócio aberto no funil: no-op", async () => {
    const mover = vi.fn();
    expect(
      await moverEtapaDoFluxo(banco() as unknown as SupabaseClient, { ...base, contactId: "c-sem", stageId: ETAPA_A }, { mover }),
    ).toEqual({ movido: false, motivo: "sem_negocio" });
  });

  it("erro de infraestrutura sobe (o engine faz retry)", async () => {
    const mover = vi.fn().mockRejectedValue(new ApiError(500, "internal_error", undefined, "req"));
    await expect(
      moverEtapaDoFluxo(banco() as unknown as SupabaseClient, { ...base, stageId: ETAPA_A }, { mover }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
