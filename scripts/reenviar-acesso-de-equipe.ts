/**
 * Reenvia o acesso somente a membros ativos que nunca entraram.
 *
 * Dry-run no worker da VPS:
 *   docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml \
 *     -f docker-compose.dominios.yml exec worker npx tsx \
 *     scripts/reenviar-acesso-de-equipe.ts --org tessaro --emails a@x.com,b@y.com
 *
 * Aplicar:
 *   acrescente --aplicar ao comando acima.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  reenviarAcessoDeEquipe,
  verificarReenvioAcessoDeEquipe,
} from "@/lib/auth/reenviar-acesso-de-equipe";
import { createAdminClient } from "@/lib/supabase/admin";

const SCRIPT = "reenviar-acesso-de-equipe";

const cliSchema = z.object({
  org: z.string().trim().min(1),
  emails: z.array(z.string().trim().toLowerCase().email()).min(1),
  aplicar: z.boolean(),
});

function lerArgumentos(): z.infer<typeof cliSchema> {
  const raw = process.argv.slice(2);
  let org: string | undefined;
  let emails: string[] | undefined;
  let aplicar = false;

  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (arg === "--aplicar") {
      aplicar = true;
      continue;
    }
    if (arg === "--org" && raw[index + 1]) {
      org = raw[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--emails" && raw[index + 1]) {
      emails = raw[index + 1]!.split(",").map((email) => email.trim());
      index += 1;
      continue;
    }
    throw new Error(`Uso: npx tsx scripts/${SCRIPT}.ts --org <slug> --emails a@x,b@y [--aplicar]`);
  }

  const parsed = cliSchema.safeParse({ org, emails, aplicar });
  if (!parsed.success) {
    throw new Error(`Uso: npx tsx scripts/${SCRIPT}.ts --org <slug> --emails a@x,b@y [--aplicar]`);
  }
  return parsed.data;
}

function mascararEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const [host = "", ...suffix] = domain.split(".");
  const localMasked = `${local.slice(0, 1)}***`;
  const hostMasked = `${host.slice(0, 1)}***`;
  return `${localMasked}@${hostMasked}${suffix.length > 0 ? `.${suffix.join(".")}` : ""}`;
}

async function main(): Promise<void> {
  const args = lerArgumentos();
  const admin = createAdminClient();
  const { data: organization, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("slug", args.org)
    .maybeSingle();

  if (error) throw new Error(`falha ao localizar organização: ${error.message}`);
  if (!organization) throw new Error(`organização não encontrada: ${args.org}`);

  for (const email of [...new Set(args.emails)]) {
    const masked = mascararEmail(email);
    if (!args.aplicar) {
      const result = await verificarReenvioAcessoDeEquipe({
        organizationId: organization.id as string,
        email,
      });
      console.info(
        result.ok ? `receberia ${masked}` : `recusado ${masked}: ${result.reason}`,
      );
      continue;
    }

    const result = await reenviarAcessoDeEquipe({
      organizationId: organization.id as string,
      orgName: organization.name as string,
      email,
      actorUserId: null,
      requestId: randomUUID(),
      idioma: "pt-BR",
    });
    console.info(result.ok ? `enviado ${masked}` : `recusado ${masked}: ${result.reason}`);
  }
}

void main().catch((error) => {
  console.error(`[${SCRIPT}] falha:`, error instanceof Error ? error.message : "erro desconhecido");
  process.exit(1);
});
