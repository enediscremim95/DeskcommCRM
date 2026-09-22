import { describe, expect, it } from "vitest";

import type { TimelineItemView } from "@/lib/types/contacts";
import { timelineSentence } from "./timeline-sentence";

function item(type: string, payload: Record<string, unknown> = {}, reason: string | null = null) {
  return { type, payload, reason } as TimelineItemView;
}

describe("frases humanas da timeline", () => {
  const t = (value: string) => value;

  it("narra criação, mudança de etapa e responsável", () => {
    expect(timelineSentence(item("lead_created"), "Ana", t).sentence).toBe("Lead criado");
    expect(
      timelineSentence(item("stage_changed", { to_stage_name: "Proposta" }), "Ana", t).sentence,
    ).toBe("Ana alterou a etapa para Proposta");
    expect(
      timelineSentence(item("lead_edited", { fields: ["owner_user_id"] }), "Ana", t).sentence,
    ).toBe("Ana alterou o responsável");
  });

  it("inclui o motivo ao marcar como perdido", () => {
    expect(
      timelineSentence(item("demand_closed", { desfecho: "lost" }, "Perdido — Preço"), "Ana", t)
        .sentence,
    ).toBe("Ana marcou como perdido, motivo: Preço");
  });
});
