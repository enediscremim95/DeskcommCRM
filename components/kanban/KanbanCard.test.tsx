import { describe, expect, it } from "vitest";

import { formatLeadEntryDate } from "./KanbanCard";

describe("data de entrada no card do Kanban", () => {
  it("usa o fuso da pessoa e omite o ano quando é o atual", () => {
    expect(
      formatLeadEntryDate(
        "2026-09-24T17:32:00.000Z",
        "pt-BR",
        "America/Sao_Paulo",
        new Date("2026-09-26T12:00:00.000Z"),
      ),
    ).toBe("24/09 às 14:32");
  });

  it("inclui o ano quando a entrada é de outro ano", () => {
    expect(
      formatLeadEntryDate(
        "2025-09-24T17:32:00.000Z",
        "pt-BR",
        "America/Sao_Paulo",
        new Date("2026-09-26T12:00:00.000Z"),
      ),
    ).toBe("24/09/2025 às 14:32");
  });

  it("usa a forma curta em espanhol", () => {
    expect(
      formatLeadEntryDate(
        "2026-09-24T17:32:00.000Z",
        "es",
        "America/Sao_Paulo",
        new Date("2026-09-26T12:00:00.000Z"),
      ),
    ).toBe("24/09 a las 14:32");
  });
});
