export function urlDoConectorMcp(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
}

export type IdDaConexaoMcp = "claude-code" | "codex-cli" | "cursor" | "generico";

export interface OpcaoDeConexaoMcp {
  id: IdDaConexaoMcp;
  nome: string;
  formato: "comando" | "configuracao" | "dados";
  destino?: string;
  conteudo: string;
}

export interface ComandoDoTokenMcp extends Omit<OpcaoDeConexaoMcp, "conteudo"> {
  exibido: string;
  copiado: string;
}

function configuracaoCodexMcp(connectorUrl: string, token: string): string {
  return [
    "[mcp_servers.crm]",
    `url = ${JSON.stringify(connectorUrl)}`,
    `http_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }`,
  ].join("\n");
}

function configuracaoCursorMcp(connectorUrl: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        crm: {
          url: connectorUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function comandosDeConexaoMcp(
  connectorUrl: string,
  token = "SEU_TOKEN",
): OpcaoDeConexaoMcp[] {
  return [
    {
      id: "claude-code",
      nome: "Claude Code",
      formato: "comando",
      conteudo: `claude mcp add --transport http crm ${connectorUrl} --header "Authorization: Bearer ${token}"`,
    },
    {
      id: "codex-cli",
      nome: "Codex CLI",
      formato: "configuracao",
      destino: "~/.codex/config.toml",
      conteudo: configuracaoCodexMcp(connectorUrl, token),
    },
    {
      id: "cursor",
      nome: "Cursor",
      formato: "configuracao",
      destino: "~/.cursor/mcp.json",
      conteudo: configuracaoCursorMcp(connectorUrl, token),
    },
    {
      id: "generico",
      nome: "Outro aplicativo ou site",
      formato: "dados",
      conteudo: [`URL: ${connectorUrl}`, `Authorization: Bearer ${token}`].join("\n"),
    },
  ];
}

export function comandoClaudeMcp(connectorUrl: string, token = "SEU_TOKEN"): string {
  return comandosDeConexaoMcp(connectorUrl, token)[0]!.conteudo;
}

export function comandosDoTokenMcp(
  connectorUrl: string,
  scopes: readonly string[],
  plaintext: string,
): ComandoDoTokenMcp[] | null {
  if (!scopes.includes("mcp:read") && !scopes.includes("mcp:write")) return null;

  const exibidos = comandosDeConexaoMcp(connectorUrl);
  const copiadosPorId = new Map(
    comandosDeConexaoMcp(connectorUrl, plaintext).map((opcao) => [opcao.id, opcao.conteudo]),
  );

  return exibidos.map(({ conteudo, ...opcao }) => ({
    ...opcao,
    exibido: conteudo,
    copiado: copiadosPorId.get(opcao.id)!,
  }));
}
