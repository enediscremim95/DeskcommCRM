import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export const JANELA_SEM_LEAD_MS = 48 * 60 * 60 * 1000;
export const KIND_FONTE_SEM_LEAD = "webhook_source_silent" as const;

interface FonteVigiada {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  last_received_at: string;
}

interface AvisoDaFonte {
  id: string;
  organization_id: string;
  ref_id: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function fontePassouDaJanela(fonte: FonteVigiada, agora: Date): boolean {
  const ultimo = Date.parse(fonte.last_received_at);
  return fonte.is_active && Number.isFinite(ultimo) && agora.getTime() - ultimo >= JANELA_SEM_LEAD_MS;
}

export async function vigiarFontesSemLead(
  admin: SupabaseClient,
  agora = new Date(),
): Promise<{ fontes: number; avisos_abertos: number; avisos_resolvidos: number; erros: number }> {
  const resultado = { fontes: 0, avisos_abertos: 0, avisos_resolvidos: 0, erros: 0 };
  const lista: FonteVigiada[] = [];
  const tamanhoDaPagina = 1_000;
  for (let inicio = 0; ; inicio += tamanhoDaPagina) {
    const { data, error } = await admin
      .from("webhook_sources")
      .select("id, organization_id, name, is_active, last_received_at")
      .not("last_received_at", "is", null)
      .order("id", { ascending: true })
      .range(inicio, inicio + tamanhoDaPagina - 1);
    if (error) {
      logger.error("[webhook-source-health] não foi possível listar as fontes", {
        detail: error.message,
      });
      return { ...resultado, erros: 1 };
    }
    const pagina = (data ?? []) as unknown as FonteVigiada[];
    lista.push(...pagina);
    if (pagina.length < tamanhoDaPagina) break;
  }

  resultado.fontes = lista.length;
  if (lista.length === 0) return resultado;

  const ids = lista.map((fonte) => fonte.id);
  const avisos: AvisoDaFonte[] = [];
  for (let inicio = 0; inicio < ids.length; inicio += 200) {
    const { data, error } = await admin
      .from("agent_inbox_items")
      .select("id, organization_id, ref_id, status, metadata, created_at")
      .eq("kind", KIND_FONTE_SEM_LEAD)
      .eq("ref_kind", "webhook_source")
      .in("ref_id", ids.slice(inicio, inicio + 200))
      .order("created_at", { ascending: false });
    if (error) {
      logger.error("[webhook-source-health] não foi possível ler os avisos", {
        detail: error.message,
      });
      return { ...resultado, erros: 1 };
    }
    avisos.push(...((data ?? []) as unknown as AvisoDaFonte[]));
  }

  const porFonte = new Map<string, AvisoDaFonte[]>();
  for (const aviso of avisos) {
    if (!aviso.ref_id) continue;
    const atuais = porFonte.get(aviso.ref_id) ?? [];
    atuais.push(aviso);
    porFonte.set(aviso.ref_id, atuais);
  }

  for (const fonte of lista) {
    const relacionados = porFonte.get(fonte.id) ?? [];
    const abertos = relacionados.filter((aviso) => aviso.status === "open");
    const precisaAvisar = fontePassouDaJanela(fonte, agora);

    if (!precisaAvisar) {
      if (abertos.length === 0) continue;
      const { error } = await admin
        .from("agent_inbox_items")
        .update({ status: "resolved" })
        .eq("organization_id", fonte.organization_id)
        .eq("kind", KIND_FONTE_SEM_LEAD)
        .in("id", abertos.map((aviso) => aviso.id));
      if (error) resultado.erros += 1;
      else resultado.avisos_resolvidos += abertos.length;
      continue;
    }

    if (abertos.length > 0) continue;
    const ultimoEpisodio = relacionados[0]?.metadata?.last_received_at;
    if (ultimoEpisodio === fonte.last_received_at) continue;

    const { error } = await admin.from("agent_inbox_items").insert({
      organization_id: fonte.organization_id,
      kind: KIND_FONTE_SEM_LEAD,
      severity: "critical",
      title: fonte.name,
      ref_kind: "webhook_source",
      ref_id: fonte.id,
      metadata: {
        origem: "webhook_source_health",
        last_received_at: fonte.last_received_at,
        janela_horas: 48,
      },
    });
    if (error?.code === "23505") continue;
    if (error) resultado.erros += 1;
    else resultado.avisos_abertos += 1;
  }

  return resultado;
}
