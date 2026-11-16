import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Duas chamadas do vigia no mesmo processo. O curl do agendador desiste em
 * 60s, mas a passada continua no servidor; uma chamada manual faz o mesmo.
 * A segunda não pode ler o estado e gravar outra frase.
 */

const avisos = vi.hoisted(() => vi.fn());
const observa = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  env: { INTERNAL_CRON_SECRET: "segredo-de-teste", INTERNAL_SECRET: "segredo-de-teste" },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: avisos, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/leads/risk-worker", () => ({ observaTravessias: observa }));
vi.mock("@/lib/leads/reactivation", () => ({
  venceReativacoes: vi.fn(async () => ({ vencidas: 0, falhasDeAtividade: 0 })),
}));
vi.mock("@/lib/notifications/urgent-events", () => ({
  enqueueOverdueLeadTaskEvents: vi.fn(async () => ({ enqueued: 0 })),
}));

let explodir = false;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (explodir) throw new Error("banco caiu");
    return {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: [{ organization_id: "org-1" }], error: null }),
        }),
      }),
    };
  },
}));

import { POST } from "@/app/api/v1/cron/risk-watcher/route";

function chamar() {
  return POST(
    new Request("http://localhost/api/v1/cron/risk-watcher", {
      method: "POST",
      headers: { authorization: "Bearer segredo-de-teste" },
    }) as never,
  );
}

const vazio = {
  travessias: 0,
  esfriaram: 0,
  reativaram: 0,
  silenciosas: 0,
  falhasDeAtividade: 0,
  propostas: 0,
  esfriamentosJaRegistrados: 0,
};

async function esperar(pronto: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (pronto()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("a primeira passada não chegou a processar");
}

beforeEach(() => {
  explodir = false;
  avisos.mockClear();
  observa.mockReset();
  observa.mockResolvedValue(vazio);
});

describe("trava do vigia no processo", () => {
  it("a segunda chamada simultânea pula, e a seguinte roda depois que a primeira termina", async () => {
    let seguir: () => void = () => {};
    const espera = new Promise<void>((resolve) => {
      seguir = resolve;
    });
    observa.mockImplementation(() => espera.then(() => vazio));

    const primeira = chamar();
    await esperar(() => observa.mock.calls.length === 1);

    const segunda = await chamar();
    expect(segunda.status).toBe(202);
    expect(await segunda.json()).toEqual({ data: { skipped: "em_andamento" } });
    expect(observa).toHaveBeenCalledTimes(1);
    expect(avisos).toHaveBeenCalledWith(
      "[risk-watcher] passada já em andamento; esta chamada não processa",
      expect.objectContaining({ requestId: expect.any(String) }),
    );

    seguir();
    const concluida = await primeira;
    expect(concluida.status).toBe(200);

    const terceira = await chamar();
    expect(terceira.status).toBe(200);
    expect(observa).toHaveBeenCalledTimes(2);
  });

  it("solta a trava quando a passada lança, e a chamada seguinte roda", async () => {
    explodir = true;
    await expect(chamar()).rejects.toThrow("banco caiu");

    explodir = false;
    const seguinte = await chamar();
    expect(seguinte.status).toBe(200);
    expect(observa).toHaveBeenCalledTimes(1);
  });
});
