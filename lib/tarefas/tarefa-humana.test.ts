import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarFakeSupabase } from "./fake-supabase.test-helper";
import { criarTarefaHumana, escolherResponsavel, interpolarTarefa, type MembroAtivo } from "./tarefa-humana";

const m = (userId: string, papel: MembroAtivo["papel"], desde = "2026-01-01"): MembroAtivo => ({ userId, papel, desde });

describe("escolherResponsavel — a régua de quem recebe", () => {
  const membros = [m("sdr", "agent"), m("dono", "manager"), m("admin-velho", "admin", "2025-01-01"), m("admin-novo", "admin"), m("leitor", "viewer")];

  it("1º degrau: quem atende a conversa", () => {
    expect(
      escolherResponsavel({ membros, atendenteDaConversa: "sdr", responsaveisDoNumero: ["dono"], donoDoNegocio: "dono" }),
    ).toEqual({ userId: "sdr", origem: "atendente_da_conversa" });
  });

  it("2º degrau: responsável pelo número quando a conversa não tem atendente", () => {
    expect(
      escolherResponsavel({ membros, atendenteDaConversa: null, responsaveisDoNumero: ["fantasma", "sdr"], donoDoNegocio: "dono" }),
    ).toEqual({ userId: "sdr", origem: "responsavel_do_numero" });
  });

  it("3º degrau: dono do negócio", () => {
    expect(
      escolherResponsavel({ membros, atendenteDaConversa: null, responsaveisDoNumero: [], donoDoNegocio: "dono" }),
    ).toEqual({ userId: "dono", origem: "dono_do_negocio" });
  });

  it("4º degrau: o admin mais antigo; membro revogado/viewer nunca vale", () => {
    expect(
      escolherResponsavel({ membros, atendenteDaConversa: "leitor", responsaveisDoNumero: ["ex-membro"], donoDoNegocio: "ex-membro" }),
    ).toEqual({ userId: "admin-velho", origem: "administrador" });
  });

  it("ninguém elegível: sem responsável (o aviso ainda sai)", () => {
    expect(
      escolherResponsavel({ membros: [m("leitor", "viewer")], atendenteDaConversa: null, responsaveisDoNumero: [], donoDoNegocio: null }),
    ).toEqual({ userId: null, origem: "sem_responsavel" });
  });

  it("interpola {{nome}} e cai em 'o contato' sem nome", () => {
    expect(interpolarTarefa("Ligar para {{nome}}", "Ana")).toBe("Ligar para Ana");
    expect(interpolarTarefa("Ligar para {{nome}}", "  ")).toBe("Ligar para o contato");
  });

  it("nome com $&, $' ou $$ entra literal (callback, não padrão de replace)", () => {
    expect(interpolarTarefa("Ligar para {{nome}}", "A$&B$'C$$D")).toBe("Ligar para A$&B$'C$$D");
  });
});

function banco() {
  return criarFakeSupabase(
    {
      conversations: [
        { id: "conv-A", organization_id: "org-A", contact_id: "c-A", assigned_to_user_id: null, channel_session_id: "canal-A", last_message_at: "2026-11-24" },
        { id: "conv-B", organization_id: "org-B", contact_id: "c-B", assigned_to_user_id: "sdr-B", channel_session_id: "canal-B", last_message_at: "2026-11-24" },
      ],
      channel_routing_policies: [
        { id: "pol-A", organization_id: "org-A", channel_session_id: "canal-A" },
        { id: "pol-B", organization_id: "org-B", channel_session_id: "canal-B" },
      ],
      channel_routing_responsibles: [
        { policy_id: "pol-A", organization_id: "org-A", user_id: "sdr-A", created_at: "2026-01-01" },
        { policy_id: "pol-B", organization_id: "org-B", user_id: "sdr-B", created_at: "2026-01-01" },
      ],
      crm_leads: [{ id: "lead-A", organization_id: "org-A", contact_id: "c-A", status: "open", owner_user_id: "dono-A", updated_at: "2026-11-24" }],
      user_organizations: [
        { user_id: "sdr-A", organization_id: "org-A", role: "agent", revoked_at: null, created_at: "2026-01-01" },
        { user_id: "dono-A", organization_id: "org-A", role: "manager", revoked_at: null, created_at: "2026-01-01" },
        { user_id: "sdr-B", organization_id: "org-B", role: "agent", revoked_at: null, created_at: "2026-01-01" },
      ],
      crm_tasks: [],
      agent_inbox_items: [],
    },
    { crm_tasks: [["organization_id", "source_key"]], agent_inbox_items: [["organization_id", "dedupe_key"]] },
  );
}

const entrada = {
  organizationId: "org-A",
  sourceKey: "followup:enr:tarefa:3",
  title: "Ligar para Ana",
  contactId: "c-A",
  conversationId: "conv-A",
  tituloDoAviso: "Tarefa para a equipe criada pelo follow-up",
};

describe("criarTarefaHumana", () => {
  it("atribui ao responsável do número da conversa, abre um aviso e não toca outra organização", async () => {
    const db = banco();
    const r = await criarTarefaHumana(db as unknown as SupabaseClient, entrada);
    expect(r).toMatchObject({ criada: true, avisoAberto: true, assignedTo: "sdr-A", origem: "responsavel_do_numero", leadId: "lead-A" });
    expect(db.tabelas.crm_tasks).toHaveLength(1);
    expect(db.tabelas.crm_tasks![0]).toMatchObject({
      organization_id: "org-A",
      assigned_to: "sdr-A",
      lead_id: "lead-A",
      contact_id: "c-A",
      status: "pending",
      priority: "high",
      source_key: entrada.sourceKey,
    });
    expect(db.tabelas.agent_inbox_items).toEqual([
      expect.objectContaining({ organization_id: "org-A", kind: "human_task", ref_kind: "conversation", ref_id: "conv-A" }),
    ]);
  });

  it("é idempotente pela chave: o retry não duplica tarefa nem aviso", async () => {
    const db = banco();
    await criarTarefaHumana(db as unknown as SupabaseClient, entrada);
    const r2 = await criarTarefaHumana(db as unknown as SupabaseClient, entrada);
    expect(r2).toMatchObject({ criada: false, avisoAberto: false });
    expect(db.tabelas.crm_tasks).toHaveLength(1);
    expect(db.tabelas.agent_inbox_items).toHaveLength(1);
  });

  it("retry depois de crash entre tarefa e aviso abre o aviso que faltou, uma vez", async () => {
    const db = banco();
    db.tabelas.crm_tasks!.push({ id: "t-velha", organization_id: "org-A", source_key: entrada.sourceKey, assigned_to: "sdr-A", alerted_at: null });
    const r = await criarTarefaHumana(db as unknown as SupabaseClient, entrada);
    expect(r).toMatchObject({ taskId: "t-velha", criada: false, avisoAberto: true });
    expect(db.tabelas.crm_tasks).toHaveLength(1);
    expect(db.tabelas.agent_inbox_items).toHaveLength(1);
  });

  it("crash DEPOIS do aviso e ANTES do alerted_at: o retry não abre segundo aviso (dedupe_key)", async () => {
    const db = banco();
    db.tabelas.crm_tasks!.push({ id: "t-velha", organization_id: "org-A", source_key: entrada.sourceKey, assigned_to: "sdr-A", alerted_at: null });
    db.tabelas.agent_inbox_items!.push({ id: "aviso-velho", organization_id: "org-A", kind: "human_task", dedupe_key: "crm_task:t-velha" });
    const r = await criarTarefaHumana(db as unknown as SupabaseClient, entrada);
    expect(r).toMatchObject({ taskId: "t-velha", avisoAberto: false });
    expect(db.tabelas.agent_inbox_items).toHaveLength(1);
    expect(db.tabelas.crm_tasks![0]!.alerted_at).not.toBeNull();
  });

  it("execuções concorrentes do mesmo passo: uma tarefa, um aviso", async () => {
    const db = banco();
    await Promise.all([1, 2, 3].map(() => criarTarefaHumana(db as unknown as SupabaseClient, entrada)));
    expect(db.tabelas.crm_tasks).toHaveLength(1);
    expect(db.tabelas.agent_inbox_items).toHaveLength(1);
    expect(db.tabelas.agent_inbox_items![0]).toMatchObject({ dedupe_key: `crm_task:${db.tabelas.crm_tasks![0]!.id}` });
  });

  it("a mesma chave em outra organização é outra tarefa (isolamento)", async () => {
    const db = banco();
    await criarTarefaHumana(db as unknown as SupabaseClient, entrada);
    const r = await criarTarefaHumana(db as unknown as SupabaseClient, {
      ...entrada,
      organizationId: "org-B",
      contactId: "c-B",
      conversationId: "conv-B",
    });
    expect(r).toMatchObject({ criada: true, assignedTo: "sdr-B", origem: "atendente_da_conversa" });
    expect(db.tabelas.crm_tasks!.map((t) => t.organization_id)).toEqual(["org-A", "org-B"]);
  });

  it("conversa de outra organização não é lida: cai para o dono do negócio", async () => {
    const db = banco();
    const r = await criarTarefaHumana(db as unknown as SupabaseClient, { ...entrada, conversationId: "conv-B" });
    expect(r).toMatchObject({ assignedTo: "dono-A", origem: "dono_do_negocio" });
  });
});
