/**
 * TAREFA HUMANA — o trabalho que o automático passa para uma PESSOA da equipe.
 *
 * Nasce para a cadência do "SDR humano" (toques 2 e 4 da régua: ligar e, se
 * não atender, mandar WhatsApp) e para o escalonamento do lembrete de reunião
 * sem confirmação. Os dois caminhos chamam ESTA função — uma régua só para
 * "quem recebe" e uma só para "não duplicar".
 *
 * ─── Quem recebe (`escolherResponsavel`, pura) ──────────────────────────────
 *
 *   1. quem está atribuído à CONVERSA (`conversations.assigned_to_user_id`);
 *   2. quem responde pelo NÚMERO (`channel_routing_responsibles` da política do
 *      canal da conversa) — é o "SDR humano que já atende no número";
 *   3. o DONO DO NEGÓCIO (`crm_leads.owner_user_id`);
 *   4. a primeira pessoa ADMIN da organização (mais antiga).
 *
 * Em todos os degraus só vale membro ATIVO (sem `revoked_at`) com papel agent+.
 * Ninguém elegível = a tarefa nasce sem responsável e o aviso na Central
 * continua saindo: sumir com o trabalho é pior que deixá-lo sem dono.
 *
 * ─── Não duplicar (`source_key`, migration 0320) ────────────────────────────
 *
 * O chamador passa uma chave estável do FATO que pede a tarefa (passo do fluxo,
 * compromisso escalado). O índice único `(organization_id, source_key)` faz o
 * retry cair em 23505, e aí a tarefa existente é devolvida. O aviso na Central
 * tem chave única própria (`agent_inbox_items.dedupe_key = crm_task:<id>`), e
 * `alerted_at` é só o atalho para não tentar de novo: retry depois de um crash
 * entre a tarefa e o aviso abre o aviso que faltou, e corrida entre duas
 * rodadas cai em 23505 — nunca um segundo aviso.
 *
 * ⚠️ `organization_id` vem SEMPRE do chamador confiável (enrollment, linha do
 * compromisso) e filtra TODA leitura e escrita — service role não tem RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLE_RANK, type Role } from "@/lib/auth/types";

import type { PrioridadeDaTarefa } from "./tipos";

export type OrigemDoResponsavel =
  | "atendente_da_conversa"
  | "responsavel_do_numero"
  | "dono_do_negocio"
  | "administrador"
  | "sem_responsavel";

export interface MembroAtivo {
  userId: string;
  papel: Role;
  /** ISO de `user_organizations.created_at` — desempate do degrau "admin mais antigo". */
  desde: string;
}

export interface FatosDoResponsavel {
  membros: MembroAtivo[];
  atendenteDaConversa: string | null;
  responsaveisDoNumero: string[];
  donoDoNegocio: string | null;
}

/** A régua, pura: primeiro degrau com membro ativo agent+ vence. */
export function escolherResponsavel(f: FatosDoResponsavel): {
  userId: string | null;
  origem: OrigemDoResponsavel;
} {
  const elegiveis = new Set(
    f.membros.filter((m) => ROLE_RANK[m.papel] >= ROLE_RANK.agent).map((m) => m.userId),
  );
  if (f.atendenteDaConversa && elegiveis.has(f.atendenteDaConversa)) {
    return { userId: f.atendenteDaConversa, origem: "atendente_da_conversa" };
  }
  const doNumero = f.responsaveisDoNumero.find((id) => elegiveis.has(id));
  if (doNumero) return { userId: doNumero, origem: "responsavel_do_numero" };
  if (f.donoDoNegocio && elegiveis.has(f.donoDoNegocio)) {
    return { userId: f.donoDoNegocio, origem: "dono_do_negocio" };
  }
  const admin = f.membros
    .filter((m) => m.papel === "admin")
    .sort((a, b) => a.desde.localeCompare(b.desde))[0];
  if (admin) return { userId: admin.userId, origem: "administrador" };
  return { userId: null, origem: "sem_responsavel" };
}

/** `{{nome}}` → nome do contato. Sem nome, "o contato" — "Ligar para " solto não diz nada. */
export function interpolarTarefa(texto: string, nomeDoContato: string | null | undefined): string {
  const nome = nomeDoContato?.trim() || "o contato";
  // Callback, não string: `replaceAll(x, "str")` interpreta `$&`, `$'`, `$$`
  // dentro do NOME do contato — que é dado de terceiro.
  return texto.replaceAll("{{nome}}", () => nome);
}

export interface NovaTarefaHumana {
  organizationId: string;
  /** Chave estável do fato que pede a tarefa — ver o cabeçalho. */
  sourceKey: string;
  title: string;
  description?: string | null;
  priority?: PrioridadeDaTarefa;
  dueAt?: Date | null;
  contactId: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  /** Título do aviso na Central (o corpo leva o título da tarefa e o responsável). */
  tituloDoAviso: string;
}

export interface ResultadoTarefaHumana {
  taskId: string;
  criada: boolean;
  avisoAberto: boolean;
  assignedTo: string | null;
  origem: OrigemDoResponsavel;
  leadId: string | null;
  conversationId: string | null;
}

async function carregarFatos(
  admin: SupabaseClient,
  input: NovaTarefaHumana,
): Promise<FatosDoResponsavel & { leadId: string | null; conversationId: string | null }> {
  const org = input.organizationId;

  let conversa: { id: string; assigned_to_user_id: string | null; channel_session_id: string | null } | null =
    null;
  if (input.conversationId) {
    const { data, error } = await admin
      .from("conversations")
      .select("id, assigned_to_user_id, channel_session_id")
      .eq("organization_id", org)
      .eq("id", input.conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    conversa = data;
  } else if (input.contactId) {
    const { data, error } = await admin
      .from("conversations")
      .select("id, assigned_to_user_id, channel_session_id")
      .eq("organization_id", org)
      .eq("contact_id", input.contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    conversa = data;
  }

  let responsaveisDoNumero: string[] = [];
  if (conversa?.channel_session_id) {
    const { data: politica, error } = await admin
      .from("channel_routing_policies")
      .select("id")
      .eq("organization_id", org)
      .eq("channel_session_id", conversa.channel_session_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (politica) {
      const { data: resp, error: rErr } = await admin
        .from("channel_routing_responsibles")
        .select("user_id, created_at")
        .eq("organization_id", org)
        .eq("policy_id", politica.id)
        .order("created_at", { ascending: true });
      if (rErr) throw new Error(rErr.message);
      responsaveisDoNumero = (resp ?? []).map((r) => String(r.user_id));
    }
  }

  let leadId = input.leadId ?? null;
  let donoDoNegocio: string | null = null;
  if (leadId || input.contactId) {
    let q = admin.from("crm_leads").select("id, owner_user_id").eq("organization_id", org);
    q = leadId ? q.eq("id", leadId) : q.eq("contact_id", input.contactId!).eq("status", "open");
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    leadId = data?.id ?? null;
    donoDoNegocio = data?.owner_user_id ?? null;
  }

  const { data: membros, error: mErr } = await admin
    .from("user_organizations")
    .select("user_id, role, created_at")
    .eq("organization_id", org)
    .is("revoked_at", null);
  if (mErr) throw new Error(mErr.message);

  return {
    membros: (membros ?? []).map((m) => ({
      userId: String(m.user_id),
      papel: m.role as Role,
      desde: String(m.created_at),
    })),
    atendenteDaConversa: conversa?.assigned_to_user_id ?? null,
    responsaveisDoNumero,
    donoDoNegocio,
    leadId,
    conversationId: conversa?.id ?? null,
  };
}

const ROTULO_DA_ORIGEM: Record<OrigemDoResponsavel, string> = {
  atendente_da_conversa: "quem atende a conversa",
  responsavel_do_numero: "responsável pelo número",
  dono_do_negocio: "dono do negócio",
  administrador: "administração da organização",
  sem_responsavel: "ninguém elegível, defina um responsável",
};

/**
 * Cria (ou reencontra) a tarefa e garante o aviso. Lança em falha de banco —
 * o chamador decide o retry (o motor do fluxo usa o backoff dele; o cron tenta
 * de novo na rodada seguinte). A chave torna o retry seguro.
 */
export async function criarTarefaHumana(
  admin: SupabaseClient,
  input: NovaTarefaHumana,
): Promise<ResultadoTarefaHumana> {
  const org = input.organizationId;

  const { data: existente, error: exErr } = await admin
    .from("crm_tasks")
    .select("id, assigned_to, alerted_at, lead_id")
    .eq("organization_id", org)
    .eq("source_key", input.sourceKey)
    .maybeSingle();
  if (exErr) throw new Error(exErr.message);

  const fatos = await carregarFatos(admin, input);
  const escolha = escolherResponsavel(fatos);

  let taskId: string;
  let criada = false;
  let alertedAt: string | null = null;
  let assignedTo = escolha.userId;

  if (existente) {
    taskId = existente.id;
    alertedAt = existente.alerted_at ?? null;
    assignedTo = existente.assigned_to ?? null;
  } else {
    const { data: nova, error } = await admin
      .from("crm_tasks")
      .insert({
        organization_id: org,
        title: input.title.slice(0, 200),
        description: input.description ?? null,
        priority: input.priority ?? "high",
        status: "pending",
        due_date: input.dueAt ? input.dueAt.toISOString() : null,
        contact_id: input.contactId,
        lead_id: fatos.leadId,
        assigned_to: escolha.userId,
        created_by: null,
        source_key: input.sourceKey,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code !== "23505") throw new Error(error.message);
      // Corrida com outro executor do mesmo passo: a tarefa dele vale.
      const { data: vencedora, error: vErr } = await admin
        .from("crm_tasks")
        .select("id, assigned_to, alerted_at")
        .eq("organization_id", org)
        .eq("source_key", input.sourceKey)
        .single();
      if (vErr) throw new Error(vErr.message);
      taskId = vencedora.id;
      alertedAt = vencedora.alerted_at ?? null;
      assignedTo = vencedora.assigned_to ?? null;
    } else {
      taskId = nova.id;
      criada = true;
    }
  }

  let avisoAberto = false;
  if (!alertedAt) {
    const ref = fatos.conversationId
      ? { ref_kind: "conversation", ref_id: fatos.conversationId }
      : input.contactId
        ? { ref_kind: "contact", ref_id: input.contactId }
        : { ref_kind: null, ref_id: null };
    const corpo =
      `${input.title.slice(0, 200)}. Responsável: ${ROTULO_DA_ORIGEM[escolha.origem]}. ` +
      "A tarefa está em Tarefas; nenhuma mensagem foi enviada ao contato por este passo.";
    // `dedupe_key` única por organização (migration 0320): duas rodadas
    // concorrentes, ou um retry depois de crash entre o aviso e o `alerted_at`,
    // caem em 23505 em vez de abrir um segundo aviso.
    const { error: avisoErr } = await admin.from("agent_inbox_items").insert({
      organization_id: org,
      kind: "human_task",
      severity: "warn",
      title: input.tituloDoAviso,
      body: corpo,
      dedupe_key: `crm_task:${taskId}`,
      ...ref,
    });
    if (avisoErr && avisoErr.code !== "23505") throw new Error(avisoErr.message);
    const { error: marcaErr } = await admin
      .from("crm_tasks")
      .update({ alerted_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("id", taskId);
    if (marcaErr) throw new Error(marcaErr.message);
    avisoAberto = !avisoErr;
  }

  return {
    taskId,
    criada,
    avisoAberto,
    assignedTo,
    origem: existente ? (assignedTo ? escolha.origem : "sem_responsavel") : escolha.origem,
    leadId: fatos.leadId,
    conversationId: fatos.conversationId,
  };
}
