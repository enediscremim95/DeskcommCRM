import type { McpToolDefinition } from "../types";

export const crmComoFunciona: McpToolDefinition = {
  name: "crm_como_funciona",
  description: "Leia primeiro: explica este CRM e o que você pode fazer aqui.",
  inputSchema: {},
  category: "read",
  requiresRole: "viewer",
  requiresScope: "mcp:read",
  handler: async (_input, ctx) => ctx.apresentacao ?? "",
};
