import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadMock = vi.fn();
const updateEqMock = vi.fn();
const rpcMock = vi.fn();
const messageRow = {
  id: "msg1",
  organization_id: "org1",
  conversation_id: "conv1",
  channel_session_id: "session1",
  type: "image" as string,
  media_url: "http://localhost:3030/api/files/abc.jpg" as string | null,
  media_mime: "image/jpeg",
  media_storage_path: null as string | null,
  metadata: { raw_type: "image" },
};
const organizationRow: { settings: Record<string, unknown> } = {
  settings: { whatsapp_media_storage_enabled: true },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // Duas consultas agora, e cada uma com um encadeamento diferente: a
    // mensagem casa por `id` + `organization_id` (dois `eq`), a SESSÃO casa só
    // por `id` (um `eq`). O dublê responde pela TABELA porque, sem isso, a
    // consulta da sessão receberia a linha da mensagem — e o worker cairia em
    // "canal sem mídia" achando que a sessão não existe.
    from: (tabela: string) => ({
      select: () => {
        const linha = tabela === "channel_sessions"
          ? sessionRow
          : tabela === "organizations"
            ? organizationRow
            : messageRow;
        const resolvido = { maybeSingle: async () => ({ data: linha, error: null }) };
        return { eq: () => ({ ...resolvido, eq: () => resolvido }) };
      },
      update: (patch: Record<string, unknown>) => {
        updateEqMock(patch);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    }),
    storage: { from: () => ({ upload: uploadMock }) },
    rpc: rpcMock,
  }),
}));

/**
 * A sessão que o worker resolve para escolher QUEM baixa.
 *
 * `provider: "waha"` mantém este arquivo exercitando o mesmo caminho de sempre —
 * o que muda é que agora ele passa pelo adapter em vez de chamar o transporte
 * fixo. Se o dublê não existisse, o worker sairia em "canal sem mídia" e todos
 * os casos abaixo passariam por AUSÊNCIA.
 */
const sessionRow = {
  provider: "waha",
  waha_session_name: "default",
  meta_phone_number_id: null,
  zernio_account_id: null,
};

vi.mock("@/lib/messaging/media/waha-source", () => ({
  fetchWahaMedia: vi.fn(async () => ({ buffer: Buffer.from([1, 2, 3]), mime: "image/jpeg" })),
}));

import { persistMessageMedia } from "@/workers/media-persist-worker";
import { fetchWahaMedia } from "@/lib/messaging/media/waha-source";

function eventRow(attempts = 0) {
  return {
    id: "ev1",
    organization_id: "org1",
    event_type: "media.persist_requested",
    entity_kind: "message",
    entity_id: "msg1",
    payload: { message_id: "msg1" },
    metadata: {},
    consumed_by: [],
    attempts,
  };
}

describe("persistMessageMedia", () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({ error: null });
    updateEqMock.mockReset();
    rpcMock.mockReset().mockResolvedValue({ error: null });
    messageRow.media_storage_path = null;
    messageRow.media_url = "http://localhost:3030/api/files/abc.jpg";
    messageRow.type = "image";
    organizationRow.settings = { whatsapp_media_storage_enabled: true };
    vi.mocked(fetchWahaMedia).mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      mime: "image/jpeg",
    });
  });

  it("por padrão não sobe o binário e pede somente a derivação transitória", async () => {
    organizationRow.settings = {};
    const result = await persistMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        media_storage_path: null,
        media_size_bytes: null,
        metadata: expect.objectContaining({ media_status: "not_stored" }),
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "emit_event",
      expect.objectContaining({
        p_event_type: "media.derive_requested",
        p_metadata: expect.objectContaining({ transient: true }),
      }),
    );
  });

  it("descarta o ponteiro imediatamente quando o tipo não tem texto a extrair", async () => {
    organizationRow.settings = { whatsapp_media_storage_enabled: false };
    messageRow.type = "sticker";
    const result = await persistMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(updateEqMock).toHaveBeenCalledWith(expect.objectContaining({ media_url: null }));
  });

  it("baixa, sobe pro bucket e atualiza a mensagem", async () => {
    const result = await persistMessageMedia(eventRow());
    expect(result.status).toBe("ok");
    expect(uploadMock).toHaveBeenCalledWith(
      "org1/conv1/msg1.jpg",
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg", upsert: true }),
    );
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        media_storage_path: "org1/conv1/msg1.jpg",
        media_size_bytes: 3,
        metadata: expect.objectContaining({ media_status: "stored" }),
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "emit_event",
      expect.objectContaining({ p_event_type: "media.derive_requested", p_entity_id: "msg1" }),
    );
  });

  it("pula mensagem já persistida (idempotência)", async () => {
    messageRow.media_storage_path = "org1/conv1/msg1.jpg";
    const result = await persistMessageMedia(eventRow());
    expect(result.status).toBe("skipped");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("retorna error em falha de download com poucas tentativas, sem marcar failed", async () => {
    vi.mocked(fetchWahaMedia).mockRejectedValue(new Error("waha_media_503"));
    const result = await persistMessageMedia(eventRow(1));
    expect(result.status).toBe("error");
    expect(updateEqMock).not.toHaveBeenCalled();
  });

  it("marca failed quando o download falha na última tentativa (drain dead-letra em seguida)", async () => {
    vi.mocked(fetchWahaMedia).mockRejectedValue(new Error("waha_media_503"));
    const result = await persistMessageMedia(eventRow(4));
    expect(result.status).toBe("error");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ media_status: "failed" }) }),
    );
  });

  it("marca failed quando o upload falha na última tentativa", async () => {
    uploadMock.mockResolvedValue({ error: { message: "bucket unreachable" } });
    const result = await persistMessageMedia(eventRow(4));
    expect(result.status).toBe("error");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ media_status: "failed" }) }),
    );
  });
});
