import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/automation/template";

const ctx = { contact: { name: "Ana" }, lead: { title: "Pedido X", custom_fields: { cupom: "BF10" } } };

describe("renderTemplate", () => {
  it("variável simples", () =>
    expect(renderTemplate("Oi {{contact.name}}!", ctx)).toBe("Oi Ana!"));
  it("path aninhado", () =>
    expect(renderTemplate("Use {{lead.custom_fields.cupom}}", ctx)).toBe("Use BF10"));
  it("alias {{nome}} resolve contact.name", () =>
    expect(renderTemplate("Oi {{nome}}", ctx)).toBe("Oi Ana"));
  it("variável ausente vira vazio, não '{{...}}' cru", () =>
    expect(renderTemplate("X{{lead.ghost}}Y", ctx)).toBe("XY"));
  it("espaços dentro das chaves tolerados", () =>
    expect(renderTemplate("Oi {{ contact.name }}", ctx)).toBe("Oi Ana"));

  it.each([
    ["2026-09-28T12:00:00.000Z", "Ótimo dia"],
    ["2026-09-28T18:00:00.000Z", "Ótima tarde"],
    ["2026-09-29T00:00:00.000Z", "Ótima noite"],
  ])("resolve {{saudacao}} nas três janelas de America/Sao_Paulo (%s)", (instant, expected) => {
    expect(
      renderTemplate("{{saudacao}}!", ctx, {
        now: new Date(instant),
        timezone: "America/Sao_Paulo",
      }),
    ).toBe(`${expected}!`);
  });

  it("calcula {{saudacao}} no fuso informado, não no relógio do servidor", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    expect(renderTemplate("{{saudacao}}", ctx, { now, timezone: "America/Sao_Paulo" })).toBe(
      "Ótimo dia",
    );
    expect(renderTemplate("{{saudacao}}", ctx, { now, timezone: "Asia/Tokyo" })).toBe(
      "Ótima noite",
    );
  });
});
