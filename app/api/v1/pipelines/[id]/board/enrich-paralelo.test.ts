import { describe, expect, it } from "vitest";

import { enrichLeads } from "./route";

/**
 * Regressão: os enriquecimentos do quadro rodavam em série e o quadro levava
 * segundos para abrir após trocar de organização. Este teste mede a
 * CONCORRÊNCIA real: com 4 consultas independentes, mais de uma tem de estar em
 * voo ao mesmo tempo. Em série o pico é 1 e o teste reprova.
 */
function fakeSupabase(rowsByTable: Record<string, unknown[]>) {
  let emVoo = 0;
  let pico = 0;
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "order"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void) => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      setTimeout(() => {
        emVoo--;
        resolve({ data: rowsByTable[table] ?? [], error: null });
      }, 15);
    };
    return q;
  };
  return { client: { from } as never, pico: () => pico };
}

describe("quadro: enriquecimento em paralelo", () => {
  const leads = [
    { id: "l1", contact_id: "c1", owner_kind: "ai", owner_agent_id: "a1" },
    { id: "l2", contact_id: "c2", owner_kind: null, owner_agent_id: null },
  ] as never[];

  it("dispara as consultas independentes ao mesmo tempo", async () => {
    const f = fakeSupabase({
      ai_agents: [{ id: "a1", name: "Ana", published_version_id: null }],
      crm_lead_scores: [
        {
          lead_id: "l2",
          ai_probability: "0.5",
          ai_probability_reason: "x",
          ai_probability_band: "medium",
          ai_probability_evidence: null,
          ai_probability_at: null,
        },
      ],
      conversations: [
        { id: "v1", contact_id: "c1", last_message_preview: "oi", last_message_at: null, unread_count_for_assignee: 2 },
      ],
    });
    const out = await enrichLeads(f.client, "org", leads, null);
    expect(out.error).toBeNull();
    // Em série o pico seria 2 (só o Promise.all interno da próxima ação).
    expect(f.pico()).toBeGreaterThanOrEqual(4);
    // mescla preservada: cada campo cai no lead certo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [l1, l2] = out.leads as unknown as [Record<string, any>, Record<string, any>];
    expect(l1.owner_agent.name).toBe("Ana");
    expect(l1.conversa.unread).toBe(2);
    expect(l2.score.probability).toBe(0.5);
    expect(l2.owner_agent).toBeUndefined();
  });

  it("propaga erro de qualquer enriquecimento", async () => {
    const client = {
      from: (t: string) => {
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "not", "order"]) q[m] = () => q;
        q.then = (r: (v: unknown) => void) =>
          r({ data: null, error: t === "conversations" ? { message: "boom" } : null });
        return q;
      },
    } as never;
    const out = await enrichLeads(client, "org", leads, null);
    expect(out.error).toBe("boom");
  });
});
