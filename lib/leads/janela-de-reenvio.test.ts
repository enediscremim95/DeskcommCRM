import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  CHAVE_REENVIO_CANAL_INBOUND,
  chaveDaJanelaDaFonte,
  prepararEntradaNaJanela,
} from "./janela-de-reenvio";

function dbComLeadAberto() {
  let consultasDeLead = 0;
  const gte = vi.fn();

  const db = {
    from(tabela: string) {
      if (tabela === "organizations") {
        const consulta = {
          select: () => consulta,
          eq: () => consulta,
          maybeSingle: async () => ({ data: { settings: {} }, error: null }),
        };
        return consulta;
      }

      consultasDeLead += 1;
      if (consultasDeLead === 1) {
        const liberacao = {
          update: () => liberacao,
          eq: () => liberacao,
          lte: async () => ({ error: null }),
        };
        return liberacao;
      }

      const busca = {
        select: () => busca,
        eq: () => busca,
        gte: (...args: unknown[]) => {
          gte(...args);
          return busca;
        },
        order: () => busca,
        limit: () => busca,
        maybeSingle: async () => ({ data: { id: "lead-aberto" }, error: null }),
      };
      return busca;
    },
  };

  return { db: db as unknown as SupabaseClient, gte };
}

describe("escopo da janela curta de reenvio", () => {
  it("fonte existente mantém um card por evento por padrão", () => {
    expect(chaveDaJanelaDaFonte("fonte-1", false)).toBeNull();
  });

  it("fonte marcada recebe uma chave própria e não compartilha a trava com outra", () => {
    expect(chaveDaJanelaDaFonte("fonte-1", true)).toBe("fonte:fonte-1");
    expect(chaveDaJanelaDaFonte("fonte-2", true)).toBe("fonte:fonte-2");
  });

  it("canal inbound permanece protegido sem depender de fonte de webhook", () => {
    expect(CHAVE_REENVIO_CANAL_INBOUND).toBe("canal:inbound");
  });

  it("canal inbound consulta o card aberto sem corte por data", async () => {
    const { db, gte } = dbComLeadAberto();

    const resultado = await prepararEntradaNaJanela(db, {
      organizationId: "org-1",
      contactId: "contato-1",
      guardKey: CHAVE_REENVIO_CANAL_INBOUND,
      agora: new Date("2026-11-09T12:00:00.000Z"),
    });

    expect(resultado).toMatchObject({ existente: true, leadId: "lead-aberto" });
    expect(gte).not.toHaveBeenCalled();
  });

  it("fonte de formulário conserva o corte configurado", async () => {
    const { db, gte } = dbComLeadAberto();

    await prepararEntradaNaJanela(db, {
      organizationId: "org-1",
      contactId: "contato-1",
      guardKey: "fonte:formulario-1",
      agora: new Date("2026-11-09T12:00:00.000Z"),
    });

    expect(gte).toHaveBeenCalledWith("created_at", "2026-11-09T11:00:00.000Z");
  });
});
