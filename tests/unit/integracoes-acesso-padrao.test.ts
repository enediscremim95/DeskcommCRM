import { describe, expect, it } from "vitest";

import { integrationAccessFromRows } from "@/lib/integrations/types";

describe("acesso padrão às integrações", () => {
  it("faz organização sem linhas enxergar as três integrações", async () => {
    const access = integrationAccessFromRows([]);

    expect(access.whatsapp.client_visible).toBe(true);
    expect(access.n8n.client_visible).toBe(true);
    expect(access.windsor.client_visible).toBe(true);
  });

  it("mantém fechamento explícito com precedência", async () => {
    const access = integrationAccessFromRows([
      { integration: "windsor", client_visible: false, client_can_reconnect: false },
    ]);

    expect(access.windsor.client_visible).toBe(false);
    expect(access.n8n.client_visible).toBe(true);
  });

  it("mantém a reconexão do WhatsApp fechada por padrão", async () => {
    expect(integrationAccessFromRows([]).whatsapp.client_can_reconnect).toBe(false);
  });
});
