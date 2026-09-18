import { describe, expect, it } from "vitest";

import { searchable } from "@/lib/navigation/registry";
import { CLOSED_INTEGRATION_ACCESS, type IntegrationAccessMap } from "@/lib/integrations/types";

const paths = (access?: IntegrationAccessMap) =>
  searchable(false, "admin", undefined, access).map((destination) => destination.href);

describe("liberação de integrações na navegação", () => {
  it("nega as três ferramentas quando não há configuração", () => {
    expect(paths(CLOSED_INTEGRATION_ACCESS)).not.toContain("/app/connections");
    expect(paths(CLOSED_INTEGRATION_ACCESS)).not.toContain("/app/ai/workflows");
    expect(paths(CLOSED_INTEGRATION_ACCESS)).not.toContain("/app/relatorio");
  });

  it("libera cada ferramenta sem abrir as outras", () => {
    const access = structuredClone(CLOSED_INTEGRATION_ACCESS);
    access.n8n.client_visible = true;
    expect(paths(access)).toContain("/app/ai/workflows");
    expect(paths(access)).not.toContain("/app/connections");
    expect(paths(access)).not.toContain("/app/relatorio");
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
