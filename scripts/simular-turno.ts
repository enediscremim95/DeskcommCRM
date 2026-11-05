/**
 * Área de testes do agente, sem contato, conversa, mensagem, mídia ou canal real.
 * A única escrita no banco é a linha dry-run de ai_agent_runs.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadAgentVersionConfig } from "@/lib/agent-engine/agent/agent-config";
import { runAgentPreview } from "@/lib/agent-engine/agent/inbound-turn";
import { newPreviewResult, scenarioContext } from "@/lib/agent-engine/agent/preview";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";

const messageSchema = z.object({
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  sent_at: z.string().datetime(),
});
const historySchema = z.object({
  nome: z.string().min(1).max(200),
  msgs: z.array(messageSchema),
  catalogProductCodesAlreadySent: z.array(z.string().min(1).max(120)).default([]),
});
type History = z.infer<typeof historySchema>;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`parâmetro obrigatório ausente: --${name}`);
  return value;
}

async function loadHistory(file: string, reset: boolean, name?: string): Promise<History> {
  if (reset) {
    return { nome: name ?? "Cliente Teste", msgs: [], catalogProductCodesAlreadySent: [] };
  }
  try {
    const parsed = historySchema.parse(JSON.parse(await readFile(file, "utf8")));
    return name ? { ...parsed, nome: name } : parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { nome: name ?? "Cliente Teste", msgs: [], catalogProductCodesAlreadySent: [] };
    }
    throw error;
  }
}

function writeLine(value = ""): void {
  process.stdout.write(`${value}\n`);
}

async function main(): Promise<void> {
  const cli = z
    .object({
      organizationId: z.string().uuid(),
      agentId: z.string().uuid(),
      versionId: z.string().uuid().optional(),
      historyFile: z.string().min(1),
      message: z.string().min(1),
      promptFile: z.string().min(1).optional(),
      name: z.string().min(1).max(200).optional(),
      reset: z.boolean(),
    })
    .parse({
      organizationId: requiredOption("org-id"),
      agentId: requiredOption("agente-id"),
      versionId: option("versao-id"),
      historyFile: requiredOption("hist"),
      message: requiredOption("msg"),
      promptFile: option("prompt"),
      name: option("nome"),
      reset: process.argv.includes("--novo"),
    });

  const historyFile = path.resolve(cli.historyFile);
  const history = await loadHistory(historyFile, cli.reset, cli.name);
  history.msgs.push({
    direction: "inbound",
    body: cli.message,
    sent_at: new Date().toISOString(),
  });

  const pool = getRequestPool();
  const deps = requestTurnDeps();
  const versionId =
    cli.versionId ??
    (
      await pool.query<{ published_version_id: string | null }>(
        "select published_version_id from ai_agents where organization_id=$1 and id=$2",
        [cli.organizationId, cli.agentId],
      )
    ).rows[0]?.published_version_id;
  if (!versionId) throw new Error("agente sem versão publicada nesta organização");
  const agent = await loadAgentVersionConfig(
    pool,
    cli.organizationId,
    cli.agentId,
    versionId,
  );
  if (!agent) throw new Error("versão do agente indisponível nesta organização");
  if (cli.promptFile) agent.systemPrompt = await readFile(path.resolve(cli.promptFile), "utf8");

  const runId = randomUUID();
  await pool.query(
    `insert into ai_agent_runs
       (id, organization_id, agent_id, agent_version_id, conversation_id, contact_id,
        channel_session_id, status, is_dry_run, started_at)
     values ($1,$2,$3,$4,null,null,null,'running',true,now())`,
    [runId, cli.organizationId, cli.agentId, versionId],
  );

  const result = newPreviewResult();
  const startedAt = Date.now();
  let failure: Error | null = null;
  try {
    await runAgentPreview(deps, pool, {
      kind: "sandbox",
      organizationId: cli.organizationId,
      runId,
      agent,
      context: scenarioContext(history.msgs, { name: history.nome }),
      contactId: null,
      channelId: null,
      catalogProductCodesAlreadySent: history.catalogProductCodesAlreadySent,
      result,
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  await pool.query(
    "update ai_agent_runs set status=$2, completed_at=now() where id=$1 and organization_id=$3",
    [runId, failure ? "failed" : "completed", cli.organizationId],
  );

  writeLine(`\n=== CLIENTE (${history.nome}): ${cli.message}`);
  writeLine(
    `=== AGENTE (${Math.round((Date.now() - startedAt) / 1000)}s, versão ${agent.versionId.slice(0, 8)}${cli.promptFile ? ", PROMPT DE TESTE" : ""}):`,
  );
  for (const candidate of result.candidates) {
    writeLine(`  | ${candidate.body.replace(/\n/g, "\n  | ")}`);
    history.msgs.push({
      direction: "outbound",
      body: candidate.body,
      sent_at: new Date().toISOString(),
    });
  }
  if (result.toolTrace.length > 0) {
    writeLine("=== RASTRO DE FERRAMENTAS:");
    for (const trace of result.toolTrace) writeLine(`  - ${JSON.stringify(trace)}`);
  }
  if (result.envios.length > 0) {
    writeLine("=== FOTOS SIMULADAS:");
    for (const envio of result.envios) writeLine(`  - ${JSON.stringify(envio)}`);
  }
  if (result.proposals.length > 0) {
    writeLine("=== PROPOSTAS:");
    for (const proposal of result.proposals) writeLine(`  - ${JSON.stringify(proposal)}`);
  }
  if (result.impediments.length > 0) {
    writeLine("=== IMPEDIMENTOS:");
    for (const impediment of result.impediments) {
      writeLine(`  ! ${impediment.code}: ${impediment.message}`);
    }
  }

  history.catalogProductCodesAlreadySent = [
    ...new Set([
      ...history.catalogProductCodesAlreadySent,
      // Abertura e fechamento da vitrine entram em `envios` como texto, sem código de produto.
      ...result.envios
        .map((envio) => envio.produtoCodigo)
        .filter((codigo): codigo is string => typeof codigo === "string" && codigo.length > 0),
    ]),
  ];
  await mkdir(path.dirname(historyFile), { recursive: true });
  await writeFile(historyFile, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  if (failure) throw failure;
}

main().catch((error: unknown) => {
  process.stderr.write(`ERRO SEGURO: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
