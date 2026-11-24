import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import { criarFakeSupabase } from "@/lib/tarefas/fake-supabase.test-helper";

import { moverEtapaDoFluxo } from "./mover-etapa";

const ETAPA_A = "11111111-1111-4111-8111-111111111111";
const ETAPA_B = "22222222-2222-4222-8222-222222222222";
const ETAPA_A2 = "33333333-3333-4333-8333-333333333333";

function banco() {
  return criarFakeSupabase({
    crm_stages: [
      { id: ETAPA_A, organization_id: "org-A", pipeline_id: "funil-A" },
      { id: ETAPA_B, organization_id: "org-B", pipeline_id: "funil-B" },
      { id: ETAPA_A2, organization_id: "org-A", pipeline_id: "funil-A2" },
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

  describe("o negócio vem da ORIGEM do fluxo, nunca do destino", () => {
    function comDoisFunis() {
      const db = banco();
      db.tabelas.crm_leads!.push({ id: "lead-A2", organization_id: "org-A", contact_id: "c-A", pipeline_id: "funil-A2", status: "open" });
      return db;
    }

    it("origem no funil A, destino no funil A2: no-op outro_funil, o negócio do A2 NÃO é movido", async () => {
      const mover = vi.fn();
      const r = await moverEtapaDoFluxo(
        comDoisFunis() as unknown as SupabaseClient,
        { ...base, stageId: ETAPA_A2, origemLeadId: "lead-A" },
        { mover },
      );
      expect(r).toEqual({ movido: false, motivo: "outro_funil", lead_id: "lead-A" });
      expect(mover).not.toHaveBeenCalled();
    });

    it("origem no funil A, destino no funil A: move o negócio de origem", async () => {
      const mover = vi.fn().mockResolvedValue({});
      const r = await moverEtapaDoFluxo(
        comDoisFunis() as unknown as SupabaseClient,
        { ...base, stageId: ETAPA_A, origemLeadId: "lead-A" },
        { mover },
      );
      expect(r).toMatchObject({ movido: true, lead_id: "lead-A" });
      expect(mover.mock.calls[0]![2]).toBe("lead-A");
    });

    it("sem origem e dois negócios abertos: ambíguo, no-op", async () => {
      const mover = vi.fn();
      expect(
        await moverEtapaDoFluxo(comDoisFunis() as unknown as SupabaseClient, { ...base, stageId: ETAPA_A2 }, { mover }),
      ).toEqual({ movido: false, motivo: "ambiguo" });
      expect(mover).not.toHaveBeenCalled();
    });

    it("sem origem, o de origem FECHADO e um aberto em outro funil: ambíguo (nunca move o outro)", async () => {
      const db = banco();
      db.tabelas.crm_leads![0]!.status = "lost";
      db.tabelas.crm_leads!.push({ id: "lead-A2", organization_id: "org-A", contact_id: "c-A", pipeline_id: "funil-A2", status: "open" });
      const mover = vi.fn();
      expect(
        await moverEtapaDoFluxo(db as unknown as SupabaseClient, { ...base, stageId: ETAPA_A2 }, { mover }),
      ).toEqual({ movido: false, motivo: "ambiguo" });
      expect(mover).not.toHaveBeenCalled();
    });

    it("sem origem e o único negócio fechado: no-op", async () => {
      const db = banco();
      db.tabelas.crm_leads![0]!.status = "won";
      expect(
        await moverEtapaDoFluxo(db as unknown as SupabaseClient, { ...base, stageId: ETAPA_A }, { mover: vi.fn() }),
      ).toEqual({ movido: false, motivo: "sem_negocio" });
    });

    it("origem de OUTRA organização (ou de outro contato) não é lida", async () => {
      const db = banco();
      db.tabelas.crm_leads!.push({ id: "lead-B", organization_id: "org-B", contact_id: "c-A", pipeline_id: "funil-A", status: "open" });
      const mover = vi.fn();
      expect(
        await moverEtapaDoFluxo(db as unknown as SupabaseClient, { ...base, stageId: ETAPA_A, origemLeadId: "lead-B" }, { mover }),
      ).toEqual({ movido: false, motivo: "sem_negocio" });
      expect(mover).not.toHaveBeenCalled();
    });
  });
});

describe("moveLeadHandler — releituras filtram a organização", () => {
  it("a releitura do negócio e a da etapa de origem levam organization_id", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("app/api/v1/leads/_handler.ts", "utf8");
    const corpo = fonte.slice(fonte.indexOf("export async function moveLeadHandler"));
    const releitura = corpo.slice(corpo.indexOf("const { data: fresh }"), corpo.indexOf("const finalLead"));
    expect(releitura).toContain('.eq("organization_id", ctx.organization_id)');
    const origem = corpo.slice(corpo.indexOf("const { data: fromStage }"), corpo.indexOf("const atividade"));
    expect(origem).toContain('.eq("organization_id", ctx.organization_id)');
  });
});
