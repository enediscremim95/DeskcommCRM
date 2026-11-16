import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "7f99071c-43a9-4766-83cb-39d99bc4a80b";
const OTHER_ORG_ID = "18da582a-5cf2-4f75-a8a2-a49f0cd305ee";

const downloadMock = vi.fn();
const updateEqMock = vi.fn();
const messageRow = {
  id: "msg1",
  organization_id: ORG_ID,
  type: "audio" as string,
  channel_session_id: "session1",
  media_url: null as string | null,
  media_mime: "audio/ogg",
  media_storage_path: `${ORG_ID}/conv1/msg1.ogg` as string | null,
  media_derived_status: null as string | null,
  metadata: {} as Record<string, unknown>,
};
const sessionRow = {
  provider: "waha",
  waha_session_name: "default",
  meta_phone_number_id: null,
  zernio_account_id: null,
};
const { fetchWahaMediaMock } = vi.hoisted(() => ({ fetchWahaMediaMock: vi.fn() }));

/**
 * O dublê PRECISA saber em que tabela está.
 *
 * A versão anterior devolvia `messageRow` para qualquer `from(...)` e encadeava
 * exatamente dois `.eq`. Isso a tornava frágil nos dois eixos: o worker passou a
 * consultar `ai_purpose_bindings` (com três filtros) e o stub quebrava no
 * terceiro `.eq` — falha que aparece como "status error" e aponta para o lugar
 * errado. O Proxy devolve o chain para qualquer filtro, e a linha vem por
 * tabela: mensagem para `messages`, NENHUM binding para `ai_purpose_bindings`
 * (o caso "ninguém configurou nada", que é o comportamento anterior que estes
 * casos existem para preservar).
 */
const bindingDeVisao: { provider: string; model_id: string; credential_id: string | null } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const linha = tabela === "ai_purpose_bindings"
        ? bindingDeVisao
        : tabela === "channel_sessions"
          ? sessionRow
          : messageRow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const terminais: any = {
        maybeSingle: async () => ({ data: linha, error: null }),
        single: async () => ({ data: linha, error: null }),
        update: (patch: Record<string, unknown>) => {
          updateEqMock(patch);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: linha ? [linha] : [], error: null }).then(resolve),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = new Proxy(terminais, {
        get: (alvo, prop) =>
          prop in alvo ? alvo[prop as keyof typeof alvo] : () => chain,
      });
      return chain;
    },
    storage: { from: () => ({ download: downloadMock }) },
  }),
}));

vi.mock("@/lib/messaging/media/derive", () => ({
  deriveMediaText: vi.fn(async () => "transcrição do áudio real"),
}));

vi.mock("@/lib/ai/rag/extractors/pdf", () => ({
  extractPdfText: vi.fn(async () => "texto do PDF"),
  PDF_MEDIA_MAX_TEXT_CHARS: 8_000,
  PdfExtractError: class PdfExtractError extends Error {
    constructor(message: string, _cause?: unknown, public readonly code = "pdf_extract_failed") {
      super(message);
    }
  },
}));

vi.mock("@/lib/messaging/media/duration", () => ({
  probeMediaDuration: vi.fn(async () => 10),
}));

vi.mock("@/lib/messaging/media/audio-normalize", () => ({
  normalizeAudioForModel: vi.fn(async ({ buffer }: { buffer: Buffer }) => ({
    buffer,
    mime: "audio/mpeg",
  })),
}));

vi.mock("@/lib/messaging/media/video-derive", () => ({
  deriveVideoText: vi.fn(async (_buffer: Buffer, deps: {
    transcriber: { transcribe: (buffer: Buffer, mime: string) => Promise<string> };
    describeImage: (buffer: Buffer, mime: string) => Promise<string>;
  }) => {
    const audio = await deps.transcriber.transcribe(Buffer.from([1]), "audio/mpeg");
    const firstFrame = await deps.describeImage(Buffer.from([2]), "image/jpeg");
    const secondFrame = await deps.describeImage(Buffer.from([3]), "image/jpeg");
    return `${audio}\n${firstFrame}\n${secondFrame}`;
  }),
}));

vi.mock("@/lib/agent-engine/edge/llm/run-model-call", () => ({
  runModelCall: vi.fn(async () => ({ result: { text: "transcrição via OpenRouter" } })),
}));

vi.mock("@/lib/messaging/media/waha-source", () => ({
  fetchWahaMedia: fetchWahaMediaMock,
}));

// resolveOrgLlmConfig e generateText mockados: o worker precisa de credencial p/
// montar as deps, mas o teste não exercita rede.
vi.mock("@/lib/agent-engine/edge/llm/credentials", () => ({
  resolveOrgLlmConfig: vi.fn(async () => ({
    provider: "openai",
    apiKey: "sk-test",
    defaultModel: "gpt-5",
    params: {},
    enabledModels: [],
    orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
    orcamentoIndisponivelPorque: null,
  })),
}));

import { deriveMessageMedia } from "@/workers/media-derive-worker";
import { extractPdfText } from "@/lib/ai/rag/extractors/pdf";
import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { deriveMediaText } from "@/lib/messaging/media/derive";
import { resolveOrgLlmConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";

function eventRow(attempts = 0) {
  return {
    id: "ev1",
    organization_id: ORG_ID,
    event_type: "media.derive_requested",
    entity_kind: "message",
    entity_id: "msg1",
    payload: { message_id: "msg1" },
    metadata: {},
    consumed_by: [],
    attempts,
  };
}

describe("deriveMessageMedia", () => {
  beforeEach(() => {
    vi.stubEnv("MEDIA_OPENROUTER_ORG_IDS", ORG_ID);
    downloadMock.mockReset().mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });
    updateEqMock.mockReset();
    messageRow.media_derived_status = null;
    messageRow.type = "audio";
    messageRow.media_mime = "audio/ogg";
    messageRow.media_url = null;
    messageRow.media_storage_path = `${ORG_ID}/conv1/msg1.ogg`;
    messageRow.metadata = {};
    fetchWahaMediaMock.mockReset().mockResolvedValue({
      buffer: Buffer.from([4, 5, 6]),
      mime: "audio/ogg",
    });
    vi.mocked(deriveMediaText).mockReset().mockResolvedValue("transcrição do áudio real");
    vi.mocked(extractPdfText).mockReset().mockResolvedValue("texto do PDF");
    vi.mocked(resolveOrgLlmConfig).mockReset().mockResolvedValue({
      provider: "openai",
      apiKey: "sk-test",
      defaultModel: "gpt-5",
      params: {},
      enabledModels: [],
      orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
      orcamentoIndisponivelPorque: null,
    });
    vi.mocked(runModelCall).mockReset().mockResolvedValue({
      result: { text: "transcrição via OpenRouter" },
    } as Awaited<ReturnType<typeof runModelCall>>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("deriva pelo provider em memória e limpa o ponteiro quando o Storage está desligado", async () => {
    messageRow.media_storage_path = null;
    messageRow.media_url = "http://waha/file";
    messageRow.metadata = { media_status: "not_stored" };

    const r = await deriveMessageMedia(eventRow());

    expect(r.status).toBe("ok");
    expect(downloadMock).not.toHaveBeenCalled();
    expect(fetchWahaMediaMock).toHaveBeenCalled();
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({
        media_url: null,
        media_derived_text: "transcrição do áudio real",
        media_derived_status: "ready",
      }),
    );
  });

  it("baixa a mídia, deriva e grava ready", async () => {
    const r = await deriveMessageMedia(eventRow());
    expect(r.status).toBe("ok");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ media_derived_text: "transcrição do áudio real", media_derived_status: "ready" }),
    );
  });

  it("pula se já derivado (idempotência)", async () => {
    messageRow.media_derived_status = "ready";
    const r = await deriveMessageMedia(eventRow());
    expect(r.status).toBe("skipped");
    expect(deriveMediaText).not.toHaveBeenCalled();
  });

  it("tipo sem derivado (sticker) → skipped sem baixar", async () => {
    messageRow.type = "sticker";
    const r = await deriveMessageMedia(eventRow());
    expect(r.status).toBe("skipped");
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("erro na derivação marca failed sem repetir o evento", async () => {
    vi.mocked(deriveMediaText).mockRejectedValue(new Error("transcription_503"));
    const r = await deriveMessageMedia(eventRow(4));
    expect(r.status).toBe("skipped");
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ media_derived_status: "failed" }),
    );
  });

  it("falha de PDF é terminal, marca derivado indisponível e não retenta", async () => {
    messageRow.type = "document";
    messageRow.media_mime = "application/pdf";
    vi.mocked(extractPdfText).mockRejectedValue(
      new Error("PDF grande demais para extrair texto"),
    );

    const r = await deriveMessageMedia(eventRow());

    expect(r).toEqual({
      consumer_key: "media_derive_v1",
      status: "skipped",
      detail: "PDF grande demais para extrair texto",
    });
    expect(updateEqMock).toHaveBeenCalledWith(
      expect.objectContaining({ media_derived_status: "failed" }),
    );
    expect(deriveMediaText).not.toHaveBeenCalled();
  });

  it("organização com OpenAI continua usando o endpoint de transcrição atual", async () => {
    vi.stubEnv("MEDIA_OPENROUTER_ORG_IDS", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "via Whisper" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(deriveMediaText).mockImplementation(async (_kind, buffer, mime, deps) =>
      deps.transcriber.transcribe(buffer, mime));

    const result = await deriveMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(runModelCall).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ purpose: "percepcao_de_audio" }),
    );
  });

  it("organização só com OpenRouter usa o modelo de áudio configurado", async () => {
    vi.mocked(resolveOrgLlmConfig).mockImplementation(async (_db, _cfg, _org, override) => {
      if (override?.provider === "openai") throw new Error("sem OpenAI");
      return {
        provider: "openrouter",
        apiKey: "or-test",
        defaultModel: "modelo-chat",
        params: {},
        enabledModels: [],
        orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
        orcamentoIndisponivelPorque: null,
      };
    });
    vi.mocked(deriveMediaText).mockImplementation(async (_kind, buffer, mime, deps) =>
      deps.transcriber.transcribe(buffer, mime));

    const result = await deriveMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(runModelCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        purpose: "percepcao_de_audio",
        model: "google/gemini-2.5-flash",
        llmOverride: { provider: "openrouter", credentialId: null },
      }),
    );
  });

  it("imagem em organização OpenRouter usa visão e registra no seam", async () => {
    messageRow.type = "image";
    messageRow.media_mime = "image/jpeg";
    vi.mocked(resolveOrgLlmConfig).mockResolvedValue({
      provider: "openrouter",
      apiKey: "or-test",
      defaultModel: "modelo-chat",
      params: {},
      enabledModels: [],
      orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
      orcamentoIndisponivelPorque: null,
    });
    vi.mocked(deriveMediaText).mockImplementation(async (_kind, buffer, mime, deps) =>
      deps.describeImage(buffer, mime));

    const result = await deriveMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(runModelCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ purpose: "percepcao_de_imagem" }),
    );
  });

  it("vídeo autorizado usa OpenRouter na faixa de áudio e nos quadros", async () => {
    messageRow.type = "video";
    messageRow.media_mime = "video/mp4";
    vi.mocked(resolveOrgLlmConfig).mockImplementation(async (_db, _cfg, _org, override) => {
      if (override?.provider === "openai") throw new Error("sem OpenAI");
      return {
        provider: "openrouter",
        apiKey: "or-test",
        defaultModel: "modelo-chat",
        params: {},
        enabledModels: [],
        orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
        orcamentoIndisponivelPorque: null,
      };
    });
    vi.mocked(deriveMediaText).mockImplementation(async (_kind, buffer, mime, deps) =>
      deps.deriveVideo!(buffer, mime));

    const result = await deriveMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(vi.mocked(runModelCall).mock.calls.map((call) => call[2].purpose)).toEqual([
      "percepcao_de_audio",
      "percepcao_de_imagem",
      "percepcao_de_imagem",
    ]);
  });

  it("PDF textual continua local e não chama modelo", async () => {
    messageRow.type = "document";
    messageRow.media_mime = "application/pdf";

    const result = await deriveMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(updateEqMock).toHaveBeenCalledWith(expect.objectContaining({
      media_derived_text: "texto do PDF",
      media_derived_status: "ready",
    }));
    expect(runModelCall).not.toHaveBeenCalled();
  });

  it("PDF escaneado usa visão do OpenRouter", async () => {
    messageRow.type = "document";
    messageRow.media_mime = "application/pdf";
    vi.mocked(extractPdfText).mockRejectedValue(
      new PdfExtractError("sem texto", undefined, "pdf_image_only"),
    );

    const result = await deriveMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(runModelCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        purpose: "percepcao_de_documento",
        model: "google/gemini-2.5-flash",
      }),
    );
  });

  it.each(["audio", "image", "video", "document"])(
    "organização fora da lista não chama OpenRouter para %s",
    async (kind) => {
      vi.stubEnv("MEDIA_OPENROUTER_ORG_IDS", OTHER_ORG_ID);
      messageRow.type = kind;
      messageRow.media_mime = kind === "image"
        ? "image/jpeg"
        : kind === "video"
          ? "video/mp4"
          : kind === "document"
            ? "application/pdf"
            : "audio/ogg";
      vi.mocked(resolveOrgLlmConfig).mockImplementation(async (_db, _cfg, _org, override) => {
        if (override?.provider === "openai") throw new Error("sem OpenAI");
        return {
          provider: "openrouter",
          apiKey: "or-test",
          defaultModel: "modelo-chat",
          params: {},
          enabledModels: [],
          orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
          orcamentoIndisponivelPorque: null,
        };
      });
      vi.mocked(runModelCall).mockImplementation(async () => {
        throw new Error("provedor falso não poderia ter sido chamado");
      });
      if (kind === "document") {
        vi.mocked(extractPdfText).mockRejectedValue(
          new PdfExtractError("sem texto", undefined, "pdf_image_only"),
        );
      } else {
        vi.mocked(deriveMediaText).mockImplementation(async (_kind, buffer, mime, deps) => {
          if (kind === "audio") return deps.transcriber.transcribe(buffer, mime);
          if (kind === "image") return deps.describeImage(buffer, mime);
          return deps.deriveVideo!(buffer, mime);
        });
      }

      const result = await deriveMessageMedia(eventRow());

      expect(result.status).toBe(kind === "document" ? "skipped" : "ok");
      expect(runModelCall).not.toHaveBeenCalled();
    },
  );

  it("lista vazia desliga todo fallback OpenRouter", async () => {
    vi.stubEnv("MEDIA_OPENROUTER_ORG_IDS", "");
    vi.mocked(resolveOrgLlmConfig).mockImplementation(async (_db, _cfg, _org, override) => {
      if (override?.provider === "openai") throw new Error("sem OpenAI");
      return {
        provider: "openrouter",
        apiKey: "or-test",
        defaultModel: "modelo-chat",
        params: {},
        enabledModels: [],
        orcamento: { modo: "off", tetoCents: 0, efetivoEm: null, limiarPct: 80 },
        orcamentoIndisponivelPorque: null,
      };
    });
    vi.mocked(deriveMediaText).mockImplementation(async (_kind, buffer, mime, deps) =>
      deps.transcriber.transcribe(buffer, mime));
    vi.mocked(runModelCall).mockImplementation(async () => {
      throw new Error("provedor falso não poderia ter sido chamado");
    });

    const result = await deriveMessageMedia(eventRow());

    expect(result.status).toBe("ok");
    expect(runModelCall).not.toHaveBeenCalled();
  });
});
