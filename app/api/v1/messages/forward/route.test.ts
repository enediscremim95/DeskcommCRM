import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiError } from "@/lib/api/types";
import { DEFAULT_CHANNEL_PROVIDER } from "@/lib/channels";
import { forwardMessagesSchema } from "@/lib/schemas";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { forwardMessagesHandler } from "./_handler";

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OUTRA_ORG = "00000000-0000-4000-8000-000000000002";
const USUARIO = "00000000-0000-4000-8000-000000000003";
const CONVERSA_ORIGEM = "00000000-0000-4000-8000-000000000010";
const DESTINO_1 = "00000000-0000-4000-8000-000000000011";
const DESTINO_2 = "00000000-0000-4000-8000-000000000012";
const MSG_1 = "00000000-0000-4000-8000-000000000021";
const MSG_2 = "00000000-0000-4000-8000-000000000022";
const REQUEST_1 = "00000000-0000-4000-8000-000000000031";
const REQUEST_2 = "00000000-0000-4000-8000-000000000032";

function mensagem(overrides: Record<string, unknown> = {}) {
  return {
    id: MSG_1,
    organization_id: ORG,
    conversation_id: CONVERSA_ORIGEM,
    type: "text",
    status: "sent",
    body: "Primeira",
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    sent_via: "user",
    sent_at: "2026-11-06T10:00:00.000Z",
    metadata: {},
    revoked_at: null,
    ...overrides,
  };
}

function destino(id: string, organization_id = ORG) {
  return { id, organization_id, channel_sessions: { provider: DEFAULT_CHANNEL_PROVIDER } };
}

function banco(input: {
  messages?: Array<Record<string, unknown>>;
  destinations?: Array<Record<string, unknown>>;
  existing?: Array<Record<string, unknown>>;
}) {
  class Query {
    private filters = new Map<string, unknown>();
    constructor(private table: string) {}
    select() { return this; }
    eq(column: string, value: unknown) { this.filters.set(column, value); return this; }
    in(column: string, values: unknown[]) {
      const base = this.table === "conversations"
        ? (input.destinations ?? [])
        : this.filters.has("conversation_id")
          ? (input.existing ?? [])
          : (input.messages ?? []);
      const data = base.filter((row) => {
        for (const [key, value] of this.filters) if (row[key] !== value) return false;
        return values.includes(row[column]);
      });
      return Promise.resolve({ data, error: null });
    }
  }
  return { from: (table: string) => new Query(table) };
}

function admin(copy = vi.fn().mockResolvedValue({ error: null })) {
  return { storage: { from: vi.fn(() => ({ copy })) } };
}

const ctx = {
  organization_id: ORG,
  actor: { type: "user" as const, id: USUARIO },
  requestId: "req-forward",
  idioma: "pt-BR" as const,
};

async function executar(
  db: ReturnType<typeof banco>,
  destinationIds = [DESTINO_1],
  adminClient = admin(),
  requestId = REQUEST_1,
) {
  return forwardMessagesHandler(
    db as never,
    adminClient as never,
    ctx,
    { message_ids: [MSG_1], destination_conversation_ids: destinationIds, request_id: requestId },
    { sleep: vi.fn().mockResolvedValue(undefined) },
  );
}

describe("POST /api/v1/messages/forward", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendMessageHandler).mockResolvedValue({ id: "sent-id", status: "sent" } as never);
  });

  it("recusa 11 mensagens e 6 destinos no schema", () => {
    const ids = Array.from({ length: 11 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    expect(forwardMessagesSchema.safeParse({ message_ids: ids, destination_conversation_ids: [DESTINO_1] }).success).toBe(false);
    expect(forwardMessagesSchema.safeParse({ message_ids: [MSG_1], destination_conversation_ids: ids.slice(0, 6) }).success).toBe(false);
  });

  it("recusa mensagem de outra organização", async () => {
    const db = banco({ messages: [mensagem({ organization_id: OUTRA_ORG })], destinations: [destino(DESTINO_1)] });
    await expect(executar(db)).rejects.toMatchObject<ApiError>({ status: 403, code: "forbidden" });
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("recusa destino de outra organização ou fora do acesso do usuário", async () => {
    const db = banco({ messages: [mensagem()], destinations: [destino(DESTINO_1, OUTRA_ORG)] });
    await expect(executar(db)).rejects.toMatchObject<ApiError>({ status: 403, code: "forbidden" });
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("pula mensagem apagada e nota interna sem derrubar a operação", async () => {
    const db = banco({
      messages: [
        mensagem({ revoked_at: "2026-11-06T11:00:00.000Z" }),
        mensagem({ id: MSG_2, type: "internal_note", metadata: { internal_note: true } }),
      ],
      destinations: [destino(DESTINO_1)],
    });
    const result = await forwardMessagesHandler(db as never, admin() as never, ctx, {
      message_ids: [MSG_1, MSG_2], destination_conversation_ids: [DESTINO_1],
    });
    expect(result.destinations[0]?.messages).toEqual([
      expect.objectContaining({ source_message_id: MSG_1, status: "skipped", reason: "message_revoked" }),
      expect.objectContaining({ source_message_id: MSG_2, status: "skipped", reason: "internal_note" }),
    ]);
    expect(sendMessageHandler).not.toHaveBeenCalled();
  });

  it("falha em um destino não impede o seguinte", async () => {
    vi.mocked(sendMessageHandler)
      .mockRejectedValueOnce(new Error("contato_bloqueado"))
      .mockResolvedValueOnce({ id: "ok-2", status: "sent" } as never);
    const db = banco({ messages: [mensagem()], destinations: [destino(DESTINO_1), destino(DESTINO_2)] });
    const result = await executar(db, [DESTINO_1, DESTINO_2]);
    expect(result.destinations.map((item) => item.status)).toEqual(["failed", "sent"]);
    expect(sendMessageHandler).toHaveBeenCalledTimes(2);
  });

  it("copia mídia para o destino e preserva tipo, mime e legenda", async () => {
    const copy = vi.fn().mockResolvedValue({ error: null });
    const db = banco({
      messages: [mensagem({ type: "image", body: "Legenda", media_mime: "image/jpeg", media_size_bytes: 123, media_storage_path: `${ORG}/${CONVERSA_ORIGEM}/foto.jpg` })],
      destinations: [destino(DESTINO_1)],
    });
    await executar(db, [DESTINO_1], admin(copy));
    expect(copy).toHaveBeenCalledWith(
      `${ORG}/${CONVERSA_ORIGEM}/foto.jpg`,
      expect.stringMatching(new RegExp(`^${ORG}/${DESTINO_1}/forward-[0-9a-f-]+\\.jpg$`)),
    );
    expect(sendMessageHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organization_id: ORG }),
      expect.objectContaining({ conversation_id: DESTINO_1, type: "image", body: "Legenda", media_mime: "image/jpeg" }),
    );
  });

  it("envia em ordem cronológica, não na ordem do array recebido", async () => {
    const db = banco({
      messages: [
        mensagem({ id: MSG_1, body: "Depois", sent_at: "2026-11-06T11:00:00.000Z" }),
        mensagem({ id: MSG_2, body: "Antes", sent_at: "2026-11-06T10:00:00.000Z" }),
      ],
      destinations: [destino(DESTINO_1)],
    });
    await forwardMessagesHandler(db as never, admin() as never, ctx, {
      message_ids: [MSG_1, MSG_2], destination_conversation_ids: [DESTINO_1],
    }, { sleep: vi.fn().mockResolvedValue(undefined) });
    expect(vi.mocked(sendMessageHandler).mock.calls.map((call) => call[2].body)).toEqual(["Antes", "Depois"]);
  });

  it("retry encontra o id determinístico e não envia uma segunda vez", async () => {
    vi.mocked(sendMessageHandler).mockImplementationOnce(async (_supabase, handlerCtx) => ({
      id: handlerCtx.internalMessageId,
      status: "sent",
    }) as never);
    const primeiroDb = banco({ messages: [mensagem()], destinations: [destino(DESTINO_1)] });
    const primeiro = await executar(primeiroDb);
    const internalId = vi.mocked(sendMessageHandler).mock.calls[0]?.[1].internalMessageId;
    expect(internalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(primeiro.destinations[0]?.messages[0]).toMatchObject({ status: "sent", message_id: internalId });

    const retryDb = banco({
      messages: [mensagem()],
      destinations: [destino(DESTINO_1)],
      existing: [{ id: internalId, status: "sent", error_code: null, organization_id: ORG, conversation_id: DESTINO_1 }],
    });
    const retry = await executar(retryDb);
    expect(sendMessageHandler).toHaveBeenCalledTimes(1);
    expect(retry.destinations[0]?.messages[0]).toMatchObject({ status: "sent", message_id: internalId });
  });

  it("request_id diferente reenvia a mesma mídia e usa outro caminho no storage", async () => {
    const copy = vi.fn().mockResolvedValue({ error: null });
    const db = banco({
      messages: [mensagem({
        type: "image",
        media_mime: "image/jpeg",
        media_storage_path: `${ORG}/${CONVERSA_ORIGEM}/foto.jpg`,
      })],
      destinations: [destino(DESTINO_1)],
    });

    await executar(db, [DESTINO_1], admin(copy), REQUEST_1);
    await executar(db, [DESTINO_1], admin(copy), REQUEST_2);

    expect(sendMessageHandler).toHaveBeenCalledTimes(2);
    const idsInternos = vi.mocked(sendMessageHandler).mock.calls.map((call) => call[1].internalMessageId);
    expect(idsInternos[0]).not.toBe(idsInternos[1]);
    const caminhos = copy.mock.calls.map((call) => call[1]);
    expect(caminhos).toHaveLength(2);
    expect(caminhos[0]).not.toBe(caminhos[1]);
  });

  it("novo clique com outro request_id tenta novamente depois de uma falha", async () => {
    vi.mocked(sendMessageHandler)
      .mockResolvedValueOnce({ id: "failed-1", status: "failed", error_code: "channel_unavailable" } as never)
      .mockResolvedValueOnce({ id: "sent-2", status: "sent" } as never);
    const db = banco({ messages: [mensagem()], destinations: [destino(DESTINO_1)] });

    const primeira = await executar(db, [DESTINO_1], admin(), REQUEST_1);
    const segunda = await executar(db, [DESTINO_1], admin(), REQUEST_2);

    expect(primeira.destinations[0]?.messages[0]).toMatchObject({ status: "failed" });
    expect(segunda.destinations[0]?.messages[0]).toMatchObject({ status: "sent" });
    expect(sendMessageHandler).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessageHandler).mock.calls[0]?.[1].internalMessageId)
      .not.toBe(vi.mocked(sendMessageHandler).mock.calls[1]?.[1].internalMessageId);
  });

  it("sem request_id gera uma identidade nova por chamada", async () => {
    const db = banco({ messages: [mensagem()], destinations: [destino(DESTINO_1)] });
    const input = { message_ids: [MSG_1], destination_conversation_ids: [DESTINO_1] };

    await forwardMessagesHandler(db as never, admin() as never, ctx, input);
    await forwardMessagesHandler(db as never, admin() as never, ctx, input);

    expect(sendMessageHandler).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessageHandler).mock.calls[0]?.[1].internalMessageId)
      .not.toBe(vi.mocked(sendMessageHandler).mock.calls[1]?.[1].internalMessageId);
  });
});
