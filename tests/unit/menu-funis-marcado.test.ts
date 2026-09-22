import { describe, expect, it } from "vitest";

import { NAV_DESTINATIONS, itemAtivo } from "@/lib/navigation/registry";

describe("menu 'Funis' fica marcado dentro do funil (pedido do dono, 22/09/2026)", () => {
  const funis = NAV_DESTINATIONS.find((d) => d.href === "/app/kanban")!;

  it("marca na lista, dentro de um funil e dentro de um lead", () => {
    expect(itemAtivo(funis, "/app/kanban")).toBe(true);
    expect(itemAtivo(funis, "/app/pipelines/abc")).toBe(true);
    expect(itemAtivo(funis, "/app/leads/xyz")).toBe(true);
  });

  it("não marca em outras telas nem em endereço parecido", () => {
    expect(itemAtivo(funis, "/app/contacts")).toBe(false);
    expect(itemAtivo(funis, "/app/leadsx")).toBe(false);
  });

  it("nenhum outro item do menu disputa esses endereços", () => {
    const outros = NAV_DESTINATIONS.filter((d) => d.href !== "/app/kanban");
    for (const caminho of ["/app/pipelines/abc", "/app/leads/xyz"]) {
      expect(outros.filter((d) => itemAtivo(d, caminho)).map((d) => d.href)).toEqual([]);
    }
  });
});
