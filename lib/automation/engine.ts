import type { ServiceBoundary } from "@/lib/atendimento/fronteira";
/**
 * Motor de regras: consome eventos-gatilho do event_log e executa as
 * automation_rules ativas do tenant. Registrado no registry via engine.handler.
 *
 * Anti-loop: eventos com metadata.caused_by_rule OU metadata.request_id
 * prefixado "rule:" não reprocessam (profundidade 1 no v1 — cadeia
 * regra→regra fica pra v2/Task 9, que estampa esse metadata nos eventos que
 * uma ação do motor emite).
 *
 * entity_kind guard: o trigger legado `fn_emit_event_on_lead_change` emite
 * lead.created/lead.stage_changed com entity_kind='lead' (derivado por
 * split_part do event_type), enquanto os handlers desta feature emitem com
 * entity_kind='crm_lead'. Sem este filtro o motor rodaria a regra 2x por
 * mudança de lead (uma vez por linha de event_log duplicada).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { evaluateConditions, type RuleCondition } from "@/lib/automation/conditions";
import { getAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import {
  RITMO_HUMANO_METADATA_KEY,
  calcularEsperaInicialMs,
  calcularPlanoRitmoHumano,
  reagendarEm,
} from "@/lib/automation/ritmo-humano";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export const AUTOMATION_CONSUMER_KEY = "automation-rules";

const EXPECTED_ENTITY_KIND: Record<string, string> = {
  "lead.created": "crm_lead",
  "lead.stage_changed": "crm_lead",
  "lead.tag_added": "crm_lead",
  "contact.tag_added": "contact",
  "message.received": "message",
};

interface RuleRow {
  id: string;
  name: string;
  conditions: RuleCondition[];
  actions: Array<{ type: string; config?: Record<string, unknown> }>;
}

type FaseRitmo = "iniciar_digitacao" | "enviar";

interface AcaoEmRitmo {
  rule_id: string;
  action_index: number;
  action_type: string;
  results: ActionResultDetail[];
  first_message_pending: boolean;
  phase: FaseRitmo;
  text_length: number;
  target_ms?: number;
  typing_ms?: number;
  run_id?: string | null;
}

interface EstadoRitmoHumano {
  version: 1;
  completed_rule_ids: string[];
  current: AcaoEmRitmo;
}

function lerEstadoRitmo(metadata: Record<string, unknown>): EstadoRitmoHumano | null {
  const raw = metadata[RITMO_HUMANO_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = raw as Partial<EstadoRitmoHumano>;
  const current = state.current as Partial<AcaoEmRitmo> | undefined;
  if (
    state.version !== 1 ||
    !Array.isArray(state.completed_rule_ids) ||
    !current ||
    typeof current.rule_id !== "string" ||
    typeof current.action_index !== "number" ||
    typeof current.action_type !== "string" ||
    !Array.isArray(current.results) ||
    typeof current.first_message_pending !== "boolean" ||
    (current.phase !== "iniciar_digitacao" && current.phase !== "enviar") ||
    typeof current.text_length !== "number"
  ) {
    return null;
  }
  return state as EstadoRitmoHumano;
}

async function persistirEstadoRitmo(
  admin: SupabaseClient,
  row: EventRow,
  state: EstadoRitmoHumano | null,
): Promise<void> {
  const metadata = { ...(row.metadata ?? {}) };
  if (state) metadata[RITMO_HUMANO_METADATA_KEY] = state;
  else delete metadata[RITMO_HUMANO_METADATA_KEY];

  const { error } = await admin
    .from("event_log")
    .update({ metadata })
    .eq("id", row.id)
    .eq("organization_id", row.organization_id);
  if (error) throw new Error(`automation_pacing_state_write_failed: ${error.message}`);
  row.metadata = metadata;
}

function statusDosResultados(results: ActionResultDetail[]): "success" | "partial" | "failed" | "adiado" {
  const naoEnviadas = results.filter((r) => r.status === "failed" || r.status === "skipped").length;
  const adiados = results.filter((r) => r.status === "postponed").length;
  return naoEnviadas > 0
    ? naoEnviadas === results.length
      ? "failed"
      : "partial"
    : adiados > 0
      ? "adiado"
      : "success";
}

async function registrarEsperaDoRitmo(
  admin: SupabaseClient,
  row: EventRow,
  rule: RuleRow,
  current: AcaoEmRitmo,
  retryAt: string,
  duracaoMs: number,
  reason: "ritmo_humano_antes_primeira_mensagem" | "ritmo_humano_digitando" | "ritmo_humano_entre_mensagens",
): Promise<string | null> {
  const actionsResult = [
    ...current.results,
    {
      type: current.action_type,
      status: "postponed" as const,
      detail: {
        reason,
        retry_at: retryAt,
        duracao_ms: duracaoMs,
        explicacao: "A automação está respeitando o ritmo de uma conversa humana sem prender o worker.",
      },
    },
  ];

  if (current.run_id) {
    const { error } = await admin
      .from("automation_rule_runs")
      .update({ status: "adiado", actions_result: actionsResult })
      .eq("id", current.run_id)
      .eq("organization_id", row.organization_id)
      .eq("rule_id", rule.id);
    if (error) {
      logger.error("[automation.engine] não foi possível atualizar a espera do ritmo humano", {
        rule_id: rule.id,
        organization_id: row.organization_id,
        error: error.message,
      });
    }
    return current.run_id;
  }

  const { data, error } = await admin
    .from("automation_rule_runs")
    .insert({
      organization_id: row.organization_id,
      rule_id: rule.id,
      event_id: row.id,
      status: "adiado",
      actions_result: actionsResult,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    logger.error("[automation.engine] não foi possível registrar a espera do ritmo humano", {
      rule_id: rule.id,
      organization_id: row.organization_id,
      error: error.message,
    });
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

async function registrarRunFinal(
  admin: SupabaseClient,
  row: EventRow,
  rule: RuleRow,
  results: ActionResultDetail[],
  runId?: string | null,
): Promise<void> {
  const status = statusDosResultados(results);
  let runRow: { id?: string } | null = runId ? { id: runId } : null;
  let runErr: { message: string } | null = null;

  if (runId) {
    const update = await admin
      .from("automation_rule_runs")
      .update({ status, actions_result: results })
      .eq("id", runId)
      .eq("organization_id", row.organization_id)
      .eq("rule_id", rule.id);
    runErr = update.error;
  } else {
    const insert = await admin
      .from("automation_rule_runs")
      .insert({
        organization_id: row.organization_id,
        rule_id: rule.id,
        event_id: row.id,
        status,
        actions_result: results,
      })
      .select("id")
      .maybeSingle();
    runRow = insert.data as { id?: string } | null;
    runErr = insert.error;
  }
  if (runErr) logger.error("[automation.engine] run insert/update failed", { error: runErr.message });

  // Audit só em falha/partial (spec §9) — não inflar audit em toda run.
  if (status !== "success") {
    void audit({
      action: "automation.rule_executed",
      organizationId: row.organization_id,
      resourceType: "automation_rule_run",
      resourceId: runRow?.id ?? null,
      metadata: { rule_id: rule.id, status, event_type: row.event_type },
    });
  }

  // run_count sem RPC de increment: read-modify-write é aceitável aqui
  // (contador informativo de UI, não invariante).
  const { data: cur } = await admin.from("automation_rules").select("run_count").eq("id", rule.id).maybeSingle();
  await admin
    .from("automation_rules")
    .update({ last_run_at: new Date().toISOString(), run_count: (cur?.run_count ?? 0) + 1 })
    .eq("id", rule.id);
}

async function encerrarEstadoRitmoInvalido(
  admin: SupabaseClient,
  row: EventRow,
  state: EstadoRitmoHumano,
  reason: string,
): Promise<void> {
  if (state.current.run_id) {
    const actionsResult = [
      ...state.current.results,
      { type: state.current.action_type, status: "failed" as const, error: reason },
    ];
    const { error } = await admin
      .from("automation_rule_runs")
      .update({ status: "failed", actions_result: actionsResult, error: reason })
      .eq("id", state.current.run_id)
      .eq("organization_id", row.organization_id);
    if (error) {
      logger.error("[automation.engine] não foi possível encerrar ritmo humano inválido", {
        organization_id: row.organization_id,
        rule_id: state.current.rule_id,
        error: error.message,
      });
    }
  }
  await persistirEstadoRitmo(admin, row, null);
}

/** Hidrata o contexto avaliado pelas condições/ações a partir do entity do evento. */
export async function buildContext(admin: SupabaseClient, row: EventRow): Promise<Record<string, unknown>> {
  const context: Record<string, unknown> = { event: row.payload };
  // Admin client bypassa RLS — todo lookup filtra organization_id do evento
  // (doutrina multi-tenant; um FK cross-org corrompido nunca vaza pro contexto).
  const org = row.organization_id;
  if (row.entity_kind === "crm_lead" && row.entity_id) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("*")
      .eq("id", row.entity_id)
      .eq("organization_id", org)
      .maybeSingle();
    if (lead) {
      context.lead = lead;
      if (lead.contact_id) {
        const { data: contact } = await admin
          .from("contacts")
          .select("*")
          .eq("id", lead.contact_id)
          .eq("organization_id", org)
          .maybeSingle();
        if (contact) context.contact = contact;
      }
    }
  } else if (row.entity_kind === "contact" && row.entity_id) {
    const { data: contact } = await admin
      .from("contacts")
      .select("*")
      .eq("id", row.entity_id)
      .eq("organization_id", org)
      .maybeSingle();
    if (contact) context.contact = contact;
  } else if (row.entity_kind === "message" && row.entity_id) {
    const contactId = row.payload.contact_id as string | undefined;
    if (contactId) {
      const { data: contact } = await admin
        .from("contacts")
        .select("*")
        .eq("id", contactId)
        .eq("organization_id", org)
        .maybeSingle();
      if (contact) context.contact = contact;
    }
  }
  return context;
}

/**
 * Grava a linha do adiamento — a única evidência de que a regra casou e está
 * esperando.
 *
 * Um run por adiamento, e não um por tique do drain: o evento só volta na hora
 * marcada por `retry_at`, então não há repetição a cada minuto. Se a janela
 * seguir fechada quando ele voltar, sai outra linha — e aí a repetição É a
 * informação (a automação está presa há três dias).
 *
 * Fire-and-forget quanto a erro: perder o registro não pode impedir o
 * adiamento, que é o que protege o número.
 */
async function registrarAdiamento(
  admin: SupabaseClient,
  row: EventRow,
  rule: RuleRow,
  actionType: string,
  retryAt: string,
): Promise<void> {
  const { error } = await admin.from("automation_rule_runs").insert({
    organization_id: row.organization_id,
    rule_id: rule.id,
    event_id: row.id,
    status: "adiado",
    actions_result: [
      {
        type: actionType,
        status: "postponed",
        detail: {
          reason: "fora_da_janela_de_envio",
          retry_at: retryAt,
          explicacao:
            "A regra casou e está esperando a janela de envio do número reabrir — nada foi tentado ainda.",
        },
      },
    ],
  });
  if (error) {
    logger.error("[automation.engine] não foi possível registrar o adiamento", {
      rule_id: rule.id,
      organization_id: row.organization_id,
      error: error.message,
    });
  }
}

/**
 * Procura, no trecho ainda não executado, uma ação capaz de invalidar a
 * sequência inteira. A checagem acontece de novo a cada fronteira de ação:
 * resposta humana pode chegar durante uma espera durável ou durante outro
 * efeito anterior da mesma regra.
 */
async function interrupcaoDaRegra(
  rule: RuleRow,
  startAt: number,
  ctx: ActionCtx,
): Promise<ActionResultDetail | null> {
  for (const action of (rule.actions ?? []).slice(startAt)) {
    const executor = getAction(action.type);
    if (!executor?.interruptRule) continue;
    try {
      const result = await executor.interruptRule(ctx, action.config ?? {});
      if (result) return result;
    } catch (err) {
      return {
        type: action.type,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        detail: {
          reason: "rule_interruption_check_failed",
          explicacao:
            "Não foi possível confirmar se a regra ainda podia falar com o contato. A sequência foi encerrada sem enviar.",
        },
      };
    }
  }
  return null;
}

export async function runAutomationForEvent(
  admin: SupabaseClient,
  row: EventRow,
): Promise<HandlerResult> {
  const serviceBoundaries = new Map<string, Promise<ServiceBoundary>>();
  let pacingState = lerEstadoRitmo(row.metadata ?? {});
  const requestId = row.metadata?.request_id;
  const causedByRule =
    Boolean(row.metadata?.caused_by_rule) || (typeof requestId === "string" && requestId.startsWith("rule:"));
  if (causedByRule) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "caused_by_rule" };
  }

  const expectedKind = EXPECTED_ENTITY_KIND[row.event_type];
  if (expectedKind && row.entity_kind !== expectedKind) {
  
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "skipped", detail: "entity_kind_mismatch" };
  }

  const { data: rules, error } = await admin
    .from("automation_rules")
    .select("id, name, conditions, actions")
    .eq("organization_id", row.organization_id)
    .eq("trigger_event", row.event_type)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) {
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "error", detail: error.message };
  }
  const matched = (rules ?? []) as unknown as RuleRow[];
  if (!matched.length) {
    if (pacingState) await encerrarEstadoRitmoInvalido(admin, row, pacingState, "automation_rule_unavailable");
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: "no_rules" };
  }

  const context = await buildContext(admin, row);
  const applicable = matched.filter((r) => evaluateConditions(r.conditions ?? [], context));
  if (!applicable.length) {
    if (pacingState) await encerrarEstadoRitmoInvalido(admin, row, pacingState, "automation_rule_no_longer_matches");
    return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok", detail: "no_match" };
  }

  const completedRuleIds = new Set(pacingState?.completed_rule_ids ?? []);
  if (pacingState && !applicable.some((rule) => rule.id === pacingState!.current.rule_id)) {
    const invalid = pacingState;
    await encerrarEstadoRitmoInvalido(admin, row, invalid, "automation_rule_changed_during_wait");
    pacingState = null;
  }

  const actionCtx = (rule: RuleRow) => ({
    admin,
    serviceBoundaries,
    organizationId: row.organization_id,
    ruleId: rule.id,
    ruleName: rule.name,
    event: row,
    context,
    requestId: row.id,
  });

  const interrupcoesPrechecadas = new Map<string, ActionResultDetail>();

  // Pré-checagem all-or-nothing só sobre o trecho AINDA não executado. Uma
  // retomada não volta a consultar ações que o cursor durável já concluiu.
  for (const rule of applicable) {
    if (completedRuleIds.has(rule.id)) continue;
    const startAt = pacingState?.current.rule_id === rule.id ? pacingState.current.action_index : 0;
    const interrupcao = await interrupcaoDaRegra(rule, startAt, actionCtx(rule));
    if (interrupcao) {
      interrupcoesPrechecadas.set(rule.id, interrupcao);
      continue;
    }
    for (const action of (rule.actions ?? []).slice(startAt)) {
      const executor = getAction(action.type);
      if (!executor?.postponeUntil) continue;
      const until = await executor.postponeUntil(actionCtx(rule), action.config ?? {});
      if (until) {
        // A ESPERA É UM ESTADO, e um estado que ninguém vê é indistinguível de
        // morte. Sem esta linha o evento sumia até a janela reabrir e a aba
        // Atividade não mostrava NADA — para quem montou a regra, "não apareceu
        // nada" e "não rodou" são a mesma tela (migration 0175).
        await registrarAdiamento(admin, row, rule, action.type, until);
        return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "retry", retry_at: until };
      }
    }
  }

  for (const rule of applicable) {
    if (completedRuleIds.has(rule.id)) continue;

    const resumed = pacingState?.current.rule_id === rule.id ? pacingState.current : null;
    const current: AcaoEmRitmo = resumed ?? {
      rule_id: rule.id,
      action_index: 0,
      action_type: "",
      results: [],
      first_message_pending: true,
      phase: "iniciar_digitacao",
      text_length: 0,
      run_id: null,
    };
    let retomadaPendente = resumed !== null;
    let restanteAntesDaProximaMensagem = 0;

    const reagendarRitmo = async (
      duracaoMs: number,
      phase: FaseRitmo,
      reason: "ritmo_humano_antes_primeira_mensagem" | "ritmo_humano_digitando" | "ritmo_humano_entre_mensagens",
    ): Promise<HandlerResult> => {
      const retryAt = reagendarEm(duracaoMs);
      current.phase = phase;
      current.run_id = await registrarEsperaDoRitmo(
        admin,
        row,
        rule,
        current,
        retryAt,
        duracaoMs,
        reason,
      );
      pacingState = {
        version: 1,
        completed_rule_ids: [...completedRuleIds],
        current,
      };
      // Persistir o cursor é a condição do retry. Sem isto, um wake recomeçaria
      // a regra e poderia repetir efeitos anteriores.
      await persistirEstadoRitmo(admin, row, pacingState);
      return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "retry", retry_at: retryAt };
    };

    while (current.action_index < (rule.actions ?? []).length) {
      const interrupcao =
        interrupcoesPrechecadas.get(rule.id) ??
        (await interrupcaoDaRegra(rule, current.action_index, actionCtx(rule)));
      interrupcoesPrechecadas.delete(rule.id);
      if (interrupcao) {
        current.results.push(interrupcao);
        current.action_index = (rule.actions ?? []).length;
        pacingState = null;
        retomadaPendente = false;
        break;
      }

      const action = rule.actions[current.action_index]!;
      const executor = getAction(action.type);
      if (!executor) {
        current.results.push({ type: action.type, status: "failed", error: "unknown_action" });
        current.action_index += 1;
        continue;
      }

      if (retomadaPendente) {
        if (current.action_type !== action.type || !executor.humanPacing) {
          current.results.push({
            type: action.type,
            status: "failed",
            error: "automation_rule_changed_during_wait",
          });
          current.action_index += 1;
          retomadaPendente = false;
          continue;
        }

        if (current.phase === "iniciar_digitacao") {
          const plano = calcularPlanoRitmoHumano(current.text_length);
          if (executor.humanPacing.signalTyping) {
            try {
              await executor.humanPacing.signalTyping(actionCtx(rule), action.config ?? {});
            } catch (err) {
              // O indicador é decoração; nunca troca entrega por presença.
              logger.warn("[automation.engine] não foi possível sinalizar digitando", {
                organization_id: row.organization_id,
                rule_id: rule.id,
                error: err instanceof Error ? err.name : "unknown",
              });
            }
          }
          current.target_ms = plano.alvo_ms;
          current.typing_ms = plano.digitando_ms;
          return reagendarRitmo(plano.digitando_ms, "enviar", "ritmo_humano_digitando");
        }

        try {
          current.results.push(
            await executor.execute(
              { ...actionCtx(rule), humanPacingManaged: true },
              action.config ?? {},
            ),
          );
        } catch (err) {
          current.results.push({
            type: action.type,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        restanteAntesDaProximaMensagem = Math.max(
          0,
          (current.target_ms ?? 0) - (current.typing_ms ?? 0),
        );
        current.action_index += 1;
        // A retomada foi consumida; as próximas ações seguem pelo fluxo normal.
        pacingState = null;
        retomadaPendente = false;
        continue;
      }

      if (executor.humanPacing) {
        let textLength: number | null = null;
        try {
          textLength = await executor.humanPacing.textLength(actionCtx(rule), action.config ?? {});
        } catch (err) {
          // Se não deu para preparar o ritmo, preserva o envio pelo executor e
          // pelo throttle legado. A preparação nunca vira ponto único de falha.
          logger.warn("[automation.engine] não foi possível preparar o ritmo humano", {
            organization_id: row.organization_id,
            rule_id: rule.id,
            error: err instanceof Error ? err.name : "unknown",
          });
        }

        if (textLength !== null) {
          current.action_type = action.type;
          current.text_length = textLength;
          const primeira = current.first_message_pending;
          current.first_message_pending = false;
          const duracao = primeira ? calcularEsperaInicialMs() : restanteAntesDaProximaMensagem;
          restanteAntesDaProximaMensagem = 0;
          return reagendarRitmo(
            duracao,
            "iniciar_digitacao",
            primeira ? "ritmo_humano_antes_primeira_mensagem" : "ritmo_humano_entre_mensagens",
          );
        }
      }

      try {
        current.results.push(await executor.execute(actionCtx(rule), action.config ?? {}));
      } catch (err) {
        current.results.push({
          type: action.type,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      current.action_index += 1;
    }

    await registrarRunFinal(admin, row, rule, current.results, current.run_id);
    completedRuleIds.add(rule.id);
    pacingState = null;
  }

  if (RITMO_HUMANO_METADATA_KEY in (row.metadata ?? {})) {
    await persistirEstadoRitmo(admin, row, null);
  }
  return { consumer_key: AUTOMATION_CONSUMER_KEY, status: "ok" };
}
