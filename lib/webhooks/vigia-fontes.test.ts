import { describe, expect, it, vi } from "vitest";

import {
  fontePassouDaJanela,
  KIND_FONTE_SEM_LEAD,
  vigiarFontesSemLead,
} from "@/lib/webhooks/vigia-fontes";

describe("vigiarFontesSemLead", () => {
  const agora = new Date("2026-09-25T12:00:00.000Z");

  it("considera parada somente a fonte ativa que já recebeu e completou 48 horas", () => {
    const base = {
      id: "fonte-1",
      organization_id: "org-1",
      name: "Página",
      is_active: true,
    };
    expect(
      fontePassouDaJanela({ ...base, last_received_at: "2026-09-23T12:00:00.000Z" }, agora),
    ).toBe(true);
    expect(
      fontePassouDaJanela({ ...base, last_received_at: "2026-09-23T12:00:01.000Z" }, agora),
    ).toBe(false);
    expect(
      fontePassouDaJanela(
        { ...base, is_active: false, last_received_at: "2026-09-20T12:00:00.000Z" },
        agora,
      ),
    ).toBe(false);
  });

  it("abre um aviso na Central para a fonte parada", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "webhook_sources") {
          return {
            select: () => ({
              not: () => ({
                order: () => ({
                  range: async (inicio: number) => ({
                    data:
                      inicio === 0
                        ? [
                            {
                              id: "fonte-1",
                              organization_id: "org-1",
                              name: "Página de Professores",
                              is_active: true,
                              last_received_at: "2026-09-23T11:59:59.000Z",
                            },
                          ]
                        : [],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({
                  order: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
          insert,
        };
      }),
    };

    const resultado = await vigiarFontesSemLead(admin as never, agora);

    expect(resultado.avisos_abertos).toBe(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: KIND_FONTE_SEM_LEAD,
        ref_kind: "webhook_source",
        ref_id: "fonte-1",
      }),
    );
  });
});
