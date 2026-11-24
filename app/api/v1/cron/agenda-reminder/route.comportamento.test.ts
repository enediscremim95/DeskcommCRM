import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { criarFakeSupabase } from "@/lib/tarefas/fake-supabase.test-helper";

/**
 * O cron do lembrete, de ponta a ponta sobre um banco em memória (achados da
 * revisão da branch feat/followup-kroebel-sdr):
 * - tipo de OUTRA organização não empresta opt-in/modelo;
 * - formato novo (link + variáveis) é OPT-IN: desligado = texto de antes, byte a byte;
 * - posse antes do envio: duas rodadas / carimbo perdido não mandam duas vezes;
 * - exceção no envio devolve a posse; envio guarda mensagem e conversa.
 */
let db: ReturnType<typeof criarFakeSupabase>;
const envio = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/env", () => ({ env: { INTERNAL_CRON_SECRET: "segredo-de-teste" } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/automation/start-conversation", () => ({ ensureConversation: vi.fn(async () => "conv-lembrete") }));
vi.mock("@/lib/automation/janela-do-canal", () => ({ adiarAteAJanelaAbrir: vi.fn(async () => null) }));
vi.mock("@/lib/automation/throttle", () => ({ espacarEnvio: vi.fn(async () => undefined) }));
vi.mock("@/lib/agenda/escalonamento-do-lembrete", () => ({
  escalonarLembretesSemResposta: vi.fn(async () => ({ examinados: 0, escalados: 0, confirmados: 0, nao_aplicaveis: 0, aguardando: 0, erros: 0 })),
}));
vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: (...a: unknown[]) => envio(...a) }));

const { GET, montarLembrete } = await import("./route");

const inicio = new Date(Date.now() + 30 * 60_000).toISOString(); // dentro dos 60 min

function tipo(over: Record<string, unknown> = {}) {
  return {
    organization_id: "org-A",
    name: "Apresentação",
    reminder_enabled: true,
    reminder_minutes_before: 60,
    reminder_template_name: null,
    location_details: null,
    reminder_rich_format: false,
    ...over,
  };
}

function montar(t = tipo(), templates: Record<string, unknown>[] = []) {
  db = criarFakeSupabase({
    calendar_appointments: [
      {
        id: "ap-1",
        organization_id: "org-A",
        contact_id: "c-1",
        title: "Apresentação",
        status: "confirmed",
        starts_at: inicio,
        location_details: null,
        meeting_state: "ready",
        meeting_url: "https://meet.google.com/abc-defg-hij",
        reminder_sent_at: null,
        reminder_claimed_at: null,
        calendar_event_types: t,
      },
    ],
    contacts: [{ id: "c-1", organization_id: "org-A", name: "Ana", display_name: null, phone_number: "5511999990000", is_blocked: false }],
    channel_sessions: [{ id: "canal-1", organization_id: "org-A", status: "WORKING" }],
    organizations: [{ id: "org-A", timezone: "America/Sao_Paulo", locale: "pt-BR" }],
    message_templates: templates,
  });
}

const req = () => new NextRequest("http://x/api/v1/cron/agenda-reminder", { headers: { authorization: "Bearer segredo-de-teste" } });
const corpoEnviado = () => (envio.mock.calls[0]![2] as { body: string }).body;
const linha = () => db.tabelas.calendar_appointments![0]!;

describe("cron agenda-reminder — comportamento", () => {
  beforeEach(() => {
    envio.mockReset();
    envio.mockResolvedValue({ id: "msg-1", status: "sent" });
  });

  it("tipo de OUTRA organização no vínculo: não envia", async () => {
    montar(tipo({ organization_id: "org-B" }));
    await GET(req());
    expect(envio).not.toHaveBeenCalled();
    expect(linha().reminder_sent_at).toBeNull();
  });

  it("formato novo DESLIGADO: texto padrão de antes, sem o link, byte a byte", async () => {
    montar();
    await GET(req());
    const esperado = montarLembrete({
      nomeDoContato: "Ana",
      titulo: "Apresentação",
      quando: new Date(inicio),
      timezone: "America/Sao_Paulo",
      local: null,
      idioma: "pt-BR",
    });
    expect(corpoEnviado()).toBe(esperado);
    expect(corpoEnviado()).not.toContain("meet.google.com");
  });

  it("formato novo DESLIGADO: modelo existente sai literal, sem interpolar", async () => {
    montar(tipo({ reminder_template_name: "lembrete" }), [
      { organization_id: "org-A", shortcut: "lembrete", title: "Lembrete", body: "Oi {{nome}}, até {{hora}}! $& {{link}}" },
    ]);
    await GET(req());
    expect(corpoEnviado()).toBe("Oi {{nome}}, até {{hora}}! $& {{link}}");
  });

  it("formato novo LIGADO: link no padrão e variáveis no modelo", async () => {
    montar(tipo({ reminder_rich_format: true, reminder_template_name: "lembrete" }), [
      { organization_id: "org-A", shortcut: "lembrete", title: "Lembrete", body: "Oi {{nome}}! Sala: {{link}}" },
    ]);
    await GET(req());
    expect(corpoEnviado()).toBe("Oi Ana! Sala: https://meet.google.com/abc-defg-hij");
  });

  it("guarda mensagem e conversa do envio, com id de mensagem determinístico (sem pular o envio de mensagem não enviada)", async () => {
    montar();
    await GET(req());
    const ctx = envio.mock.calls[0]![1] as { internalMessageId?: string; deduplicateInternalMessage?: boolean };
    expect(ctx.internalMessageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // SEM `deduplicateInternalMessage`: com ele, o handler devolveria uma
    // mensagem `queued` reencontrada sem enviá-la.
    expect(ctx.deduplicateInternalMessage).toBeUndefined();
    expect(linha()).toMatchObject({ reminder_message_id: "msg-1", reminder_conversation_id: "conv-lembrete" });
    expect(linha().reminder_sent_at).not.toBeNull();
  });

  it("posse antes do envio: a segunda rodada não manda de novo", async () => {
    montar();
    await GET(req());
    await GET(req());
    expect(envio).toHaveBeenCalledTimes(1);
  });

  it("rodadas concorrentes: só uma envia", async () => {
    montar();
    await Promise.all([GET(req()), GET(req())]);
    expect(envio).toHaveBeenCalledTimes(1);
  });

  it("exceção no envio devolve a posse para a próxima rodada", async () => {
    montar();
    envio.mockRejectedValueOnce(new Error("canal fora do ar"));
    await GET(req());
    expect(linha().reminder_sent_at).toBeNull();
    expect(linha().reminder_claimed_at).toBeNull();
    await GET(req());
    expect(envio).toHaveBeenCalledTimes(2);
    expect(linha().reminder_message_id).toBe("msg-1");
  });

  describe("o lembrete não some depois de uma queda (revisão 2)", () => {
    it("reminder_sent_at só é gravado DEPOIS do envio, como na main", async () => {
      montar();
      envio.mockImplementationOnce(async () => {
        expect(linha().reminder_sent_at).toBeNull();
        expect(linha().reminder_claimed_at).not.toBeNull();
        return { id: "msg-1", status: "sent" };
      });
      await GET(req());
      expect(linha().reminder_sent_at).not.toBeNull();
      expect(linha().reminder_claimed_at).toBeNull();
    });

    it("rodada que morreu com a posse: depois do lease (4 min) a próxima envia", async () => {
      montar();
      linha().reminder_claimed_at = new Date(Date.now() - 5 * 60_000).toISOString();
      await GET(req());
      expect(envio).toHaveBeenCalledTimes(1);
      expect(linha().reminder_sent_at).not.toBeNull();
    });

    it("posse recente de outra rodada é respeitada (não envia em dobro)", async () => {
      montar();
      linha().reminder_claimed_at = new Date(Date.now() - 60_000).toISOString();
      await GET(req());
      expect(envio).not.toHaveBeenCalled();
    });

    it("carimbo falhou depois do envio: nada encerra; após o lease chama de novo com o MESMO id e carimba", async () => {
      montar();
      const original = db.from.bind(db);
      let falhou = false;
      (db as { from: (t: string) => unknown }).from = (t: string) => {
        const b = original(t) as { update: (p: Record<string, unknown>) => { eq: (...a: unknown[]) => unknown } };
        if (t !== "calendar_appointments" || falhou) return b;
        const update = b.update;
        b.update = (p: Record<string, unknown>) => {
          if ("reminder_sent_at" in p && p.reminder_sent_at) {
            falhou = true;
            const fake: Record<string, unknown> = {};
            fake.eq = () => fake;
            fake.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "rede" } }).then(res);
            return fake as never;
          }
          return update(p) as never;
        };
        return b;
      };
      await GET(req());
      // Nada foi encerrado: sem carimbo, sem referência — o escalonamento nem enxerga.
      expect(linha().reminder_sent_at).toBeNull();
      expect(linha().reminder_message_id ?? null).toBeNull();
      expect(linha().reminder_claimed_at).not.toBeNull();
      // Lease vence; a próxima rodada reencontra a mensagem pelo id determinístico.
      linha().reminder_claimed_at = new Date(Date.now() - 5 * 60_000).toISOString();
      await GET(req());
      const ids = envio.mock.calls.map((c) => (c[1] as { internalMessageId: string }).internalMessageId);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
      expect(linha()).toMatchObject({ reminder_message_id: "msg-1", reminder_conversation_id: "conv-lembrete" });
      expect(linha().reminder_sent_at).not.toBeNull();
    });
  });

  /**
   * Dublê que imita a regra REAL de `sendMessageHandler` quando o id interno já
   * existe (app/api/v1/messages/_handler.ts): sem `deduplicateInternalMessage`,
   * `sent/delivered/read/failed` voltam sem enviar; `queued/sending` seguem o
   * caminho normal e ENVIAM.
   */
  describe("reentrega depois de queda com a mensagem já inserida (revisão 3)", () => {
    const naRede: string[] = [];
    const caixa = new Map<string, { id: string; status: string; created_at: string }>();
    function handlerReal(statusDoEnvio = "sent") {
      envio.mockImplementation(async (_db: unknown, ctx: { internalMessageId: string; deduplicateInternalMessage?: boolean }) => {
        const ja = caixa.get(ctx.internalMessageId);
        if (ja && (ctx.deduplicateInternalMessage || ["sent", "delivered", "read", "failed"].includes(ja.status))) return { ...ja };
        const m = ja ?? { id: ctx.internalMessageId, status: "queued", created_at: new Date().toISOString() };
        caixa.set(m.id, m);
        naRede.push(m.id);
        m.status = statusDoEnvio;
        return { ...m };
      });
    }
    beforeEach(() => {
      naRede.length = 0;
      caixa.clear();
    });
    const idDoLembrete = async () => (await import("@/lib/agenda/lembrete")).idDaMensagemDoLembrete("ap-1");

    it("mensagem ficou QUEUED (queda antes de sair): a reentrega de fato envia", async () => {
      montar();
      handlerReal();
      const id = await idDoLembrete();
      caixa.set(id, { id, status: "queued", created_at: new Date(Date.now() - 10 * 60_000).toISOString() });
      await GET(req());
      expect(naRede).toEqual([id]);
      expect(linha()).toMatchObject({ reminder_message_id: id });
      expect(linha().reminder_sent_at).not.toBeNull();
    });

    it("mensagem já SAIU (queda depois do envio): não reenvia, só carimba", async () => {
      montar();
      handlerReal();
      const id = await idDoLembrete();
      caixa.set(id, { id, status: "sent", created_at: new Date(Date.now() - 10 * 60_000).toISOString() });
      await GET(req());
      expect(naRede).toEqual([]);
      expect(linha()).toMatchObject({ reminder_message_id: id });
    });

    it("mensagem FALHOU numa tentativa anterior: reenvia com id derivado (como a main faria)", async () => {
      montar();
      handlerReal();
      const id = await idDoLembrete();
      caixa.set(id, { id, status: "failed", created_at: new Date(Date.now() - 10 * 60_000).toISOString() });
      await GET(req());
      expect(naRede).toHaveLength(1);
      expect(naRede[0]).not.toBe(id);
      expect(linha().reminder_message_id).toBe(naRede[0]);
    });

    it("falha NESTA tentativa é o desfecho (sem laço de reenvio)", async () => {
      montar();
      handlerReal("failed");
      await GET(req());
      expect(naRede).toHaveLength(1);
      expect(linha().reminder_sent_at).not.toBeNull();
    });
  });
});

