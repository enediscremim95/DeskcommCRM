export function urlDoConectorMcp(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
}

export function comandoClaudeMcp(connectorUrl: string, token = "SEU_TOKEN"): string {
  return `claude mcp add --transport http crm ${connectorUrl} --header "Authorization: Bearer ${token}"`;
}

export function comandosDoTokenMcp(
  connectorUrl: string,
  scopes: readonly string[],
  plaintext: string,
): { exibido: string; copiado: string } | null {
  if (!scopes.includes("mcp:read") && !scopes.includes("mcp:write")) return null;
  return {
    exibido: comandoClaudeMcp(connectorUrl),
    copiado: comandoClaudeMcp(connectorUrl, plaintext),
  };
}
