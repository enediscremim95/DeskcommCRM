import { describe, expect, it } from "vitest";

import { comandoClaudeMcp, comandosDoTokenMcp, urlDoConectorMcp } from "./conexao";

describe("configuração do conector MCP", () => {
  it("resolve o endpoint a partir da URL da instalação", () => {
    expect(urlDoConectorMcp("https://crm.exemplo.com/")).toBe(
      "https://crm.exemplo.com/api/mcp",
    );
  });

  it("exibe placeholder, mas copia o token recém-criado", () => {
    const comandos = comandosDoTokenMcp(
      "https://crm.exemplo.com/api/mcp",
      ["mcp:read"],
      "dsk_segredo_unico",
    );

    expect(comandos?.exibido).toContain("Bearer SEU_TOKEN");
    expect(comandos?.exibido).not.toContain("dsk_segredo_unico");
    expect(comandos?.copiado).toContain("Bearer dsk_segredo_unico");
  });

  it("não oferece comando especial para token sem escopo MCP", () => {
    expect(comandosDoTokenMcp("https://crm.exemplo.com/api/mcp", ["contacts:read"], "dsk_x"))
      .toBeNull();
  });

  it("mantém o comando pronto para uso no Claude Code", () => {
    expect(comandoClaudeMcp("https://crm.exemplo.com/api/mcp")).toBe(
      'claude mcp add --transport http crm https://crm.exemplo.com/api/mcp --header "Authorization: Bearer SEU_TOKEN"',
    );
  });
});
