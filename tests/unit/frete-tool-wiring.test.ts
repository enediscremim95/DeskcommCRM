import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BLOCKED_TOOL_IDS } from "@/lib/agent-engine/edge/crm/mcp-tools";
import { TOOL_CATALOG } from "@/lib/mcp/tools/catalog";

const fonteTurno = readFileSync(
  resolve(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
  "utf8",
);
const fontePreview = readFileSync(
  resolve(process.cwd(), "lib/agent-engine/agent/preview.ts"),
  "utf8",
);

describe("ligação da cotação de frete ao turno do agente", () => {
  it("existe no catálogo, mas não entra pela ponte MCP genérica", () => {
    expect(TOOL_CATALOG.map((tool) => tool.name)).toContain("crm_quote_shipping");
    expect(BLOCKED_TOOL_IDS.has("crm_quote_shipping")).toBe(true);
  });

  it("é opt-in por tool_ids e executa no harness pela fila FIFO", () => {
    const inicio = fonteTurno.indexOf("if (agentConfig?.toolIds.includes('crm_quote_shipping'))");
    const fim = fonteTurno.indexOf("if (vitrineAtivaNesteAgente", inicio);
    const bloco = fonteTurno.slice(inicio, fim);

    expect(inicio).toBeGreaterThan(0);
    expect(fim).toBeGreaterThan(inicio);
    expect(bloco).toContain("rawTools.crm_quote_shipping = tool");
    expect(bloco).toContain("filaDeEnvios.enfileirar");
    expect(bloco).toContain("executarCotacaoDeFrete");
    expect(bloco).toContain("simularCotacaoDeFrete");
    expect(bloco).not.toContain("seq +=");
  });

  it("sandbox mantém a execução sintética e nunca converte a tool em proposta", () => {
    expect(fonteTurno).toMatch(
      /preview\?\.kind === 'sandbox'[\s\S]{0,300}simularCotacaoDeFrete/u,
    );
    expect(fontePreview).toMatch(
      /name === 'crm_quote_shipping'[\s\S]{0,300}return \[name, definition\]/u,
    );
  });
});
