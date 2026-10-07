/**
 * Recupera contatos de leads cuja captação preservou `source_metadata.raw_phone`.
 *
 * Dry-run, padrão:
 *   pnpm exec tsx scripts/recuperar-contatos-de-leads-sem-telefone.ts
 *
 * Aplicar dentro da imagem de produção que contém scripts e tsx:
 *   docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml \
 *     -f docker-compose.dominios.yml exec worker pnpm exec tsx \
 *     scripts/recuperar-contatos-de-leads-sem-telefone.ts --aplicar
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import {
  encontrarContatoPorTelefoneComNome,
  encontrarOuCriarContatoPorTelefone,
} from "@/lib/channels/contato-por-telefone";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { ATIVIDADE_CONTATO_RECUPERADO } from "@/lib/leads/activity-vocabulary";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  nomeDoContatoRecuperado,
  planejarRecuperacao,
  telefoneMascarado,
  tituloDepoisDaRecuperacao,
  type LeadSemContato,
} from "./lib/recuperacao-contato-de-lead";

const SCRIPT = "recuperar-contatos-de-leads-sem-telefone";
const argsSchema = z.array(z.literal("--aplicar")).max(1);
const args = argsSchema.safeParse(process.argv.slice(2));
if (!args.success) {
  console.error(`Uso: pnpm exec tsx scripts/${SCRIPT}.ts [--aplicar]`);
  process.exit(2);
}
const APLICAR = args.data.includes("--aplicar");
const PAGE_SIZE = 500;

interface Contadores {
  candidatos: number;
  validos: number;
  invalidos: number;
  vinculados: number;
  falhas: number;
}

async function listarOrganizacoes(): Promise<string[]> {
  const admin = createAdminClient();
  const ids: string[] = [];
  for (let inicio = 0; ; inicio += PAGE_SIZE) {
    const { data, error } = await admin
      .from("organizations")
      .select("id")
      .order("id")
      .range(inicio, inicio + PAGE_SIZE - 1);
    if (error) throw new Error(`falha ao listar organizações: ${error.message}`);
    const pagina = (data ?? []) as Array<{ id: string }>;
    ids.push(...pagina.map((row) => row.id));
    if (pagina.length < PAGE_SIZE) break;
  }
  return ids;
}

async function listarLeadsDaOrganizacao(organizationId: string): Promise<LeadSemContato[]> {
  const admin = createAdminClient();
  const leads: LeadSemContato[] = [];
  for (let inicio = 0; ; inicio += PAGE_SIZE) {
    const { data, error } = await admin
      .from("crm_leads")
      .select("id, organization_id, title, source_metadata")
      .eq("organization_id", organizationId)
      .is("contact_id", null)
      .not("source_metadata->>raw_phone", "is", null)
      .order("id")
      .range(inicio, inicio + PAGE_SIZE - 1);
    if (error) throw new Error(`falha ao listar leads da organização ${organizationId}: ${error.message}`);
    const pagina = (data ?? []) as LeadSemContato[];
    leads.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
  }
  return leads;
}

async function processarLead(
  lead: LeadSemContato,
  contadores: Contadores,
): Promise<void> {
  const plano = planejarRecuperacao(lead);
  contadores.candidatos += 1;
  if (!plano) {
    contadores.invalidos += 1;
    return;
  }
  contadores.validos += 1;
  const masked = telefoneMascarado(plano.phone);
  const admin = createAdminClient();

  if (!APLICAR) {
    const existente = await encontrarContatoPorTelefoneComNome(
      admin,
      plano.organizationId,
      plano.phone,
    );
    console.info(
      `  [dry-run] lead ${plano.leadId}: ${masked}, ${existente ? "reutilizaria contato" : "criaria contato"}`,
    );
    return;
  }

  const resolvido = await encontrarOuCriarContatoPorTelefone(admin, {
    organizationId: plano.organizationId,
    phone: plano.phone,
    name: nomeDoContatoRecuperado(lead.title, plano.phone),
    source: "webhook",
    sourceMetadata: {
      recovery_script: SCRIPT,
      recovered_from_lead_id: plano.leadId,
    },
  });
  if (!resolvido.contato) {
    contadores.falhas += 1;
    console.error(
      `  [falha] lead ${plano.leadId}: ${masked}, contato não resolvido (${resolvido.error?.code ?? "sem_codigo"})`,
    );
    return;
  }

  const novoTitulo = tituloDepoisDaRecuperacao(
    lead.title,
    resolvido.contato.name,
    plano.phone,
  );
  const patch = {
    contact_id: resolvido.contato.id,
    ...(novoTitulo ? { title: novoTitulo } : {}),
  };
  const { data: atualizado, error: updateError } = await admin
    .from("crm_leads")
    .update(patch)
    .eq("organization_id", plano.organizationId)
    .eq("id", plano.leadId)
    .is("contact_id", null)
    .select("id")
    .maybeSingle();
  if (updateError || !atualizado) {
    contadores.falhas += updateError ? 1 : 0;
    console.info(
      `  [sem alteração] lead ${plano.leadId}: ${masked}, ${updateError ? "falha no vínculo" : "já recuperado por outra execução"}`,
    );
    return;
  }

  contadores.vinculados += 1;
  const atividade = await emitLeadActivity(admin, {
    organizationId: plano.organizationId,
    leadId: plano.leadId,
    contactId: resolvido.contato.id,
    type: ATIVIDADE_CONTATO_RECUPERADO,
    sourceModule: "script",
    actor: { type: "webhook_source", id: `script:${SCRIPT}` },
    reason: "Contato recuperado a partir do telefone bruto preservado na captação.",
    payload: { contact_created: resolvido.criado, title_updated: novoTitulo !== null },
  });
  if (!atividade.ok) {
    console.error(`  [aviso] lead ${plano.leadId}: atividade não gravada`);
  }
  await audit({
    action: "lead.updated",
    organizationId: plano.organizationId,
    resourceType: "crm_lead",
    resourceId: plano.leadId,
    bypassedRls: true,
    metadata: {
      actor: `script:${SCRIPT}`,
      fields: novoTitulo ? ["contact_id", "title"] : ["contact_id"],
      contact_created: resolvido.criado,
    },
  });
  console.info(
    `  [aplicado] lead ${plano.leadId}: ${masked}, ${resolvido.criado ? "contato criado" : "contato reutilizado"}`,
  );
}

async function main(): Promise<void> {
  const total: Contadores = { candidatos: 0, validos: 0, invalidos: 0, vinculados: 0, falhas: 0 };
  console.info(APLICAR ? "MODO --aplicar: haverá escrita." : "DRY-RUN: nenhuma escrita será feita.");

  for (const organizationId of await listarOrganizacoes()) {
    const leads = await listarLeadsDaOrganizacao(organizationId);
    if (leads.length === 0) continue;
    console.info(`Organização ${organizationId}: ${leads.length} lead(s) candidato(s).`);
    for (const lead of leads) await processarLead(lead, total);
  }

  console.info(
    `Resumo: candidatos=${total.candidatos}, válidos=${total.validos}, inválidos=${total.invalidos}, ` +
      `vinculados=${total.vinculados}, falhas=${total.falhas}.`,
  );
}

void main().catch((error) => {
  console.error(`[${SCRIPT}] falha:`, error instanceof Error ? error.message : "erro desconhecido");
  process.exit(1);
});
