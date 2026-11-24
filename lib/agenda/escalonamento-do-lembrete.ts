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
 * QUALQUER mensagem recebida NA CONVERSA EM QUE O LEMBRETE SAIU
 * (`reminder_conversation_id`) depois do envio. Simples de propósito: "ok",
 * "estarei lá" ou uma pergunta sobre o link mostram que a pessoa viu o lembrete
 * e está na conversa — e aí a IA continua com ela. Mensagem em outra conversa,
 * de outro número ou de outra organização não conta.
 *
 * ─── Quando o prazo começa ──────────────────────────────────────────────────
 *
 * Só depois de um envio que NÃO falhou, e contado a partir do ENVIO EFETIVO (o
 * maior entre o carimbo gravado depois do envio e o `sent_at` da mensagem),
 * nunca da posse: a mensagem do lembrete (`reminder_message_id`) precisa estar
 * `sent`/`delivered`/`read`. Respostas contam a partir do mesmo instante. `failed` =
 * `not_applicable` (não dá para cobrar resposta de quem não recebeu);
 * `queued`/`sending` = espera. Lembrete enviado antes desta versão (sem
 * `reminder_message_id`) = `not_applicable`: não há como provar que saiu.
 *
 * ─── Ordem e idempotência ───────────────────────────────────────────────────
 *
 * 1. corte barato (prazo ainda não venceu → nem toca no banco);
 * 2. POSSE ATÔMICA: `update … set reminder_escalation_claimed_at = agora where
 *    checked_at is null and claimed_at is null` devolvendo a linha. Quem não
 *    ganha a posse não faz nada. Posse velha (> 10 min, rodada que morreu) é
 *    liberada antes;
 * 3. RELEITURA depois da posse — compromisso, tipo (MESMA organização, ainda
 *    ligado), mensagem do lembrete e resposta. Cancelado, já começou, desligado
 *    ou respondeu → carimba sem efeito;
 * 4. efeitos: tarefa + aviso (`criarTarefaHumana`, chaves únicas) e
 *    `triggerHandoff` NA conversa do lembrete;
 * 5. carimbo `checked_at/_result` condicionado à posse.
 * Falha transitória (tarefa lançou, handoff `orchestrator_error` /
 * `elegibilidade_indeterminada`) devolve a posse SEM carimbar: a próxima rodada
 * tenta de novo, e a tarefa não duplica (`source_key`) nem o aviso
 * (`dedupe_key`). Limite conhecido: se o orquestrador falhar DEPOIS de avisar o
 * lead, o retry pode avisá-lo de novo — o handoff oficial não tem chave de envio.
 *
 * ─── Janela e justiça entre organizações ────────────────────────────────────
 *
 * Só entram compromissos que AINDA NÃO COMEÇARAM, ordenados pelo início mais
 * próximo (o mais urgente primeiro). Quem está esperando o envio sair (`queued`)
 * tira uma SONECA: a posse fica com prazo curto e a linha sai do lote até ela
 * vencer, em vez de voltar todo ciclo e ocupar a vez dos outros. E há um teto
 * por organização em cada rodada, para um tenant com fila presa não consumir o
 * lote inteiro.
 *
 * ─── As referências precisam fechar ─────────────────────────────────────────
 *
 * A mensagem `reminder_message_id` tem de ser OUTBOUND, da conversa
 * `reminder_conversation_id`, e essa conversa tem de ser do CONTATO do
 * compromisso — tudo na mesma organização. Qualquer elo solto = `not_applicable`
 * sem efeito: um handoff não pode cair na conversa de outra pessoa.
 *
 * ⚠️ `organization_id` SEMPRE da linha do compromisso, em toda leitura/escrita —
 * inclusive do TIPO: `event_type_id` tem FK só por `id`, então um vínculo
 * cruzado entre organizações não pode emprestar opt-in, prazo ou modelo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { logger } from "@/lib/logger";
import { criarTarefaHumana } from "@/lib/tarefas/tarefa-humana";

export type DecisaoDoEscalonamento = "aguardar" | "confirmed" | "escalated" | "not_applicable";

const STATUS_VIVOS = new Set(["confirmed", "pending"]);
const ENVIO_OK = new Set(["sent", "delivered", "read"]);
const ENVIO_EM_VOO = new Set(["queued", "sending", "pending"]);
/** Página da leitura dos tipos ligados — paginada, sem teto silencioso. */
const PAGINA_DE_TIPOS = 1000;
/** Teto por organização em cada rodada — ninguém consome o lote inteiro. */
const LIMITE_POR_ORG = 50;
/** Quanto tempo quem espera o envio (`queued`) fica fora do lote. */
const SONECA_MS = 5 * 60_000;
/** Posse mais velha que isto é de uma rodada que morreu. */
const LEASE_MS = 10 * 60_000;
/** Recusas do orquestrador que são infraestrutura, não estado: ficam para retry. */
const HANDOFF_TRANSITORIO = new Set(["orchestrator_error", "elegibilidade_indeterminada"]);

/** A regra, pura. `envio` é o status da mensagem do lembrete (null = desconhecido). */
export function decidirEscalonamento(i: {
  agora: Date;
  lembreteEnviadoEm: Date;
  esperaMin: number;
  comecaEm: Date;
  status: string;
  respondeuDepois: boolean;
  envio?: string | null;
  ligado?: boolean;
}): DecisaoDoEscalonamento {
  if (i.ligado === false) return "not_applicable";
  if (!STATUS_VIVOS.has(i.status)) return "not_applicable";
  if (i.envio !== undefined) {
    if (i.envio === null || (!ENVIO_OK.has(i.envio) && !ENVIO_EM_VOO.has(i.envio))) return "not_applicable";
    if (ENVIO_EM_VOO.has(i.envio)) {
      return i.comecaEm.getTime() <= i.agora.getTime() ? "not_applicable" : "aguardar";
    }
  }
  if (i.respondeuDepois) return "confirmed";
  if (i.agora.getTime() < i.lembreteEnviadoEm.getTime() + i.esperaMin * 60_000) return "aguardar";
  if (i.comecaEm.getTime() <= i.agora.getTime()) return "not_applicable";
  return "escalated";
}

interface TipoEmbutido {
  organization_id?: string;
  reminder_escalation_enabled: boolean;
  reminder_escalation_minutes: number;
}

interface CompromissoLembrado {
  id: string;
  organization_id: string;
  event_type_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  title: string;
  status: string;
  starts_at: string;
  reminder_sent_at: string;
  reminder_message_id: string | null;
  reminder_conversation_id: string | null;
  reminder_escalation_checked_at?: string | null;
  reminder_escalation_claimed_at?: string | null;
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
  /** Relógio relido depois da posse e antes do handoff. Padrão: `new Date()`. */
  clock?: () => Date;
}

const COLUNAS =
  "id, organization_id, event_type_id, contact_id, conversation_id, title, status, starts_at, " +
  "reminder_sent_at, reminder_message_id, reminder_conversation_id, reminder_escalation_checked_at, " +
  "reminder_escalation_claimed_at";

/** O tipo DESTE compromisso, lido na organização DELE. Null = vínculo inválido. */
async function tipoDaMesmaOrg(admin: SupabaseClient, l: CompromissoLembrado): Promise<TipoEmbutido | null> {
  if (!l.event_type_id) return null;
  const { data, error } = await admin
    .from("calendar_event_types")
    .select("organization_id, reminder_escalation_enabled, reminder_escalation_minutes")
    .eq("organization_id", l.organization_id)
    .eq("id", l.event_type_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TipoEmbutido | null) ?? null;
}

interface EnvioDoLembrete {
  /** Status da mensagem, ou null quando as referências não fecham. */
  status: string | null;
  /**
   * Instante do envio EFETIVO: `sent_at` (ou `created_at`) da mensagem
   * outbound registrada — nem a posse, nem o carimbo gravado depois do envio.
   * É a base do prazo e o corte do "confirmou".
   */
  enviadoEm: string;
}

/**
 * A mensagem do lembrete, só se as referências FECHAM: outbound, da conversa
 * registrada, e a conversa é do contato do compromisso — na mesma organização.
 */
async function envioDoLembrete(admin: SupabaseClient, l: CompromissoLembrado): Promise<EnvioDoLembrete> {
  const semEnvio = { status: null, enviadoEm: l.reminder_sent_at };
  if (!l.reminder_message_id || !l.reminder_conversation_id || !l.contact_id) return semEnvio;
  const { data: msg, error } = await admin
    .from("messages")
    .select("status, sent_at, created_at, conversation_id, direction")
    .eq("organization_id", l.organization_id)
    .eq("id", l.reminder_message_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const m = msg as {
    status?: string;
    sent_at?: string | null;
    created_at?: string | null;
    conversation_id?: string;
    direction?: string;
  } | null;
  if (!m || m.conversation_id !== l.reminder_conversation_id || m.direction !== "outbound") return semEnvio;
  const { data: conv, error: cErr } = await admin
    .from("conversations")
    .select("contact_id")
    .eq("organization_id", l.organization_id)
    .eq("id", l.reminder_conversation_id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if ((conv as { contact_id?: string } | null)?.contact_id !== l.contact_id) return semEnvio;
  // O instante da PRÓPRIA mensagem, não o carimbo gravado depois dela: uma
  // resposta que chega entre o envio e o carimbo é resposta ao lembrete.
  const enviadoEm = m.sent_at || m.created_at || l.reminder_sent_at;
  return { status: m.status ?? null, enviadoEm };
}

async function respondeuNaConversaDoLembrete(
  admin: SupabaseClient,
  l: CompromissoLembrado,
  desde: string,
): Promise<boolean> {
  if (!l.reminder_conversation_id) return false;
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", l.organization_id)
    .eq("conversation_id", l.reminder_conversation_id)
    .eq("direction", "inbound")
    .gt("sent_at", desde)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Posse atômica. Devolve o instante da posse (a "senha" das escritas seguintes) ou null. */
async function tomarPosse(admin: SupabaseClient, l: CompromissoLembrado, agora: Date): Promise<string | null> {
  // Posse abandonada por uma rodada que morreu volta a ficar livre.
  const { error: libErr } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_claimed_at: null })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .is("reminder_escalation_checked_at", null)
    .lt("reminder_escalation_claimed_at", new Date(agora.getTime() - LEASE_MS).toISOString());
  if (libErr) throw new Error(libErr.message);

  const posse = agora.toISOString();
  const { data, error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_claimed_at: posse })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .is("reminder_escalation_checked_at", null)
    .is("reminder_escalation_claimed_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data as unknown[] | null)?.length ? posse : null;
}

async function devolverPosse(admin: SupabaseClient, l: CompromissoLembrado, posse: string): Promise<void> {
  const { error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_claimed_at: null })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .eq("reminder_escalation_claimed_at", posse);
  if (error) throw new Error(error.message);
}

/** Fica com a posse, mas curta: a linha sai do lote até `SONECA_MS`. */
async function sonecar(admin: SupabaseClient, l: CompromissoLembrado, posse: string, agora: Date): Promise<void> {
  const { error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_claimed_at: new Date(agora.getTime() - LEASE_MS + SONECA_MS).toISOString() })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .eq("reminder_escalation_claimed_at", posse);
  if (error) throw new Error(error.message);
}

async function carimbar(
  admin: SupabaseClient,
  l: CompromissoLembrado,
  resultado: Exclude<DecisaoDoEscalonamento, "aguardar">,
  posse: string,
  agora: Date,
): Promise<void> {
  const { error } = await admin
    .from("calendar_appointments")
    .update({ reminder_escalation_checked_at: agora.toISOString(), reminder_escalation_result: resultado })
    .eq("id", l.id)
    .eq("organization_id", l.organization_id)
    .eq("reminder_escalation_claimed_at", posse)
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
  const clock = deps.clock ?? (() => new Date());
  const resumo: ResumoDoEscalonamento = {
    examinados: 0,
    escalados: 0,
    confirmados: 0,
    nao_aplicaveis: 0,
    aguardando: 0,
    erros: 0,
  };

  // JUSTIÇA ENTRE ORGANIZAÇÕES: um lote global ordenado deixava a fila presa de
  // um tenant ocupar o lote inteiro. Agora a consulta é POR ORGANIZAÇÃO, cada
  // uma com seu teto. Quem diz quais organizações (e quais tipos) é a tabela
  // pequena dos tipos com o escalonamento ligado — e o compromisso só entra se
  // o `event_type_id` for de um tipo DA MESMA organização (isolamento no filtro).
  // Todos os tipos ligados, PAGINADOS: um teto fixo cortaria tipos em silêncio.
  const tiposPorOrg = new Map<string, Map<string, TipoEmbutido>>();
  for (let desde = 0; ; desde += PAGINA_DE_TIPOS) {
    const { data: pagina, error: tErr } = await admin
      .from("calendar_event_types")
      .select("id, organization_id, reminder_escalation_enabled, reminder_escalation_minutes")
      .eq("reminder_escalation_enabled", true)
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA_DE_TIPOS - 1);
    if (tErr) {
      logger.error("[agenda-reminder] consulta dos tipos do escalonamento falhou", { error: tErr.message });
      resumo.erros += 1;
      return resumo;
    }
    const linhas = (pagina ?? []) as Array<TipoEmbutido & { id: string; organization_id: string }>;
    for (const t of linhas) {
      const m = tiposPorOrg.get(t.organization_id) ?? new Map<string, TipoEmbutido>();
      m.set(t.id, t);
      tiposPorOrg.set(t.organization_id, m);
    }
    if (linhas.length < PAGINA_DE_TIPOS) break;
  }

  const limiteDaPosse = new Date(agora.getTime() - LEASE_MS).toISOString();
  const candidatos: Array<{ c: CompromissoLembrado; tipo: TipoEmbutido; venceEm: number }> = [];
  for (const [orgId, tipos] of tiposPorOrg) {
    // O PRAZO VENCIDO entra no filtro, ANTES do teto: senão o teto se enchia de
    // quem ainda está dentro da espera e deixava os vencidos de fora. O prazo
    // depende dos minutos de cada tipo, então a consulta é por grupo de minutos.
    const porMinutos = new Map<number, string[]>();
    for (const [id, t] of tipos) {
      const min = Number(t.reminder_escalation_minutes ?? 20);
      porMinutos.set(min, [...(porMinutos.get(min) ?? []), id]);
    }
    const daOrg: Array<{ c: CompromissoLembrado; tipo: TipoEmbutido; venceEm: number }> = [];
    for (const [min, ids] of porMinutos) {
      const { data, error } = await admin
        .from("calendar_appointments")
        .select(COLUNAS)
        .eq("organization_id", orgId)
        .in("event_type_id", ids)
        .not("reminder_sent_at", "is", null)
        .is("reminder_escalation_checked_at", null)
        // Só os de prazo VENCIDO (pelo carimbo; a decisão refina pelo envio efetivo).
        .lte("reminder_sent_at", new Date(agora.getTime() - min * 60_000).toISOString())
        // Só quem ainda não começou: reunião passada sai da janela sozinha.
        .gt("starts_at", agora.toISOString())
        // Posse ativa (inclusive soneca) fica fora do lote.
        .or(`reminder_escalation_claimed_at.is.null,reminder_escalation_claimed_at.lt.${limiteDaPosse}`)
        // Quem nunca foi olhado vem antes de quem acordou de uma soneca; depois,
        // o prazo mais antigo primeiro.
        .order("reminder_escalation_claimed_at", { ascending: true, nullsFirst: true })
        .order("reminder_sent_at", { ascending: true })
        .limit(LIMITE_POR_ORG);
      if (error) {
        logger.error("[agenda-reminder] consulta do escalonamento falhou", { organizationId: orgId, error: error.message });
        resumo.erros += 1;
        continue;
      }
      for (const c of (data ?? []) as unknown as CompromissoLembrado[]) {
        const tipo = c.event_type_id ? tipos.get(c.event_type_id) : undefined;
        if (tipo && c.organization_id === orgId) {
          daOrg.push({ c, tipo, venceEm: new Date(c.reminder_sent_at).getTime() + min * 60_000 });
        }
      }
    }
    // O teto vale para a ORGANIZAÇÃO, aplicado depois do filtro de prazo e na
    // mesma ordem: nunca olhados primeiro, depois o prazo mais antigo.
    daOrg.sort(
      (x, y) =>
        Number(Boolean(x.c.reminder_escalation_claimed_at)) - Number(Boolean(y.c.reminder_escalation_claimed_at)) ||
        x.venceEm - y.venceEm,
    );
    candidatos.push(...daOrg.slice(0, LIMITE_POR_ORG));
  }

  for (const { c: candidato, tipo: grosso } of candidatos) {
    // Corte barato: o prazo nem venceu, nada a tocar.
    const venceEm = new Date(candidato.reminder_sent_at).getTime() + Number(grosso.reminder_escalation_minutes ?? 20) * 60_000;
    if (agora.getTime() < venceEm) {
      resumo.aguardando += 1;
      continue;
    }
    resumo.examinados += 1;

    let posse: string | null = null;
    try {
      posse = await tomarPosse(admin, candidato, agora);
      if (!posse) continue; // outra rodada está cuidando deste compromisso

      // ── RELEITURA depois da posse: nada que foi lido antes vale ──
      const { data: freshRow, error: fErr } = await admin
        .from("calendar_appointments")
        .select(COLUNAS)
        .eq("id", candidato.id)
        .eq("organization_id", candidato.organization_id)
        .maybeSingle();
      if (fErr) throw new Error(fErr.message);
      const l = freshRow as unknown as CompromissoLembrado | null;
      if (!l || l.reminder_escalation_checked_at) {
        if (l) await devolverPosse(admin, candidato, posse);
        continue;
      }
      const tipo = await tipoDaMesmaOrg(admin, l);
      const envio = await envioDoLembrete(admin, l);
      // Relógio RELIDO depois da posse: a decisão não usa o instante do início da rodada.
      const agoraDaDecisao = clock();
      const decisao = decidirEscalonamento({
        agora: agoraDaDecisao,
        // Prazo a partir do envio EFETIVO (a mensagem), nunca da posse.
        lembreteEnviadoEm: new Date(envio.enviadoEm),
        esperaMin: Number(tipo?.reminder_escalation_minutes ?? 20),
        comecaEm: new Date(l.starts_at),
        status: l.status,
        ligado: Boolean(tipo?.reminder_escalation_enabled),
        envio: envio.status,
        respondeuDepois: await respondeuNaConversaDoLembrete(admin, l, envio.enviadoEm),
      });

      if (decisao === "aguardar") {
        // Soneca: fica fora do lote por SONECA_MS em vez de voltar todo ciclo.
        await sonecar(admin, l, posse, agoraDaDecisao);
        resumo.aguardando += 1;
        continue;
      }
      if (decisao !== "escalated") {
        await carimbar(admin, l, decisao, posse, agoraDaDecisao);
        if (decisao === "confirmed") resumo.confirmados += 1;
        else resumo.nao_aplicaveis += 1;
        continue;
      }

      const org = l.organization_id;
      let nome: string | null = null;
      if (l.contact_id) {
        const { data: contato } = await admin
          .from("contacts")
          .select("name, display_name")
          .eq("organization_id", org)
          .eq("id", l.contact_id)
          .maybeSingle();
        const c = contato as { display_name?: string | null; name?: string | null } | null;
        nome = c?.display_name ?? c?.name ?? null;
      }
      const conversa = l.reminder_conversation_id;
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
        conversationId: conversa,
        tituloDoAviso: "Cliente não confirmou a reunião depois do lembrete",
      });
      // Última conferência antes do efeito visível ao lead: a criação da tarefa
      // leva tempo, e o lead pode ter respondido ou o compromisso ter sido
      // cancelado nesse meio. A tarefa já criada fica (é trabalho para a equipe
      // conferir); o handoff não acontece.
      const { data: agoraRow, error: aErr } = await admin
        .from("calendar_appointments")
        .select("status, starts_at")
        .eq("id", l.id)
        .eq("organization_id", org)
        .maybeSingle();
      if (aErr) throw new Error(aErr.message);
      const ainda = agoraRow as { status?: string; starts_at?: string } | null;
      const respondeuAgora = await respondeuNaConversaDoLembrete(admin, l, envio.enviadoEm);
      if (
        respondeuAgora ||
        !ainda ||
        !STATUS_VIVOS.has(ainda.status ?? "") ||
        new Date(ainda.starts_at ?? l.starts_at).getTime() <= clock().getTime()
      ) {
        const fim = respondeuAgora ? "confirmed" : "not_applicable";
        await carimbar(admin, l, fim, posse, clock());
        if (fim === "confirmed") resumo.confirmados += 1;
        else resumo.nao_aplicaveis += 1;
        continue;
      }
      if (conversa) {
        const r = await handoff({
          conversationId: conversa,
          organizationId: org,
          reason: "lembrete_sem_confirmacao",
          leadId: tarefa.leadId,
          metadata: { source: "agenda_reminder_escalation", appointment_id: l.id, task_id: tarefa.taskId },
        });
        if (!r.triggered && HANDOFF_TRANSITORIO.has(r.reason)) {
          // Infra falhou: NÃO é escalado ainda. Devolve a posse e tenta na próxima rodada.
          await devolverPosse(admin, l, posse);
          resumo.erros += 1;
          logger.warn("[agenda-reminder] handoff transitório; escalonamento fica pendente", {
            appointmentId: l.id,
            motivo: r.reason,
          });
          continue;
        }
        if (!r.triggered) {
          // Conversa já com pessoa / IA já silenciada: tarefa e aviso bastam.
          logger.info("[agenda-reminder] escalonamento sem handoff", { appointmentId: l.id, motivo: r.reason });
        }
      }
      await carimbar(admin, l, "escalated", posse, clock());
      resumo.escalados += 1;
    } catch (err) {
      resumo.erros += 1;
      if (posse) {
        try {
          await devolverPosse(admin, candidato, posse);
        } catch {
          // A posse expira sozinha (LEASE_MS).
        }
      }
      logger.error("[agenda-reminder] escalonamento falhou; tenta na próxima rodada", {
        appointmentId: candidato.id,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }
  return resumo;
}
