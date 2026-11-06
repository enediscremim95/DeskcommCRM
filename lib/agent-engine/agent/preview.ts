/** Preview is an execution policy of the real turn, never a simulated queue job. */
import type pg from 'pg';
import { hasOpenCaseForContact } from './human-cases';
import type { ToolSet } from '../edge/llm/run-model-call';
import type { LeadContext, LeadContextResult } from '../edge/crm/get-lead-context';
import type { PublishedAgentConfig } from './agent-config';
import type { LeadCheckpointRow } from './inbound-turn';
import {
  evaluateBeforeSend,
  type GateContext,
  type GateTraceEntry,
  loadChannelProvider,
} from '../guardrails/before-send';
import { loadChannelKnobs, loadPacingState } from '../pacing/store';
import { PACING_DEFAULTS } from '../pacing/defaults';
import { SPINNING_DEFAULTS } from '../spinning/defaults';
import { loadRecentCopies, loadSpinningKnobs } from '../spinning/store';
import { loadPromiseTable } from '../guardrails/promise/table';
import { loadDisclosureTemplate, countPriorAcceptedSends } from '../guardrails/disclosure/template';
import { DEFAULT_CHANNEL_PROVIDER } from '@/lib/channels/capabilities';
import { getToolByName } from '@/lib/mcp/tools';
import type { Logger } from '../obs/logger';
import type { Citation } from '@/lib/ai/citations/types';
import {
  filtrarMensagemDoTurno,
  registrarMensagemEnviadaNoTurno,
  resultadoDeEnvioSemRepeticao,
} from './dedupe-mensagem-turno';
import {
  resultadoDeEnvioSemAnuncio,
  type GuardaAnuncioSemVitrine,
} from './anuncio-sem-vitrine';
import { filtrarSaudacaoRepetida } from './saudacao-repetida';
import {
  registrarHandoffRealizadoNesteTurno,
  registrarMensagemParaHandoffAutomatico,
  type EstadoHandoffAutomaticoNaPromessa,
} from './promessa-sem-handoff';

export interface TurnPreview {
  kind: 'sandbox' | 'assisted';
  organizationId: string;
  runId: string;
  agent: PublishedAgentConfig;
  context: Extract<LeadContextResult, { ok: true }>;
  previous?: LeadCheckpointRow | null;
  notes?: Array<{ headline: string; body: string }>;
  feedback?: string;
  /** Produtos já enviados em turnos anteriores deste cenário, nunca lidos de messages. */
  catalogProductCodesAlreadySent?: string[];
  /** Null means a scenario, never a synthetic identifier passed to SQL. */
  contactId: string | null;
  channelId: string | null;
  gateContext?: GateContext;
  result: PreviewResult;
}
export interface PreviewCatalogDelivery {
  produtoCodigo: string;
  legenda: string;
  imagens: Array<{ nome: string; url: string }>;
}
export interface PreviewTextDelivery {
  tipo: 'texto';
  papel: 'intro' | 'fechamento';
  texto: string;
}
export interface PreviewToolTrace {
  tool: string;
  argumentos: unknown;
  resultado: string;
  ok: boolean;
}
export interface PreviewResult {
  checkpoint?: unknown;
  candidates: Array<{ body: string; citations: Citation[]; trace: GateTraceEntry[] }>;
  proposals: Array<{ tool: string; arguments: unknown }>;
  envios: Array<PreviewCatalogDelivery | PreviewTextDelivery>;
  toolTrace: PreviewToolTrace[];
  impediments: Array<{ code: string; message: string }>;
  restrictions: string[];
}
export function newPreviewResult(): PreviewResult {
  return {
    candidates: [],
    proposals: [],
    envios: [],
    toolTrace: [],
    impediments: [],
    restrictions: [
      'preview_no_client_effects',
      'writes_require_separate_authorization',
      'send_revalidates_live_state',
    ],
  };
}

export async function previewGateContext(
  db: pg.Pool,
  p: TurnPreview,
  log: Logger,
  now: Date,
): Promise<GateContext> {
  if (p.gateContext) return { ...p.gateContext, now };
  const org = p.organizationId,
    channel = p.channelId;
  const cfg = channel
    ? await loadChannelKnobs(db, org, channel, log)
    : { knobs: PACING_DEFAULTS, numberActivatedAt: null };
  const spinning = channel ? await loadSpinningKnobs(db, org, channel, log) : SPINNING_DEFAULTS;
  const promise = await loadPromiseTable(db, org),
    disclosure = await loadDisclosureTemplate(db, org);
  const first = p.contactId ? (await countPriorAcceptedSends(db, org, p.contactId)) === 0 : true;
  let lastInbound: Date | null = null;
  if (p.contactId && channel) {
    const { rows } = await db.query<{ last_inbound_at: Date | null }>(
      'select last_inbound_at from conversations where organization_id=$1 and id=$2 and contact_id=$3 and channel_session_id=$4',
      [org, p.context.context.conversation_id, p.contactId, channel],
    );
    lastInbound = rows[0]?.last_inbound_at ?? null;
  } else {
    const last = p.context.context.messages.filter((m) => m.direction === 'inbound').at(-1);
    lastInbound = last ? new Date(last.sent_at) : null;
    p.result.restrictions.push('contact_state_is_scenario');
  }
  return {
    now,
    body: '',
    optedOut: p.context.context.contact.is_blocked,
    provider: channel ? await loadChannelProvider(db, org, channel) : DEFAULT_CHANNEL_PROVIDER,
    messagingWindow: { lastInboundAt: lastInbound },
    pacing: {
      knobs: cfg.knobs,
      state: channel
        ? await loadPacingState(db, org, channel, {
            now,
            timezone: cfg.knobs.timezone,
            numberActivatedAt: cfg.numberActivatedAt,
          })
        : { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
    },
    spinning: {
      knobs: spinning,
      window: channel ? await loadRecentCopies(db, org, channel, spinning.windowSize) : [],
    },
    promise: { table: promise?.table ?? null },
    semanticPromise: null,
    disclosure: { template: disclosure?.body ?? null, isFirstOutbound: first, mode: 'inject' },
    lgpd: { ...p.context.lgpd, isFirstOutbound: first },
    casesEnabled: p.agent.casesEnabled,
    hasOpenCase:
      p.contactId && p.agent.casesEnabled
        ? await hasOpenCaseForContact(db, org, p.context.context.conversation_id!)
        : false,
    openedCaseThisTurn: false,
    humanPromiseExtraTargets: p.agent.handoffKeywords,
    agenda: { active: p.agent.toolIds.includes('crm_book_appointment'), toolCalledThisTurn: false },
    internalVocabularyEnforced: true,
  };
}
const SCENARIO_READS = new Set([
  'crm_search_products',
  'crm_search_knowledge',
  'crm_get_lead',
  'crm_list_pipelines',
  'crm_list_stages',
  'crm_list_appointment_types',
  'crm_find_free_slots',
]);
/** Unknown tools fail closed. A write proposal never calls its original execute. */
export function applyPreviewPolicy(
  tools: ToolSet,
  p: TurnPreview,
  ctx: GateContext,
  citations: () => Citation[],
  semanticClassifier?: (body: string) => Promise<NonNullable<GateContext['semanticPromise']>>,
  liveContext?: () => Partial<GateContext>,
  dedupe?: {
    enviadas: Set<string>;
    log: Pick<Logger, 'warn'>;
    limite?: number;
    contador?: { valor: number };
  },
  guardaAnuncioSemVitrine?: GuardaAnuncioSemVitrine,
  handoffAutomatico?: EstadoHandoffAutomaticoNaPromessa,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const nativeRead = [
        'get_lead_context',
        'get_lead_note',
        'search_knowledge',
        'read_skill_reference',
      ].includes(name);
      const catalog = getToolByName(name);
      if (
        (p.kind === 'sandbox' &&
          (name === 'crm_send_catalog_item' ||
            name === 'crm_send_vitrine' ||
            name === 'crm_quote_shipping')) ||
        nativeRead ||
        (catalog?.category === 'read' && (p.contactId !== null || SCENARIO_READS.has(name)))
      )
        return [name, definition];
      return [
        name,
        {
          ...definition,
          execute: async (args: unknown) => {
            if (name === 'send_message') {
              const bodyRecebido =
                args && typeof args === 'object' && 'body' in args && typeof args.body === 'string'
                  ? args.body
                  : '';
              let body = bodyRecebido;
              let filtro: ReturnType<typeof filtrarMensagemDoTurno> | null = null;
              if (dedupe) {
                filtro = filtrarMensagemDoTurno({
                  body: bodyRecebido,
                  enviadas: dedupe.enviadas,
                  log: dedupe.log,
                });
                if (filtro.status === 'duplicate_skipped') {
                  return { ok: true, status: 'duplicate_skipped' };
                }
                body = filtro.body;
              }
              const anuncioSemVitrine = guardaAnuncioSemVitrine?.avaliar(body) ?? null;
              if (anuncioSemVitrine && 'ok' in anuncioSemVitrine) return anuncioSemVitrine;
              if (anuncioSemVitrine?.status === 'pronta_sem_anuncio') {
                body = anuncioSemVitrine.body;
              }
              const filtroSaudacao = filtrarSaudacaoRepetida({
                body,
                ativa: p.agent.semSaudacaoRepetida === true,
                mensagens: p.context.context.messages,
                agora: ctx.now,
                log: dedupe?.log ?? { warn: () => undefined },
              });
              if (filtroSaudacao.status === 'duplicate_skipped') {
                return { ok: true, status: 'duplicate_skipped' };
              }
              body = filtroSaudacao.body;
              if (
                dedupe?.limite !== undefined &&
                dedupe.contador !== undefined &&
                dedupe.contador.valor >= dedupe.limite
              ) {
                return {
                  ok: false,
                  error: {
                    code: 'max_sends_per_turn',
                    message: 'o teto de mensagens deste turno foi atingido; encerre e espere a resposta.',
                  },
                };
              }
              const result = evaluateBeforeSend({
                ...ctx,
                ...liveContext?.(),
                body,
                semanticPromise: semanticClassifier ? await semanticClassifier(body) : null,
              });
              if (result.veto) {
                p.result.impediments.push({ code: result.veto.code, message: result.veto.message });
                return {
                  ok: false,
                  error: { code: result.veto.code, message: result.veto.message },
                };
              }
              p.result.candidates.push({
                body: result.body,
                citations: citations(),
                trace: result.trace,
              });
              if (handoffAutomatico) {
                registrarMensagemParaHandoffAutomatico(handoffAutomatico, result.body);
              }
              if (dedupe) {
                registrarMensagemEnviadaNoTurno(body, dedupe.enviadas);
                if (dedupe.contador) dedupe.contador.valor += 1;
              }
              const semAnuncio = resultadoDeEnvioSemAnuncio(anuncioSemVitrine);
              if (semAnuncio) return semAnuncio;
              const semRepeticao = filtro ? resultadoDeEnvioSemRepeticao(filtro) : null;
              if (semRepeticao) return semRepeticao;
              return {
                ok: true,
                status: p.kind === 'sandbox' ? 'simulated' : 'awaiting_approval',
                message: 'Resposta proposta. Nenhuma mensagem enviada. Encerre o turno.',
              };
            }
            if (catalog?.category === 'read')
              return {
                ok: false,
                error: {
                  code: 'scenario_contact_unavailable',
                  message: 'Esta consulta precisa de um contato real autorizado.',
                },
              };
            if (
              catalog ||
              [
                'send_template',
                'update_lead_state',
                'save_lead_note',
                'request_human_handoff',
                'schedule_followup',
                'open_human_case',
                'provide_case_update',
              ].includes(name)
            ) {
              if (name === 'request_human_handoff' && handoffAutomatico) {
                registrarHandoffRealizadoNesteTurno(handoffAutomatico);
              }
              p.result.proposals.push({ tool: name, arguments: args });
              return {
                ok: true,
                status: 'proposal_only',
                message:
                  'Proposta registrada. A operação não foi executada e exige autorização separada.',
              };
            }
            p.result.impediments.push({ code: 'unknown_preview_tool', message: name });
            return {
              ok: false,
              error: {
                code: 'unknown_preview_tool',
                message: 'Ferramenta não autorizada no teste.',
              },
            };
          },
        },
      ];
    }),
  ) as ToolSet;
}

const TRACE_STRING_LIMIT = 160;
const TRACE_ARRAY_LIMIT = 8;
const TRACE_OBJECT_LIMIT = 12;
const TRACE_SENSITIVE_KEY = /(?:^|_)(?:address|authorization|body|cep|contact|conversation|cpf|cnpj|document|email|endereco|lead_id|message|name|nome|password|phone|secret|token|user_id|whatsapp)(?:$|_)/i;

function truncateTraceString(value: string): string {
  const sanitized = value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[uuid]')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, '[telefone]')
    .replace(/\b(?:bearer\s+|sk-|ghp_|xoxb-|cfut_)[A-Za-z0-9._-]+/gi, '[segredo]');
  return sanitized.length <= TRACE_STRING_LIMIT
    ? sanitized
    : `${sanitized.slice(0, TRACE_STRING_LIMIT)}…`;
}

function traceArguments(value: unknown, key = '', depth = 0): unknown {
  if (TRACE_SENSITIVE_KEY.test(key)) return '[omitido]';
  if (depth >= 3) return '[truncado]';
  if (typeof value === 'string') return truncateTraceString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, TRACE_ARRAY_LIMIT).map((item) => traceArguments(item, key, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, TRACE_OBJECT_LIMIT)
        .map(([childKey, child]) => [childKey, traceArguments(child, childKey, depth + 1)]),
    );
  }
  return `[${typeof value}]`;
}

function traceResult(value: unknown): { ok: boolean; resultado: string } {
  if (!value || typeof value !== 'object') {
    return { ok: true, resultado: `resultado_${value === null ? 'nulo' : typeof value}` };
  }
  const record = value as Record<string, unknown>;
  const error = record.error;
  if (record.ok === false || error !== undefined) {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : typeof error === 'string'
          ? error
          : 'sem_codigo';
    return { ok: false, resultado: `erro:${truncateTraceString(code)}` };
  }
  if (record.ja_enviado === true) return { ok: true, resultado: 'sucesso:ja_enviado' };
  if (record.status === 'duplicate_skipped')
    return { ok: true, resultado: 'sucesso:duplicate_skipped' };
  const fields = Object.keys(record).slice(0, TRACE_OBJECT_LIMIT);
  const lists = fields.flatMap((field) =>
    Array.isArray(record[field]) ? [`${field}=${record[field].length}`] : [],
  );
  return {
    ok: true,
    resultado: truncateTraceString(
      `sucesso:campos=${fields.join(',') || 'nenhum'}${lists.length > 0 ? `;${lists.join(',')}` : ''}`,
    ),
  };
}

/** Instrumenta somente a prévia. O turno real nunca passa por este wrapper. */
export function withPreviewToolTrace(tools: ToolSet, p: TurnPreview): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (typeof definition.execute !== 'function') return [name, definition];
      const executeOriginal = definition.execute.bind(definition);
      return [
        name,
        {
          ...definition,
          execute: (async (...args: Parameters<typeof executeOriginal>) => {
            try {
              const result = await executeOriginal(...args);
              const summary = traceResult(result);
              p.result.toolTrace.push({
                tool: name,
                argumentos: traceArguments(args[0]),
                resultado: summary.resultado,
                ok: summary.ok,
              });
              return result;
            } catch (error) {
              p.result.toolTrace.push({
                tool: name,
                argumentos: traceArguments(args[0]),
                resultado: `erro_lancado:${error instanceof Error ? error.name : 'desconhecido'}`,
                ok: false,
              });
              throw error;
            }
          }) as typeof definition.execute,
        },
      ];
    }),
  ) as ToolSet;
}
export function scenarioContext(
  messages: LeadContext['messages'],
  contact?: { name?: string; phone?: string },
): Extract<LeadContextResult, { ok: true }> {
  return {
    ok: true,
    context: {
      lead_id: '',
      contact: {
        name: contact?.name ?? 'Teste',
        phone: contact?.phone ?? null,
        email: null,
        tags: [],
        is_blocked: false,
      },
      conversation_id: null,
      last_human_decision: null,
      messages,
    },
    tokenCount: 0,
    lgpd: {
      isAnonymized: false,
      isProspecting: false,
      legalBasis: { basis: null, consentGranted: false, legalBasisRef: null, dataOrigin: null },
    },
  };
}
