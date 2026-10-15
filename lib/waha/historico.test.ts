import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WahaPayload } from "./envelope";
import {
  importarPayloadsSilenciosamente,
  contatoDoChat,
  executarRodadaHistorico,
  JANELA_RECENTE_MS,
  LIMITE_POR_CHAT,
  proximoCursorHistorico,
} from "./historico";

const efeitos = vi.hoisted(() => ({ posEntrada: vi.fn(), followup: vi.fn(), notificacao: vi.fn() }));
vi.mock("@/lib/channels/pos-entrada", () => ({ aplicarEfeitosPosEntrada: efeitos.posEntrada }));
vi.mock("@/lib/followup/engine", () => ({ runFollowup: efeitos.followup }));
vi.mock("@/lib/notifications/email.handler", () => ({ handleEmailNotification: efeitos.notificacao }));

interface EstadoFake {
  ids: Set<string>;
  linhas: Array<Record<string, unknown>>;
  projecoes: Array<Record<string, unknown>>;
}

function adminFake(estado: EstadoFake) {
  return {
    from(tabela: string) {
      if (tabela === "conversations") {
        const leitura = {
          eq: () => leitura,
          maybeSingle: async () => ({ data: { id: "conv-1", metadata: {} }, error: null }),
        };
        return { select: () => leitura };
      }
      if (tabela === "messages") {
        return {
          insert: async (linha: Record<string, unknown>) => {
            const id = String(linha.external_id);
            if (estado.ids.has(id)) return { error: { code: "23505", message: "duplicate" } };
            estado.ids.add(id);
            estado.linhas.push(linha);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
    rpc(_nome: string, args: Record<string, unknown>) {
      estado.projecoes.push(args);
      return Promise.resolve({ error: null });
    },
  };
}

function payload(id: string, timestamp: number, extra: Partial<WahaPayload> = {}): WahaPayload {
  return { id, timestamp, body: `texto ${id}`, from: "5511999999999@c.us", ...extra };
}

const sessao = {
  id: "session-1",
  organization_id: "org-1",
  waha_session_name: "session-name",
  metadata: {},
};
const contato = { id: "contact-1", phone_number: "+5511999999999" };

describe("importação silenciosa do histórico", () => {
  beforeEach(() => vi.clearAllMocks());

  it("é idempotente, preserva fromMe e não chama caminhos de efeito", async () => {
    const estado: EstadoFake = { ids: new Set(), linhas: [], projecoes: [] };
    const admin = adminFake(estado);
    const agora = Math.floor(Date.now() / 1000);
    const entrada = [payload("in-1", agora), payload("out-1", agora + 1, { fromMe: true })];

    const primeira = await importarPayloadsSilenciosamente({ admin: admin as never, sessao, contato, payloads: entrada });
    const segunda = await importarPayloadsSilenciosamente({ admin: admin as never, sessao, contato, payloads: entrada });

    expect(primeira.inseridas).toBe(2);
    expect(segunda.duplicadas).toBe(2);
    expect(estado.linhas).toHaveLength(2);
    expect(estado.linhas.map((l) => l.direction)).toEqual(["inbound", "outbound"]);
    expect(estado.linhas[1]?.sent_via).toBe("external_device");
    expect(efeitos.posEntrada).not.toHaveBeenCalled();
    expect(efeitos.followup).not.toHaveBeenCalled();
    expect(efeitos.notificacao).not.toHaveBeenCalled();
  });

  it("limita 200 mensagens e respeita a janela de 30 dias", async () => {
    const estado: EstadoFake = { ids: new Set(), linhas: [], projecoes: [] };
    const agora = Math.floor(Date.now() / 1000);
    const recentes = Array.from({ length: LIMITE_POR_CHAT + 5 }, (_, i) => payload(`m-${i}`, agora - i));
    recentes.push(payload("antiga", Math.floor((Date.now() - JANELA_RECENTE_MS - 60_000) / 1000)));

    const resultado = await importarPayloadsSilenciosamente({
      admin: adminFake(estado) as never,
      sessao,
      contato,
      payloads: recentes,
      desde: new Date(Date.now() - JANELA_RECENTE_MS),
    });

    expect(resultado.inseridas).toBe(LIMITE_POR_CHAT);
    expect(estado.linhas).toHaveLength(LIMITE_POR_CHAT);
    expect(estado.linhas.some((l) => l.external_id === "antiga")).toBe(false);
  });

  it("registra mídia antiga sem URL e com motivo explícito", async () => {
    const estado: EstadoFake = { ids: new Set(), linhas: [], projecoes: [] };
    await importarPayloadsSilenciosamente({
      admin: adminFake(estado) as never,
      sessao,
      contato,
      payloads: [payload("foto", Math.floor(Date.now() / 1000), {
        type: "image",
        hasMedia: true,
        body: null,
        _data: { message: { imageMessage: { caption: "legenda" } } },
      })],
    });
    expect(estado.linhas[0]?.media_url).toBeNull();
    expect(estado.linhas[0]?.body).toBe("legenda");
    expect(estado.linhas[0]?.metadata).toMatchObject({
      historico: true,
      media_status: "not_stored",
      media_not_stored_reason: "anterior a conexao",
    });
  });

  it("avança o cursor entre rodadas sem voltar", () => {
    expect(proximoCursorHistorico(20, 20)).toBe(40);
    expect(proximoCursorHistorico(40, 7)).toBe(47);
  });

  it("persiste o cursor da sessão para a rodada seguinte", async () => {
    const atualizacoes: Array<Record<string, unknown>> = [];
    const querySessoes = {
      select: () => querySessoes,
      eq: () => querySessoes,
      is: () => querySessoes,
      not: () => querySessoes,
      limit: async () => ({
        data: [{
          id: "session-1",
          organization_id: "org-1",
          waha_session_name: "session-name",
          metadata: { historico_cursor: 20 },
        }],
        error: null,
      }),
    };
    const queryContatos = {
      select: () => queryContatos,
      eq: () => queryContatos,
      in: () => queryContatos,
      is: () => queryContatos,
      limit: async () => ({ data: [], error: null }),
    };
    const atualizacao = {
      eq: () => atualizacao,
      then(resolve: (value: unknown) => void) { resolve({ data: null, error: null }); },
    };
    const admin = {
      from(tabela: string) {
        if (tabela === "channel_sessions") {
          return {
            ...querySessoes,
            update: (valor: Record<string, unknown>) => {
              atualizacoes.push(valor);
              return atualizacao;
            },
          };
        }
        if (tabela === "contacts") return queryContatos;
        throw new Error(`tabela inesperada: ${tabela}`);
      },
    };
    const listChats = vi.fn(async () => ({
      status: "ok" as const,
      data: [{ id: "5511900000001@c.us" }, { id: "5511900000002@c.us" }],
    }));

    await executarRodadaHistorico({
      admin: admin as never,
      client: { listChats } as never,
      habilitado: true,
    });

    expect(listChats).toHaveBeenCalledWith("session-name", { limit: 20, offset: 20 });
    expect(atualizacoes.at(-1)).toMatchObject({
      metadata: { historico_cursor: 22, historico_importado_em: expect.any(String) },
    });
  });

  it("contato inexistente não é criado pela importação em massa", async () => {
    const tabelas: string[] = [];
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      is: () => query,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const admin = { from: (tabela: string) => { tabelas.push(tabela); return query; } };

    await expect(contatoDoChat(admin as never, "org-1", "5511999999999@c.us")).resolves.toBeNull();
    expect(tabelas).toEqual(["contacts"]);
  });
});
