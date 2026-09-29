import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { emitLeadActivity } from "./activity-emitter";
import {
  minutosDaJanelaDeReenvio,
} from "./janela-de-reenvio-config";

/**
 * O primeiro corte medido em produção que separa o bloco curto do bloco diário.
 * Até 1 hora havia 63 pares; acima dela havia 56, distribuídos de horas a dias.
 * O valor não tenta adivinhar intenção depois desse corte e pode ser afinado por
 * organização em Configurações da empresa.
 */
export const INDICE_JANELA_REENVIO = "uniq_crm_leads_reentry_guard";
export const CHAVE_REENVIO_CANAL_INBOUND = "canal:inbound";

export function chaveDaJanelaDaFonte(
  sourceId: string,
  mergeRepeatedSubmissions: boolean,
): string | null {
  return mergeRepeatedSubmissions ? `fonte:${sourceId}` : null;
}

interface PrepararEntradaArgs {
  organizationId: string;
  contactId: string;
  guardKey: string;
  agora?: Date;
  /** Ponto de sincronização usado pelo invariante de concorrência real. */
  depoisDaLeitura?: () => Promise<void>;
}

export type EntradaNaJanela =
  | { existente: true; leadId: string; minutos: number }
  | { existente: false; guardUntil: string; guardKey: string; minutos: number };

async function configuracaoDaJanela(db: SupabaseClient, organizationId: string): Promise<number> {
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`janela_reenvio_config: ${error.message}`);
  return minutosDaJanelaDeReenvio(data?.settings);
}

/**
 * Lê o card recente e prepara a trava da tentativa de INSERT.
 *
 * A leitura sozinha não decide a corrida. O índice parcial no banco deixa
 * exatamente uma tentativa com `reentry_guard_until` vencer; as demais relêem
 * esse vencedor. Cards mais antigos continuam abertos e válidos.
 */
export async function prepararEntradaNaJanela(
  db: SupabaseClient,
  args: PrepararEntradaArgs,
): Promise<EntradaNaJanela> {
  const agora = args.agora ?? new Date();
  const minutos = await configuracaoDaJanela(db, args.organizationId);
  const corte = new Date(agora.getTime() - minutos * 60_000).toISOString();

  const { error: liberarErro } = await db
    .from("crm_leads")
    .update({ reentry_guard_until: null })
    .eq("organization_id", args.organizationId)
    .eq("contact_id", args.contactId)
    .eq("reentry_guard_key", args.guardKey)
    .eq("status", "open")
    .lte("reentry_guard_until", agora.toISOString());
  if (liberarErro) throw new Error(`janela_reenvio_liberar: ${liberarErro.message}`);

  const { data: recente, error: recenteErro } = await db
    .from("crm_leads")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("contact_id", args.contactId)
    .eq("reentry_guard_key", args.guardKey)
    .eq("status", "open")
    .gte("created_at", corte)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recenteErro) throw new Error(`janela_reenvio_buscar: ${recenteErro.message}`);
  if (recente) return { existente: true, leadId: recente.id as string, minutos };

  await args.depoisDaLeitura?.();
  return {
    existente: false,
    guardUntil: new Date(agora.getTime() + minutos * 60_000).toISOString(),
    guardKey: args.guardKey,
    minutos,
  };
}

export async function buscarVencedorDaJanela(
  db: SupabaseClient,
  args: Pick<PrepararEntradaArgs, "organizationId" | "contactId" | "guardKey">,
): Promise<string | null> {
  const minutos = await configuracaoDaJanela(db, args.organizationId);
  const corte = new Date(Date.now() - minutos * 60_000).toISOString();
  const { data, error } = await db
    .from("crm_leads")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("contact_id", args.contactId)
    .eq("reentry_guard_key", args.guardKey)
    .eq("status", "open")
    .gte("created_at", corte)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`janela_reenvio_vencedor: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

export function ehColisaoDaJanela(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; details?: string };
  const texto = `${e.message ?? ""} ${e.details ?? ""}`;
  return (e.code === "23505" || texto.includes("duplicate key")) && texto.includes(INDICE_JANELA_REENVIO);
}

interface AlimentarLeadArgs {
  organizationId: string;
  leadId: string;
  contactId: string;
  sourceModule: string;
  sourceId: string;
  reason: string;
  actor: { type: "webhook_source"; id: string };
  customFields?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
  tags?: string[];
  payload?: Record<string, unknown>;
}

/** Atualiza os dados úteis da nova entrada e deixa o fato visível na timeline. */
export async function alimentarLeadExistente(
  db: SupabaseClient,
  args: AlimentarLeadArgs,
): Promise<Record<string, unknown>> {
  const { data: atual, error: leituraErro } = await db
    .from("crm_leads")
    .select("*")
    .eq("organization_id", args.organizationId)
    .eq("id", args.leadId)
    .eq("contact_id", args.contactId)
    .eq("status", "open")
    .maybeSingle();
  if (leituraErro || !atual) {
    throw new Error(`janela_reenvio_alimentar_leitura: ${leituraErro?.message ?? "lead não encontrado"}`);
  }

  const tags = Array.from(
    new Set([...(Array.isArray(atual.tags) ? (atual.tags as string[]) : []), ...(args.tags ?? [])]),
  );
  const { data: atualizado, error: atualizarErro } = await db
    .from("crm_leads")
    .update({
      custom_fields: {
        ...((atual.custom_fields as Record<string, unknown> | null) ?? {}),
        ...(args.customFields ?? {}),
      },
      source_metadata: {
        ...((atual.source_metadata as Record<string, unknown> | null) ?? {}),
        ...(args.sourceMetadata ?? {}),
      },
      tags,
    })
    .eq("organization_id", args.organizationId)
    .eq("id", args.leadId)
    .select("*")
    .maybeSingle();
  if (atualizarErro || !atualizado) {
    throw new Error(`janela_reenvio_alimentar_escrita: ${atualizarErro?.message ?? "lead não atualizado"}`);
  }

  const atividade = await emitLeadActivity(db, {
    organizationId: args.organizationId,
    leadId: args.leadId,
    contactId: args.contactId,
    type: "lead_merged",
    sourceModule: args.sourceModule,
    sourceId: args.sourceId,
    actor: args.actor,
    reason: args.reason,
    payload: args.payload ?? {},
  });
  if (!atividade.ok) {
    logger.warn("janela-de-reenvio: atividade não registrada", {
      organization_id: args.organizationId,
      lead_id: args.leadId,
      error: atividade.error?.slice(0, 120),
    });
  }
  return atualizado as Record<string, unknown>;
}
