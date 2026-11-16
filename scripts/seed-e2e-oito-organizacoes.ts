/**
 * Seed do cenário "troca de organização em sequência": UM usuário em OITO
 * organizações, todas com onboarding concluído, funil padrão e o Relatório
 * liberado (integração `windsor` visível) — é o que faz o link "Relatório"
 * aparecer no menu lateral de todas elas.
 *
 * Usado por `tests/e2e/troca-de-organizacao-em-sequencia.spec.ts`, que troca
 * entre as oito várias vezes e falha se o tempo crescer, se cair em tela branca
 * ou se o link Relatório não navegar.
 *
 * Idempotente: reusa organização por slug, vínculo por par e permissão por par.
 * Só roda contra o Supabase LOCAL (`credenciaisSupabaseDeTeste` recusa o resto).
 *
 * Run: npx tsx scripts/seed-e2e-oito-organizacoes.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-oito-organizacoes", credenciais);

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
/** A organização A é a do `.e2e-creds.json`; as outras sete nascem aqui. */
const EXTRAS = 7;

interface Creds {
  org_id: string;
  password: string;
  users?: Record<string, { id: string; email: string; role: string }>;
}

async function orgPorSlug(slug: string, nome: string): Promise<string> {
  const { data: existente, error } = await admin
    .from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`buscar org ${slug}: ${error.message}`);
  if (existente) {
    const id = (existente as { id: string }).id;
    const { error: fix } = await admin.from("organizations")
      .update({ onboarded_at: new Date().toISOString(), status: "active" } as never)
      .eq("id", id).is("onboarded_at", null);
    if (fix) throw new Error(`garantir onboarding de ${slug}: ${fix.message}`);
    return id;
  }
  const { data, error: ins } = await admin.from("organizations").insert({
    slug, display_name: nome, legal_name: nome, timezone: "America/Sao_Paulo", locale: "pt-BR",
    onboarded_at: new Date().toISOString(),
  } as never).select("id").single();
  if (ins || !data) throw new Error(`criar org ${slug}: ${ins?.message}`);
  return (data as { id: string }).id;
}

async function vincular(userId: string, orgId: string): Promise<void> {
  const { error } = await admin.from("user_organizations").upsert({
    user_id: userId, organization_id: orgId, role: "admin", revoked_at: null,
    accepted_at: new Date().toISOString(),
  } as never, { onConflict: "user_id,organization_id" });
  if (error) throw new Error(`vincular ${orgId}: ${error.message}`);
}

async function liberarRelatorio(orgId: string): Promise<void> {
  const { error } = await admin.from("organization_integration_permissions" as never).upsert({
    organization_id: orgId, integration: "windsor", client_visible: true, client_can_reconnect: false,
  } as never, { onConflict: "organization_id,integration" });
  if (error) throw new Error(`liberar relatório ${orgId}: ${error.message}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(CREDS_PATH)) throw new Error(`${CREDS_PATH} não existe — rode seed-e2e-credentials.ts antes.`);
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  const usuario = creds.users?.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem `users.manager`");

  const orgs: Array<{ id: string; nome: string }> = [];
  const { data: a } = await admin.from("organizations").select("display_name").eq("id", creds.org_id).maybeSingle();
  orgs.push({ id: creds.org_id, nome: (a as { display_name?: string } | null)?.display_name ?? "Org A" });
  for (let i = 1; i <= EXTRAS; i++) {
    const nome = `E2E Troca ${i}`;
    orgs.push({ id: await orgPorSlug(`e2e-troca-${i}`, nome), nome });
  }
  for (const org of orgs) {
    await vincular(usuario.id, org.id);
    await liberarRelatorio(org.id);
  }

  const bloco = { usuario_email: usuario.email, orgs };
  fs.writeFileSync(CREDS_PATH, JSON.stringify({ ...creds, oito_orgs: bloco }, null, 2));
  console.info(`[seed-e2e-oito-organizacoes] ${orgs.length} organizações para ${usuario.email}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
