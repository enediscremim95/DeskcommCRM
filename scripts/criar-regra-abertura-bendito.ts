/**
 * Prepara a abertura automática da Vitória para leads de formulário da Bendito.
 *
 * Uso:
 *   npx tsx scripts/criar-regra-abertura-bendito.ts
 *   npx tsx scripts/criar-regra-abertura-bendito.ts --aplicar
 *   npx tsx scripts/criar-regra-abertura-bendito.ts --desfazer --aplicar
 *
 * Sem --aplicar, faz somente leituras. O script nunca liga a regra nem envia
 * mensagem.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { evaluateConditions, type RuleCondition } from "@/lib/automation/conditions";
import { createAutomationRuleSchema } from "@/lib/schemas/webhooks";

export const BENDITO_ORG_ID = "4db279eb-55d6-44a3-870f-9909f19f8b87";
export const BENDITO_CHANNEL_SESSION_ID = "7d0d84bf-8f4e-4d8b-b3b4-c4b7deb7d244";
export const NOME_REGRA_ABERTURA_BENDITO = "Abertura da Vitória para lead de formulário";
export const TEMPLATE_ABERTURA_BENDITO =
  "Olá, {{nome}}! Tudo bem? 😊\n\nAqui é a Vitória, da equipe de expansão da Bendito Ponto. Recebi seu cadastro e seu interesse em conhecer melhor a nossa franquia.\n\nPara começarmos, em qual cidade e estado você pretende abrir uma unidade?";

const CONDICAO_ORIGEM: RuleCondition = {
  field: "lead.source",
  op: "neq",
  value: "whatsapp",
};

export interface LeadRecenteDaBendito {
  id: string;
  source: string | null;
  source_metadata: Record<string, unknown> | null;
  created_at: string;
}

interface Argumentos {
  aplicar: boolean;
  desfazer: boolean;
  organizationId: string;
}

interface Saida {
  escrever(texto: string): void;
  avisar(texto: string): void;
}

export function validarOrganizacaoBendito(organizationId: string): void {
  if (organizationId !== BENDITO_ORG_ID) {
    throw new Error(`TRAVA DE ORGANIZAÇÃO: esperado ${BENDITO_ORG_ID}, recebido ${organizationId}`);
  }
}

/** UUID v5 determinístico para a única regra criada por este script. */
export function idRegraAberturaBendito(organizationId: string): string {
  validarOrganizacaoBendito(organizationId);
  const bytes = createHash("sha1")
    .update(`automation:abertura-bendito:v1:${organizationId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function montarRegraAberturaBendito(organizationId: string) {
  validarOrganizacaoBendito(organizationId);
  const configuracao = createAutomationRuleSchema.parse({
    name: NOME_REGRA_ABERTURA_BENDITO,
    trigger_event: "lead.created",
    conditions: [CONDICAO_ORIGEM],
    actions: [
      {
        type: "send_whatsapp_message",
        config: {
          channel_session_id: BENDITO_CHANNEL_SESSION_ID,
          template: TEMPLATE_ABERTURA_BENDITO,
        },
      },
    ],
  });
  return {
    id: idRegraAberturaBendito(organizationId),
    organization_id: organizationId,
    created_by_user_id: null,
    ...configuracao,
    is_active: false,
  } as const;
}

export function leadCasariaNaAbertura(lead: Pick<LeadRecenteDaBendito, "source">): boolean {
  return evaluateConditions([CONDICAO_ORIGEM], { lead });
}

function origemLegivel(lead: LeadRecenteDaBendito): string {
  const detalhe = lead.source_metadata?.origem;
  if (typeof detalhe === "string" && detalhe.trim()) {
    return `${lead.source ?? "não informada"} (${detalhe.trim()})`;
  }
  return lead.source ?? "não informada";
}

function argumentos(argv: string[]): Argumentos {
  let aplicar = false;
  let desfazer = false;
  let organizationId = BENDITO_ORG_ID;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--aplicar") {
      aplicar = true;
    } else if (arg === "--desfazer") {
      desfazer = true;
    } else if (arg === "--org") {
      const valor = argv[index + 1];
      if (!valor) throw new Error("--org exige um UUID");
      organizationId = valor;
      index += 1;
    } else if (arg.startsWith("--org=")) {
      organizationId = arg.slice("--org=".length);
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  validarOrganizacaoBendito(organizationId);
  return { aplicar, desfazer, organizationId };
}

async function listarLeadsRecentes(
  admin: SupabaseClient,
  organizationId: string,
  agora: Date = new Date(),
): Promise<LeadRecenteDaBendito[]> {
  const desde = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("crm_leads")
    .select("id, source, source_metadata, created_at")
    .eq("organization_id", organizationId)
    .gte("created_at", desde)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listar leads recentes: ${error.message}`);
  return (data ?? []) as LeadRecenteDaBendito[];
}

async function localizarRegra(admin: SupabaseClient, organizationId: string) {
  const id = idRegraAberturaBendito(organizationId);
  const { data, error } = await admin
    .from("automation_rules")
    .select(
      "id, organization_id, created_by_user_id, name, trigger_event, conditions, actions, is_active",
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`localizar regra: ${error.message}`);
  return data;
}

function conferirRegraExistente(
  existente: Record<string, unknown>,
  esperada: ReturnType<typeof montarRegraAberturaBendito>,
): void {
  if (!isDeepStrictEqual(existente, esperada)) {
    throw new Error(
      "A regra determinística já existe com configuração diferente. Nada foi alterado.",
    );
  }
}

async function auditarMutacao(
  admin: SupabaseClient,
  action: "automation.rule_created" | "automation.rule_deleted",
  organizationId: string,
  ruleId: string,
  saida: Saida,
): Promise<void> {
  const { error } = await admin.from("api_audit_log").insert({
    action,
    organization_id: organizationId,
    resource_type: "automation_rule",
    resource_id: ruleId,
    request_id: `script:criar-regra-abertura-bendito:${Date.now()}`,
    bypassed_rls: true,
    metadata: {
      script: "criar-regra-abertura-bendito",
      name: NOME_REGRA_ABERTURA_BENDITO,
      trigger_event: "lead.created",
    },
  });
  if (error) {
    saida.avisar(`AVISO: a mutação ocorreu, mas a auditoria falhou: ${error.message}`);
  }
}

async function aplicarRegra(
  admin: SupabaseClient,
  organizationId: string,
  saida: Saida,
): Promise<void> {
  const regra = montarRegraAberturaBendito(organizationId);
  const existente = await localizarRegra(admin, organizationId);
  if (existente) {
    conferirRegraExistente(existente as Record<string, unknown>, regra);
    saida.escrever(`Regra já existe, sem alteração: ${regra.id}`);
    return;
  }

  const { error } = await admin.from("automation_rules").insert(regra);
  if (error) throw new Error(`criar regra: ${error.message}`);

  const gravada = await localizarRegra(admin, organizationId);
  if (!gravada) throw new Error("criar regra: a leitura posterior não encontrou a linha");
  conferirRegraExistente(gravada as Record<string, unknown>, regra);
  await auditarMutacao(admin, "automation.rule_created", organizationId, regra.id, saida);
  saida.escrever(`Regra criada desligada: ${regra.id}`);
}

async function desfazerRegra(
  admin: SupabaseClient,
  organizationId: string,
  saida: Saida,
): Promise<void> {
  const regra = montarRegraAberturaBendito(organizationId);
  const existente = await localizarRegra(admin, organizationId);
  if (!existente) {
    saida.escrever(`Regra já estava ausente: ${regra.id}`);
    return;
  }

  const { error } = await admin
    .from("automation_rules")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", regra.id);
  if (error) throw new Error(`apagar regra: ${error.message}`);

  const remanescente = await localizarRegra(admin, organizationId);
  if (remanescente) throw new Error("apagar regra: a leitura posterior ainda encontrou a linha");
  await auditarMutacao(admin, "automation.rule_deleted", organizationId, regra.id, saida);
  saida.escrever(`Regra removida: ${regra.id}`);
}

async function simular(admin: SupabaseClient, args: Argumentos, saida: Saida): Promise<void> {
  const regra = montarRegraAberturaBendito(args.organizationId);
  saida.escrever(
    args.desfazer
      ? "SIMULAÇÃO: a regra abaixo seria removida."
      : "SIMULAÇÃO: a regra abaixo seria criada desligada.",
  );
  saida.escrever(JSON.stringify(regra, null, 2));

  const leads = (await listarLeadsRecentes(admin, args.organizationId)).filter(
    leadCasariaNaAbertura,
  );
  saida.escrever(`Leads dos últimos 7 dias que casariam: ${leads.length}`);
  for (const lead of leads) {
    saida.escrever(
      JSON.stringify({
        id: lead.id,
        origem: origemLegivel(lead),
        data: lead.created_at,
      }),
    );
  }
}

async function main(): Promise<void> {
  const args = argumentos(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ambiente do processo",
    );
  }

  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const saida: Saida = {
    escrever: (texto) => process.stdout.write(`${texto}\n`),
    avisar: (texto) => process.stderr.write(`${texto}\n`),
  };

  if (!args.aplicar) {
    await simular(admin, args, saida);
  } else if (args.desfazer) {
    await desfazerRegra(admin, args.organizationId, saida);
  } else {
    await aplicarRegra(admin, args.organizationId, saida);
  }
}

const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]!) === fileURLToPath(import.meta.url);
if (executadoDiretamente) {
  main().catch((erro: unknown) => {
    process.stderr.write(`ERRO SEGURO: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
  });
}
