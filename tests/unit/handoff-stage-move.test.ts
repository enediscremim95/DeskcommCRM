import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moverLeadParaEtapaDeHandoff } from "@/lib/leads/handoff-stage-move";

describe("moverLeadParaEtapaDeHandoff — decisão humana obrigatória", () => {
  it.each(["new", "contacted", "qualifying", "qualified", "negotiating", "won", "lost", "confirmed", "handoff"])(
    "%s não muda etapa/status nem emite evento de movimento", async (value) => {
      const from = vi.fn(() => { throw new Error("nenhuma consulta deve acontecer"); });
      const rpc = vi.fn();
      const result = await moverLeadParaEtapaDeHandoff({ from, rpc } as unknown as SupabaseClient, { organizationId: "org", leadId: "lead", reason: value });
      expect(result).toEqual({ moveu: false, motivo: "decisao_humana_obrigatoria" });
      expect(from).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});
