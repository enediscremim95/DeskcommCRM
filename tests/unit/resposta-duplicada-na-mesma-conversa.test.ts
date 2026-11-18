import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inboundJaRespondidoPeloAgente } from "@/lib/agent-engine/agent/inbound-turn";
import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const INBOUND_1 = "44444444-4444-4444-8444-444444444444";
const INBOUND_2 = "55555555-5555-4555-8555-555555555555";
const AGENTE = "66666666-6666-4666-8666-666666666666";

type Outbound = {
  agentId: string;
  respondedThroughInboundId: string;
  status: string;
};

function bancoDoContexto() {
  return {
    async query<T>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("from contacts")) {
        return {
          rows: [
            {
              name: "Cliente",
              display_name: "Cliente",
              email: null,
              phone_number: null,
              tags: [],
              is_blocked: false,
              source: "whatsapp",
              consent: null,
              is_anonymized: false,
            },
          ] as T[],
        };
      }
      if (sql.includes("from crm_lead_activities")) return { rows: [] };
      if (sql.includes("from messages")) {
        return {
          rows: [
            {
              id: INBOUND_2,
              direction: "inbound",
              type: "text",
              body: "Segunda mensagem",
              media_url: null,
              media_storage_path: null,
              media_mime: null,
              media_derived_text: null,
              sent_at: new Date("2026-11-04T18:39:55Z"),
            },
            {
              id: INBOUND_1,
              direction: "inbound",
              type: "text",
              body: "Primeira mensagem",
              media_url: null,
              media_storage_path: null,
              media_mime: null,
              media_derived_text: null,
              sent_at: new Date("2026-11-04T18:39:29Z"),
            },
          ] as T[],
        };
      }
      if (sql.includes("from demandas")) return { rows: [] };
      throw new Error(`query inesperada: ${sql}`);
    },
  };
}

function bancoDaGuarda(outbounds: Outbound[]) {
  const ordem = new Map([
    [INBOUND_1, 1],
    [INBOUND_2, 2],
  ]);
  return {
    async query<T>(_sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
      const agentId = values?.[2];
      const inboundId = values?.[3];
      const respondido = outbounds.some(
        (outbound) =>
          outbound.agentId === agentId &&
          (ordem.get(outbound.respondedThroughInboundId) ?? 0) >=
            (ordem.get(String(inboundId)) ?? Number.POSITIVE_INFINITY) &&
          ["queued", "sending", "sent", "delivered", "read"].includes(outbound.status),
      );
      return { rows: [{ respondido }] as T[] };
    },
  };
}

describe("dois inbounds seguidos na mesma conversa", () => {
  it("carimba a resposta com o inbound mais novo que entrou no contexto", async () => {
    const resultado = await getLeadContext(
      bancoDoContexto() as never,
      {} as never,
      { tenantId: ORG, leadId: CONTATO, conversationId: CONVERSA, fuso: "America/Sao_Paulo" },
      { historyLimit: 20, maxTokens: 8_000 },
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.latestInboundMessageId).toBe(INBOUND_2);
  });

  it("o segundo turno não responde de novo quando o primeiro já cobriu seu inbound", async () => {
    const outbounds: Outbound[] = [];
    const db = bancoDaGuarda(outbounds);

    await expect(
      inboundJaRespondidoPeloAgente(db as never, {
        tenantId: ORG,
        conversationId: CONVERSA,
        agentId: AGENTE,
        inboundMessageId: INBOUND_2,
      }),
    ).resolves.toBe(false);

    outbounds.push({
      agentId: AGENTE,
      respondedThroughInboundId: INBOUND_2,
      status: "sent",
    });

    await expect(
      inboundJaRespondidoPeloAgente(db as never, {
        tenantId: ORG,
        conversationId: CONVERSA,
        agentId: AGENTE,
        inboundMessageId: INBOUND_2,
      }),
    ).resolves.toBe(true);
  });

  it("não descarta a segunda mensagem quando a primeira resposta não chegou a lê-la", async () => {
    const db = bancoDaGuarda([
      { agentId: AGENTE, respondedThroughInboundId: INBOUND_1, status: "sent" },
    ]);

    await expect(
      inboundJaRespondidoPeloAgente(db as never, {
        tenantId: ORG,
        conversationId: CONVERSA,
        agentId: AGENTE,
        inboundMessageId: INBOUND_2,
      }),
    ).resolves.toBe(false);
  });

  it("o retry do primeiro job não reenvia quando sua resposta já cobriu até o segundo inbound", async () => {
    const db = bancoDaGuarda([
      { agentId: AGENTE, respondedThroughInboundId: INBOUND_2, status: "sent" },
    ]);

    await expect(
      inboundJaRespondidoPeloAgente(db as never, {
        tenantId: ORG,
        conversationId: CONVERSA,
        agentId: AGENTE,
        inboundMessageId: INBOUND_1,
      }),
    ).resolves.toBe(true);
  });
});

describe("a guarda está no caminho real", () => {
  const turno = readFileSync(
    join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
    "utf8",
  );
  const handler = turno.slice(turno.indexOf("export function createInboundTurnHandler"));

  it("descarta o job coberto antes de iniciar o turno caro", () => {
    const guarda = handler.indexOf("inboundJaRespondidoPeloAgente");
    const execucao = handler.indexOf("await runAgentTurn");
    expect(guarda).toBeGreaterThan(-1);
    expect(execucao).toBeGreaterThan(guarda);
  });

  it("não inicia o turno quando não consegue conferir a resposta anterior", () => {
    const guarda = handler.indexOf("inboundJaRespondidoPeloAgente");
    const execucao = handler.indexOf("await runAgentTurn");
    const trechoDaGuarda = handler.slice(guarda, execucao);
    expect(trechoDaGuarda).toContain("throw err");
  });

  it("a mensagem persistida leva o limite de histórico que a produziu", () => {
    const envio = readFileSync(
      join(process.cwd(), "lib/agent-engine/edge/crm/send-message.ts"),
      "utf8",
    );
    expect(turno).toContain("respondedThroughInboundId");
    expect(envio).toContain("responded_through_inbound_id");
  });
});
