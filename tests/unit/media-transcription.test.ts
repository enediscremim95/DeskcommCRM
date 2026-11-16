import { describe, expect, it, vi } from "vitest";

import { apiTranscriptionProvider } from "@/lib/messaging/media/transcription";

describe("apiTranscriptionProvider", () => {
  it("POSTa multipart pro endpoint de transcrição e devolve o texto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "olá, quero comprar" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = apiTranscriptionProvider({ apiKey: "sk-test" }, fetchMock);
    const text = await provider.transcribe(Buffer.from([1, 2, 3]), "audio/ogg; codecs=opus");
    expect(text).toBe("olá, quero comprar");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("propaga erro HTTP do provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    const provider = apiTranscriptionProvider({ apiKey: "bad" }, fetchMock);
    await expect(provider.transcribe(Buffer.from([1]), "audio/ogg")).rejects.toThrow(/transcription_401/);
  });

  it("repete uma vez somente em falha transitória", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "agora foi" }), { status: 200 }));
    const provider = apiTranscriptionProvider(
      { apiKey: "teste", maxNetworkRetries: 1, timeoutMs: 1000 },
      fetchMock,
    );
    await expect(provider.transcribe(Buffer.from([1]), "audio/mpeg")).resolves.toBe("agora foi");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("não repete erro permanente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 401 }));
    const provider = apiTranscriptionProvider({ apiKey: "teste", maxNetworkRetries: 1 }, fetchMock);
    await expect(provider.transcribe(Buffer.from([1]), "audio/mpeg")).rejects.toThrow("transcription_401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
