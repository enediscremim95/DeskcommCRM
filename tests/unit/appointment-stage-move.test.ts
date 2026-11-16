import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moverLeadParaEtapaDeAgendamento } from "@/lib/leads/appointment-stage-move";

describe("moverLeadParaEtapaDeAgendamento — decisão humana obrigatória", () => {
  it.each(["new", "contacted", "qualifying", "qualified", "negotiating", "won", "lost", "confirmed", "handoff"])(
    "%s não muda etapa/status nem emite evento de movimento", async (value) => {
      const from = vi.fn(() => { throw new Error("nenhuma consulta deve acontecer"); });
      const rpc = vi.fn();
      const result = await moverLeadParaEtapaDeAgendamento({ from, rpc } as unknown as SupabaseClient, { organizationId: "org", leadId: "lead", transicao: value as "confirmed" });
      expect(result).toEqual({ moveu: false, motivo: "decisao_humana_obrigatoria" });
      expect(from).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});
