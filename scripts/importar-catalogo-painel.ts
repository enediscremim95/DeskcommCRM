import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { importarCatalogoDoPainel } from "../lib/catalogo/importar-painel";
import { createAdminClient } from "../lib/supabase/admin";

function argumento(nome: string): string | null {
  const indice = process.argv.indexOf(nome);
  return indice >= 0 ? (process.argv[indice + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const orgId = argumento("--org-id");
  const slug = argumento("--slug");
  const arquivo = argumento("--arquivo");
  const aplicar = process.argv.includes("--aplicar");
  if (!orgId || !slug || !arquivo) {
    throw new Error("uso: --org-id <uuid> --slug <slug> --arquivo <json> [--aplicar]");
  }
  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id,slug")
    .eq("id", orgId)
    .eq("slug", slug)
    .maybeSingle();
  if (error || !org) throw new Error("organizacao_nao_confere");
  const retrato: unknown = JSON.parse(await readFile(resolve(arquivo), "utf8"));
  const resumo = await importarCatalogoDoPainel(admin, orgId, retrato, { aplicar });
  process.stdout.write(
    `${aplicar ? "APLICADO" : "DRY-RUN"} ` +
      `criados=${resumo.criados} atualizados=${resumo.atualizados} ` +
      `desativados=${resumo.desativados} fotos_novas=${resumo.fotos_novas} ` +
      `falhas=${resumo.falhas.length}\n`,
  );
  if (resumo.falhas.length > 0) process.stdout.write(`${JSON.stringify(resumo.falhas)}\n`);
}

void main().catch((erro: unknown) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : "erro_desconhecido"}\n`);
  process.exitCode = 1;
});
