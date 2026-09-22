import { describe, expect, it } from "vitest";

import { escolheEtapaDeRetomada } from "./reabertura";

const stages = [
  { id: "primeira", name: "Contato", position: 1 },
  { id: "anterior", name: "Proposta", position: 2 },
];

describe("reabertura de lead perdido", () => {
  it("retoma na etapa anterior quando ela ainda está aberta", () => {
    expect(escolheEtapaDeRetomada(stages, "anterior")?.id).toBe("anterior");
  });

  it("cai para a primeira etapa aberta quando a anterior não existe", () => {
    expect(escolheEtapaDeRetomada(stages, "arquivada")?.id).toBe("primeira");
    expect(escolheEtapaDeRetomada([], "anterior")).toBeNull();
  });
});
