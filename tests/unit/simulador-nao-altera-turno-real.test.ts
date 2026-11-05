import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
  "utf8",
);
const scriptSource = readFileSync(
  path.join(process.cwd(), "scripts/simular-turno.ts"),
  "utf8",
);

it("mantém envio real e instrumentação do sandbox em ramos separados", () => {
  const catalogStart = source.indexOf(
    "if (agentConfig?.toolIds.includes('crm_send_catalog_item'))",
  );
  const sandboxStart = source.indexOf("if (preview?.kind === 'sandbox')", catalogStart);
  const catalogEnd = source.indexOf("agentConfig?.toolIds.includes('crm_send_vitrine')", sandboxStart);
  const realBranch = source.slice(catalogStart, sandboxStart);
  const sandboxBranch = source.slice(sandboxStart, catalogEnd);

  expect(catalogStart).toBeGreaterThan(-1);
  expect(realBranch).toContain("executarEnvioDeItemDoCatalogo");
  expect(realBranch).toContain("runBeforeSend");
  expect(realBranch).toContain("liveChannel().send");
  expect(sandboxBranch).toContain("simularEnvioDeItemDoCatalogo");
  expect(sandboxBranch).not.toContain("liveChannel().send");
  expect(source).toContain(
    "const tools = preview ? withPreviewToolTrace(toolsWithBreaker, preview) : toolsWithBreaker;",
  );
});

it("o CLI grava somente o run dry-run e nunca toca entidades ou mídia do cliente", () => {
  expect(scriptSource.match(/insert\s+into\s+[a-z_]+/gi)).toEqual([
    "insert into ai_agent_runs",
  ]);
  expect(scriptSource).toContain("is_dry_run");
  expect(scriptSource).toContain('failure ? "failed" : "completed"');
  expect(scriptSource).not.toMatch(/insert\s+into\s+(?:contacts|conversations|messages)/i);
  expect(scriptSource).not.toMatch(/storage\.(?:download|upload)/i);
});
