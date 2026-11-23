/**
 * Regra de 16/11/2026 (Enedi): a IA e as automações só movem o lead PARA A FRENTE no funil;
 * nunca voltam etapa, nunca saem de Ganho/Perdido; humano segue livre. Mesmo guarda para
 * todas as organizações — nenhum ID de organização é usado na regra, só parametrizamos.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type * as ActivityEmitterTypes from "@/lib/leads/activity-emitter";
import type { HandlerCtx } from "@/lib/api/handlers/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/atendimento/origem", () => ({ observeServiceOrigin: vi.fn(async () => ({ kind: "unavailable", reason: "test" })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ error: null }) }) }));
vi.mock("@/lib/leads/activity-emitter", async (orig) => ({
  ...(await orig<typeof ActivityEmitterTypes>()),
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
}));

import { avaliaMovimentoAutomatico } from "@/lib/leads/kanban-guard";
import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { sincronizaEstagioDoAgente } from "@/lib/leads/agent-stage-sync";
import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/create-or-move-lead";

const ORGS = [
  "Sublimando PR", "Imobiliária A", "Rota Automotiva", "Lecote",
  "Apquita Autos", "Bendito Ponto", "Sublimando SC", "Imobiliária Sul",
] as const;
const slug = (n: string) => n.toLowerCase().normalize("NFD").replace(/[^a-z]+/g, "-");

/** Funil de cada org: 1ª etapa, Agendamento, Proposta e as finais. Posições idênticas em qualquer org. */
function funilDe(org: string) {
  const p = `pipe-${slug(org)}`;
  const mk = (k: string, position: number, extra: object = {}) => ({
    id: `${k}-${slug(org)}`, organization_id: `org-${slug(org)}`, pipeline_id: p, name: k, position,
    is_won: false, is_lost: false, is_archived: false, agent_stage_hint: null, ...extra,
  });
  return [
    mk("entrada", 1000, { agent_stage_hint: "contacted" }),
    mk("agendamento", 2000, { agent_stage_hint: "scheduling" }),
    mk("proposta", 3000, { agent_stage_hint: "negotiating" }),
    mk("ganho", 4000, { is_won: true }),
    mk("perdido", 5000, { is_lost: true }),
  ];
}

type Row = Record<string, unknown>;
/** Banco em memória mínimo: o que moveLeadHandler, o sync e a ação usam. */
function bancoDe(org: string, stageAtual: string, status = "open") {
  const orgId = `org-${slug(org)}`;
  const tabelas: Record<string, Row[]> = {
    crm_stages: funilDe(org),
    crm_leads: [{
      id: "lead-1", organization_id: orgId, pipeline_id: `pipe-${slug(org)}`, stage_id: `${stageAtual}-${slug(org)}`,
      contact_id: "contato-1", status, updated_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", last_activity_at: null,
    }],
    crm_lead_activities: [],
  };
  let escritas = 0;
  const client = {
    rpc: async (fn: string) => ({ data: fn === "fn_reservar_posicao_lead_na_etapa" ? 1000 : null, error: null }),
    from(t: string) {
      const filtros: Array<[string, unknown]> = [];
      let patch: Row | null = null;
      const linhas = () => (tabelas[t] ?? []).filter((r) => filtros.every(([k, v]) => r[k] === v));
      const exec = () => {
        if (patch) {
          const alvo = linhas();
          alvo.forEach((r) => Object.assign(r, patch));
          escritas += alvo.length ? 1 : 0;
          return { data: alvo, error: null };
        }
        return { data: linhas(), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b, order: () => b, limit: () => b,
        eq: (k: string, v: unknown) => { filtros.push([k, v]); return b; },
        update: (p: Row) => { patch = p; return b; },
        maybeSingle: async () => { const r = exec(); return { data: (r.data as Row[])[0] ?? null, error: null }; },
        then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(exec()).then(f, r),
      };
      return b;
    },
  };
  return {
    db: client as unknown as SupabaseClient,
    etapaDoLead: () => String(tabelas.crm_leads![0]!.stage_id),
    escritas: () => escritas,
    orgId,
    id: (k: string) => `${k}-${slug(org)}`,
  };
}

const ctxDe = (organization_id: string, type: "user" | "ai_agent" | "webhook_source"): HandlerCtx =>
  ({ organization_id, requestId: "req", actor: { type, id: "ator", role: "admin" } }) as HandlerCtx;

describe.each(ORGS)("Kanban só avança — %s", (org) => {
  beforeEach(() => vi.clearAllMocks());
  const funil = funilDe(org);
  const [entrada, agendamento, proposta, ganho, perdido] = funil;
  const guarda = (a: (typeof funil)[number], b: (typeof funil)[number]) => avaliaMovimentoAutomatico(a, b);

  it("guarda puro: avanço permitido; retrocesso, 1ª etapa e finais bloqueados", () => {
    expect(guarda(entrada!, agendamento!)).toEqual({ permitido: true });
    expect(guarda(agendamento!, proposta!)).toEqual({ permitido: true });
    expect(guarda(agendamento!, entrada!)).toEqual({ permitido: false, motivo: "so_avanca" });
    expect(guarda(proposta!, agendamento!)).toEqual({ permitido: false, motivo: "so_avanca" });
    expect(guarda(agendamento!, agendamento!)).toEqual({ permitido: false, motivo: "ja_esta_la" });
    expect(guarda(agendamento!, ganho!)).toEqual({ permitido: false, motivo: "etapa_final_so_humano" });
    expect(guarda(agendamento!, perdido!)).toEqual({ permitido: false, motivo: "etapa_final_so_humano" });
    expect(guarda(ganho!, proposta!)).toEqual({ permitido: false, motivo: "etapa_final_so_humano" });
    expect(guarda(perdido!, entrada!)).toEqual({ permitido: false, motivo: "etapa_final_so_humano" });
  });

  it.each(["ai_agent", "webhook_source"] as const)("%s: avanço permitido move o card", async (tipo) => {
    const b = bancoDe(org, "agendamento");
    await moveLeadHandler(b.db, ctxDe(b.orgId, tipo), "lead-1", { to_stage_id: b.id("proposta") });
    expect(b.etapaDoLead()).toBe(b.id("proposta"));
  });

  it.each(["ai_agent", "webhook_source"] as const)("%s: lead em Agendamento que responde mensagem NÃO volta à 1ª etapa", async (tipo) => {
    const b = bancoDe(org, "agendamento");
    await expect(moveLeadHandler(b.db, ctxDe(b.orgId, tipo), "lead-1", { to_stage_id: b.id("entrada") }))
      .rejects.toMatchObject({ status: 403 });
    expect(b.etapaDoLead()).toBe(b.id("agendamento"));
    expect(b.escritas()).toBe(0);
  });

  it("IA não retrocede de Proposta para Agendamento", async () => {
    const b = bancoDe(org, "proposta");
    await expect(moveLeadHandler(b.db, ctxDe(b.orgId, "ai_agent"), "lead-1", { to_stage_id: b.id("agendamento") }))
      .rejects.toMatchObject({ status: 403 });
    expect(b.etapaDoLead()).toBe(b.id("proposta"));
  });

  it.each([["ganho", "won"], ["perdido", "lost"]] as const)("IA não tira o lead de %s", async (etapa, status) => {
    const b = bancoDe(org, etapa, status);
    for (const destino of ["entrada", "agendamento", "proposta"])
      await expect(moveLeadHandler(b.db, ctxDe(b.orgId, "ai_agent"), "lead-1", { to_stage_id: b.id(destino) }))
        .rejects.toMatchObject({ status: 403 });
    expect(b.etapaDoLead()).toBe(b.id(etapa));
  });

  it("IA não ganha nem perde (etapas finais seguem humanas)", async () => {
    const b = bancoDe(org, "proposta");
    for (const f of ["ganho", "perdido"])
      await expect(moveLeadHandler(b.db, ctxDe(b.orgId, "ai_agent"), "lead-1", { to_stage_id: b.id(f) }))
        .rejects.toMatchObject({ status: 403 });
    expect(b.etapaDoLead()).toBe(b.id("proposta"));
  });

  it("humano move livre: voltar etapa e sair de Perdido", async () => {
    const a = bancoDe(org, "agendamento");
    await moveLeadHandler(a.db, ctxDe(a.orgId, "user"), "lead-1", { to_stage_id: a.id("entrada") });
    expect(a.etapaDoLead()).toBe(a.id("entrada"));
    const p = bancoDe(org, "perdido", "lost");
    await moveLeadHandler(p.db, ctxDe(p.orgId, "user"), "lead-1", { to_stage_id: p.id("agendamento") });
    expect(p.etapaDoLead()).toBe(p.id("agendamento"));
  });

  it("agente (sync de passo): mensagem com passo da 1ª etapa não tira o lead de Agendamento", async () => {
    const b = bancoDe(org, "agendamento");
    const r = await sincronizaEstagioDoAgente(b.db as never, { organizationId: b.orgId, contactId: "contato-1", passo: "contacted" });
    expect(r).toMatchObject({ moveu: false, motivo: "bloqueado_pelo_guarda", detalhe: "so_avanca" });
    expect(b.etapaDoLead()).toBe(b.id("agendamento"));
  });

  it("agente (sync de passo): avanço real move", async () => {
    const b = bancoDe(org, "agendamento");
    const r = await sincronizaEstagioDoAgente(b.db as never, { organizationId: b.orgId, contactId: "contato-1", passo: "negotiating" });
    expect(r).toMatchObject({ moveu: true, motivo: "movido" });
    expect(b.etapaDoLead()).toBe(b.id("proposta"));
  });

  it("automação create_or_move_lead em message.received: não volta à 1ª etapa; avanço configurado move", async () => {
    const b = bancoDe(org, "agendamento");
    const exec = (stage: string) => getAction("create_or_move_lead")!.execute({
      organizationId: b.orgId, ruleId: "regra-1", admin: b.db, context: { contact: { id: "contato-1" } },
      event: { id: "ev", event_type: "message.received" },
    } as never, { pipeline_id: `pipe-${slug(org)}`, stage_id: b.id(stage) });
    const volta = await exec("entrada");
    expect(volta).toMatchObject({ status: "skipped", detail: { reason: "so_avanca" } });
    expect(b.etapaDoLead()).toBe(b.id("agendamento"));
    const frente = await exec("proposta");
    expect(frente).toMatchObject({ status: "success", detail: { moved: "lead-1" } });
    expect(b.etapaDoLead()).toBe(b.id("proposta"));
  });
});

describe("sem exceção por organização", () => {
  it.each(["lib/leads/kanban-guard.ts", "supabase/migrations/20261116180000_0312_kanban_so_avanca.sql"])("%s sem UUID literal", (f) => {
    expect(readFileSync(f, "utf8")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
