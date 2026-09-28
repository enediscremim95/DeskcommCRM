import { describe, expect, it } from "vitest";

import {
  comandoClaudeMcp,
  comandosDeConexaoMcp,
  comandosDoTokenMcp,
  urlDoConectorMcp,
} from "./conexao";

describe("configuração do conector MCP", () => {
  it("resolve o endpoint a partir da URL da instalação", () => {
    expect(urlDoConectorMcp("https://crm.exemplo.com/")).toBe("https://crm.exemplo.com/api/mcp");
  });

  it("exibe placeholder, mas copia o token recém-criado", () => {
    const comandos = comandosDoTokenMcp(
      "https://crm.exemplo.com/api/mcp",
      ["mcp:read"],
      "dsk_segredo_unico",
    );

    expect(comandos).toHaveLength(4);
    expect(comandos?.every((comando) => comando.exibido.includes("Bearer SEU_TOKEN"))).toBe(true);
    expect(comandos?.every((comando) => !comando.exibido.includes("dsk_segredo_unico"))).toBe(true);
    expect(comandos?.every((comando) => comando.copiado.includes("Bearer dsk_segredo_unico"))).toBe(
      true,
    );
  });

  it("não oferece comando especial para token sem escopo MCP", () => {
    expect(
      comandosDoTokenMcp("https://crm.exemplo.com/api/mcp", ["contacts:read"], "dsk_x"),
    ).toBeNull();
  });

  it("mantém o comando pronto para uso no Claude Code", () => {
    expect(comandoClaudeMcp("https://crm.exemplo.com/api/mcp")).toBe(
      'claude mcp add --transport http crm https://crm.exemplo.com/api/mcp --header "Authorization: Bearer SEU_TOKEN"',
    );
  });

  it("entrega uma opção pronta para cada ferramenta e uma saída genérica", () => {
    const opcoes = comandosDeConexaoMcp("https://crm.exemplo.com/api/mcp");

    expect(opcoes.map((opcao) => opcao.id)).toEqual([
      "claude-code",
      "codex-cli",
      "cursor",
      "generico",
    ]);
    expect(opcoes.find((opcao) => opcao.id === "codex-cli")).toMatchObject({
      formato: "configuracao",
      destino: "~/.codex/config.toml",
    });
    expect(opcoes.find((opcao) => opcao.id === "codex-cli")?.conteudo).toBe(
      '[mcp_servers.crm]\nurl = "https://crm.exemplo.com/api/mcp"\nhttp_headers = { Authorization = "Bearer SEU_TOKEN" }',
    );

    const cursor = opcoes.find((opcao) => opcao.id === "cursor");
    expect(cursor).toMatchObject({
      formato: "configuracao",
      destino: "~/.cursor/mcp.json",
    });
    expect(JSON.parse(cursor!.conteudo)).toEqual({
      mcpServers: {
        crm: {
          url: "https://crm.exemplo.com/api/mcp",
          headers: { Authorization: "Bearer SEU_TOKEN" },
        },
      },
    });

    expect(opcoes.find((opcao) => opcao.id === "generico")?.conteudo).toBe(
      "URL: https://crm.exemplo.com/api/mcp\nAuthorization: Bearer SEU_TOKEN",
    );
  });
});
