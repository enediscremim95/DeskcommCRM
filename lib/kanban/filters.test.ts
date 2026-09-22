import { describe, expect, it } from "vitest";

import { parseBoardFilterPreference, serializeBoardFilterPreference } from "./filters";

describe("preferências dos filtros do quadro", () => {
  it("persiste apenas negociações e situação", () => {
    expect(
      serializeBoardFilterPreference({
        owner: "user-1",
        status: "lost",
        search: "não persistir",
        tag: "vip",
      }),
    ).toBe('{"owner":"user-1","status":"lost"}');
  });

  it("ignora JSON inválido e situação desconhecida", () => {
    expect(parseBoardFilterPreference("não-json")).toBeNull();
    expect(parseBoardFilterPreference('{"owner":"user-1","status":"x"}')).toEqual({
      owner: "user-1",
      status: undefined,
    });
  });
});
