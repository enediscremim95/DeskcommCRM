import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencias = vi.hoisted(() => ({
  admin: null as unknown,
  client: null as unknown,
  audit: vi.fn(),
  aviso: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "segredo-cron",
    INTERNAL_SECRET: "",
    HISTORICO_WHATSAPP_ENABLED: "true",
  },
}));
vi.mock("@/lib/audit", () => ({ audit: dependencias.audit }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: dependencias.aviso, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => dependencias.admin }));
vi.mock("@/lib/waha/client", () => ({ getWahaClient: () => dependencias.client }));

import { GET } from "./route";

function dependenciasDaRodada() {
  const sessoes = [
    {
      id: "canal-falho",
      organization_id: "org-falha",
      waha_session_name: "sessao-falha",
      metadata: {},
    },
    {
      id: "canal-saudavel",
      organization_id: "org-saudavel",
      waha_session_name: "sessao-saudavel",
      metadata: {},
    },
  ];
  const inseridas: Array<Record<string, unknown>> = [];
  const atualizacao = {
    eq: () => atualizacao,
    then(resolve: (value: unknown) => void) { resolve({ data: null, error: null }); },
  };
  const admin = {
    from(tabela: string) {
      if (tabela === "channel_sessions") {
        const consulta = {
          select: () => consulta,
          eq: () => consulta,
          is: () => consulta,
          not: () => consulta,
          limit: async () => ({ data: sessoes, error: null }),
          update: () => atualizacao,
        };
        return consulta;
      }
      if (tabela === "contacts") {
        const consulta = {
          select: () => consulta,
          eq: () => consulta,
          in: () => consulta,
          is: () => consulta,
          limit: async () => ({
            data: [{ id: "contato-saudavel", phone_number: "+5511999999999" }],
            error: null,
          }),
        };
        return consulta;
      }
      if (tabela === "conversations") {
        const leitura = {
          eq: () => leitura,
          maybeSingle: async () => ({ data: { id: "conversa-saudavel", metadata: {} }, error: null }),
        };
        return { select: () => leitura, update: () => atualizacao };
      }
      if (tabela === "messages") {
        return {
          insert: async (linha: Record<string, unknown>) => {
            inseridas.push(linha);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
    rpc: async () => ({ error: null }),
  };
  const client = {
    listChats: vi.fn(async (nome: string) => {
      if (nome === "sessao-falha") throw new Error("waha_history_422");
      return { status: "ok" as const, data: [{ id: "5511999999999@c.us" }] };
    }),
    getChatMessages: vi.fn(async () => ({
      status: "ok" as const,
      data: [{
        id: "mensagem-saudavel",
        timestamp: Math.floor(Date.now() / 1000),
        body: "mensagem de teste",
        from: "5511999999999@c.us",
      }],
    })),
  };
  return { admin, client, inseridas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cron de histórico de conversas", () => {
  it("mantém a rodada em 200 e importa o canal saudável depois de um 422", async () => {
    const { admin, client, inseridas } = dependenciasDaRodada();
    dependencias.admin = admin;
    dependencias.client = client;

    const resposta = await GET(new Request("http://local/api/v1/cron/historico-conversas", {
      headers: { authorization: "Bearer segredo-cron" },
    }) as never);
    const corpo = (await resposta.json()) as {
      data: { mensagensInseridas: number; efeitosPorOrganizacao: Record<string, number> };
    };

    expect(resposta.status).toBe(200);
    expect(client.listChats).toHaveBeenCalledTimes(2);
    expect(inseridas).toHaveLength(1);
    expect(corpo.data.mensagensInseridas).toBe(1);
    expect(corpo.data.efeitosPorOrganizacao).toEqual({ "org-saudavel": 1 });
    expect(dependencias.aviso).toHaveBeenCalledWith(
      "historico.canal: canal indisponivel",
      expect.objectContaining({ codigo: "waha_history_422", channel_session_id: "canal-falho" }),
    );
  });
});
