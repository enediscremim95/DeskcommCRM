import { beforeEach, describe, expect, it, vi } from "vitest";

const audit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({ audit: (...args: unknown[]) => audit(...(args as [])) }));

import { definirAtendimentoAutomatico } from "./atendimento-automatico";

describe("escrita do atendimento automático", () => {
  beforeEach(() => audit.mockClear());

  it("filtra leitura e escrita pela organização e audita a mudança", async () => {
    const filtros: Array<[string, unknown]> = [];
    let atualizando = false;
    let payload: Record<string, unknown> | null = null;
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { filtros.push([field, value]); return query; },
      is: () => query,
      update: (value: Record<string, unknown>) => { atualizando = true; payload = value; return query; },
      maybeSingle: async () => atualizando
        ? { data: { id: "canal-1" }, error: null }
        : { data: { id: "canal-1", automatic_attendance_enabled: false }, error: null },
    };
    const db = { from: vi.fn(() => query) } as never;

    const result = await definirAtendimentoAutomatico(db, {
      organizationId: "org-1",
      channelSessionId: "canal-1",
      enabled: true,
      actor: { actorUserId: "user-1", requestId: "req-1" },
    });

    expect(result).toEqual({ ok: true, enabled: true, changed: true });
    expect(filtros.filter(([field]) => field === "organization_id")).toEqual([
      ["organization_id", "org-1"],
      ["organization_id", "org-1"],
    ]);
    expect(payload).toEqual({ automatic_attendance_enabled: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "channel.automatic_attendance_updated",
      organizationId: "org-1",
      resourceId: "canal-1",
      metadata: { previous_enabled: false, enabled: true },
    }));
  });
});
