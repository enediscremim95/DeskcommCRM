/**
 * ESCALONAMENTO PÓS-LEMBRETE — "caso não confirme, escalar para o SDR humano".
 *
 * Opt-in por tipo de agendamento (`calendar_event_types.reminder_escalation_enabled`,
 * migration 0320, padrão DESLIGADO; espera `reminder_escalation_minutes`, padrão
 * 20). Roda dentro do cron `agenda-reminder` que já existe (a cada 5 min) — nada
 * de fila ou worker novo.
 *
 * ─── O que é "confirmou" ────────────────────────────────────────────────────
 *
 * QUALQUER mensagem recebida do contato (ou de um contato gêmeo pelo telefone)
 * depois do envio do lembrete (`reminder_sent_at`). Simples de propósito: um
 * "ok", um "estarei lá" ou uma pergunta sobre o link mostram que a pessoa viu
 * o lembrete e está na conversa — e aí a IA continua com ela. O lembrete só é
 * enviado a compromisso `confirmed`, então o status do compromisso não serve de
 * sinal de confirmação; ele só tira da régua o compromisso cancelado/remarcado.
 *
 * ─── O que acontece sem resposta ────────────────────────────────────────────
 *
 * 1. tarefa + aviso na Central para o SDR (`criarTarefaHumana`, a MESMA do nó
 *    "tarefa humana" do follow-up — mesma régua de responsável);
 * 2. `triggerHandoff` (caminho oficial): conversa `pending`, IA silenciada;
 * 3. carimbo `reminder_escalation_checked_at/_result` — UMA decisão por
 *    compromisso. Retry depois de crash antes do carimbo é seguro: a tarefa é
 *    única pela `source_key` e o handoff de uma conversa já silenciada não
 *    dispara de novo (gate de elegibilidade do orquestrador).
 *
 * Compromisso que já começou não escala (`not_applicable`): ligar para
 * confirmar presença de uma reunião em andamento não ajuda ninguém.
 *
 * ⚠️ `organization_id` SEMPRE da linha do compromisso, em toda leitura/escrita.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { idsDoContatoEGemeos } from "@/lib/channels/contato-por-telefone";
import { logger } from "@/lib/logger";
import { criarTarefaHumana } from "@/lib/tarefas/tarefa-humana";

export type DecisaoDoEscalonamento = "aguardar" | "confirmed" | "escalated" | "not_applicable";

const STATUS_VIVOS = new Set(["confirmed", "pending"]);
const LIMITE = 200;
/** Menor espera aceita pela coluna — o corte grosso da consulta. */
const MENOR_ESPERA_MS = 5 * 60_000;

/** A regra, pura. */
export function decidirEscalonamento(i: {
  agora: Date;
  lembreteEnviadoEm: Date;
  esperaMin: number;
  comecaEm: Date;
  status: string;
  respondeuDepois: boolean;
}): DecisaoDoEscalonamento {
  if (!STATUS_VIVOS.has(i.status)) return "not_applicable";
  if (i.respondeuDepois) return "confirmed";
  if (i.agora.getTime() < i.lembreteEnviadoEm.getTime() + i.esperaMin * 60_000) return "aguardar";
  if (i.comecaEm.getTime() <= i.agora.getTime()) return "not_applicable";
  return "escalated";
}

interface TipoDoEscalonamento {
  reminder_escalation_enabled: boolean;
  reminder_escalation_minutes: number;
}

interface CompromissoLembrado {
  id: string;
  organization_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  title: string;
  status: string;
  starts_at: string;
  time_zone?: string | null;
  reminder_sent_at: string;
  calendar_event_types: TipoDoEscalonamento | TipoDoEscalonamento[] | null;
}

export interface ResumoDoEscalonamento {
  examinados: number;
  escalados: number;
  confirmados: number;
  nao_aplicaveis: number;
  aguardando: number;
  erros: number;
}

export interface DepsDoEscalonamento {
  criarTarefa?: typeof criarTarefaHumana;
  handoff?: typeof triggerHandoff;
  gemeos?: typeof idsDoContatoEGemeos;
}

function tipoDe(l: CompromissoLembrado): TipoDoEscalonamento | null {
  const t = l.calendar_event_types;
  if (!t) return null;
  return Array.isArray(t) ? (t[0] ?? null) : t;
}

async function respondeuDepoisDoLembrete(
  admin: SupabaseClient,
  l: CompromissoLembrado,
  gemeos: typeof idsDoContatoEGemeos,
): Promise<boolean> {
  if (!l.contact_id) return false;
  const ids = await gemeos(admin, l.organization_id, l.contact_id);
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", l.organization_id)
    .in("contact_id", ids)
    .eq("direction", "inbound")
    .gt("sent_at", l.reminder_sent_at)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function carimbar(
  admin: SupabaseClient,
  l: CompromissoLembrado,
  resultado: Exclude<DecisaoDoEscalonamento, "aguardar">,
  agora: Date,
): Promise<void> {
  const { error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_checked_at: agora.toISOString(), reminder_escalation_result: resultado })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .is("reminder_escalation_checked_at", null);
  if (error) throw new Error(error.message);
}

export async function escalonarLembretesSemResposta(
  admin: SupabaseClient,
  agora: Date,
  deps: DepsDoEscalonamento = {},
): Promise<ResumoDoEscalonamento> {
  const criarTarefa = deps.criarTarefa ?? criarTarefaHumana;
  const handoff = deps.handoff ?? triggerHandoff;
  const gemeos = deps.gemeos ?? idsDoContatoEGemeos;
  const resumo: ResumoDoEscalonamento = {
    examinados: 0,
    escalados: 0,
    confirmados: 0,
    nao_aplicaveis: 0,
    aguardando: 0,
    erros: 0,
  };

  const { data, error } = await admin
    .from("calendar_appointments")
    .select(
      "id, organization_id, contact_id, conversation_id, title, status, starts_at, time_zone, reminder_sent_at, " +
        "calendar_event_types!inner(reminder_escalation_enabled, reminder_escalation_minutes)",
    )
    .eq("calendar_event_types.reminder_escalation_enabled", true)
    .not("reminder_sent_at", "is", null)
    .is("reminder_escalation_checked_at", null)
    .lte("reminder_sent_at", new Date(agora.getTime() - MENOR_ESPERA_MS).toISOString())
    .gt("starts_at", new Date(agora.getTime() - 86_400_000).toISOString())
    .order("reminder_sent_at", { ascending: true })
    .limit(LIMITE);
  if (error) {
    logger.error("[agenda-reminder] consulta do escalonamento falhou", { error: error.message });
    resumo.erros += 1;
    return resumo;
  }

  for (const l of (data ?? []) as unknown as CompromissoLembrado[]) {
    const tipo = tipoDe(l);
    if (!tipo?.reminder_escalation_enabled) continue;
    resumo.examinados += 1;
    try {
      const decisao = decidirEscalonamento({
        agora,
        lembreteEnviadoEm: new Date(l.reminder_sent_at),
        esperaMin: Number(tipo.reminder_escalation_minutes ?? 20),
        comecaEm: new Date(l.starts_at),
        status: l.status,
        respondeuDepois: await respondeuDepoisDoLembrete(admin, l, gemeos),
      });
      if (decisao === "aguardar") {
        resumo.aguardando += 1;
        continue;
      }
      if (decisao === "escalated") {
        const org = l.organization_id;
        let nome: string | null = null;
        if (l.contact_id) {
          const { data: contato } = await admin
            .from("contacts")
            .select("name, display_name")
            .eq("organization_id", org)
            .eq("id", l.contact_id)
            .maybeSingle();
          nome = (contato as { display_name?: string | null; name?: string | null } | null)?.display_name
            ?? (contato as { name?: string | null } | null)?.name
            ?? null;
        }
        const tarefa = await criarTarefa(admin, {
          organizationId: org,
          sourceKey: `agenda:${l.id}:lembrete_sem_confirmacao`,
          title: `Ligar para ${nome?.trim() || "o cliente"} e confirmar presença em "${l.title}"`.slice(0, 200),
          description:
            "O cliente não respondeu ao lembrete da reunião. Ligue; se não atender, mande mensagem. " +
            "Confirme a presença e registre o resultado.",
          priority: "urgent",
          dueAt: new Date(l.starts_at),
          contactId: l.contact_id,
          conversationId: l.conversation_id,
          tituloDoAviso: "Cliente não confirmou a reunião depois do lembrete",
        });
        const conversa = tarefa.conversationId ?? l.conversation_id;
        if (conversa) {
          const r = await handoff({
            conversationId: conversa,
            organizationId: org,
            reason: "lembrete_sem_confirmacao",
            leadId: tarefa.leadId,
            metadata: { source: "agenda_reminder_escalation", appointment_id: l.id, task_id: tarefa.taskId },
          });
          if (!r.triggered) {
            // Conversa já com pessoa / IA já silenciada: a tarefa e o aviso bastam.
            logger.info("[agenda-reminder] escalonamento sem handoff", { appointmentId: l.id, motivo: r.reason });
          }
        }
        await carimbar(admin, l, "escalated", agora);
        resumo.escalados += 1;
        continue;
      }
      await carimbar(admin, l, decisao, agora);
      if (decisao === "confirmed") resumo.confirmados += 1;
      else resumo.nao_aplicaveis += 1;
    } catch (err) {
      resumo.erros += 1;
      logger.error("[agenda-reminder] escalonamento falhou; tenta na próxima rodada", {
        appointmentId: l.id,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }
  return resumo;
}
