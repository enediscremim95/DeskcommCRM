import { describe, expect, it } from "vitest";

import { searchable } from "@/lib/navigation/registry";
import { DEFAULT_INTEGRATION_ACCESS, type IntegrationAccessMap } from "@/lib/integrations/types";

const paths = (access?: IntegrationAccessMap) =>
  searchable(false, "admin", undefined, access).map((destination) => destination.href);

describe("liberação de integrações na navegação", () => {
  it("mostra as três ferramentas quando não há configuração explícita", () => {
    expect(paths(DEFAULT_INTEGRATION_ACCESS)).toEqual(expect.arrayContaining([
      "/app/connections",
      "/app/ai/workflows",
      "/app/relatorio",
    ]));
  });

  it("respeita o fechamento explícito sem esconder as outras ferramentas", () => {
    const access = structuredClone(DEFAULT_INTEGRATION_ACCESS);
    access.n8n.client_visible = false;
    expect(paths(access)).not.toContain("/app/ai/workflows");
    expect(paths(access)).toContain("/app/connections");
    expect(paths(access)).toContain("/app/relatorio");
  });

  it("mantém todas disponíveis para o admin da plataforma", () => {
    const visible = searchable(true, null).map((destination) => destination.href);
    expect(visible).toEqual(expect.arrayContaining([
      "/app/connections",
      "/app/ai/workflows",
      "/app/relatorio",
    ]));
  });
});
