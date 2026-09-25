import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_CATALOG } from "@/lib/navigation/catalogo";

const RAIZ = join(__dirname, "..", "..");

describe("tela MCP", () => {
  it("está registrada no grupo Canais com a mesma porta de papel da tela de tokens", () => {
    expect(NAV_CATALOG.find((item) => item.href === "/app/mcp")).toMatchObject({
      label: "MCP",
      group: "canais",
      minRole: "admin",
      sidebar: true,
    });
  });

  it("resolve o endereço pela instalação e não fixa domínio na página", () => {
    const source = readFileSync(join(RAIZ, "app/app/mcp/page.tsx"), "utf8");
    expect(source).toContain("urlDoConectorMcp(env.NEXT_PUBLIC_APP_URL)");
    expect(source).not.toMatch(/https:\/\/[a-z0-9.-]+\/api\/mcp/i);
  });

  it("a lista de tokens trabalha somente com metadados, sem selecionar plaintext", () => {
    const source = readFileSync(join(RAIZ, "app/app/mcp/page.tsx"), "utf8");
    expect(source).toContain("last_used_at");
    expect(source).not.toContain('.select("plaintext');
    expect(source).not.toContain("token_hash");
  });
});
