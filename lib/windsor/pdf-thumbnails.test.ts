// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { fetchPdfThumbnailDataUri, preloadPdfThumbnails } from "./pdf-thumbnails";

const publicLookup = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("miniaturas seguras do PDF", () => {
  it.each(["file:///etc/passwd", "data:image/png;base64,AA==", "ftp://cdn.example/imagem.png"])(
    "recusa esquema fora de HTTP(S): %s",
    async (url) => {
      const fetchFn = vi.fn();

      expect(await fetchPdfThumbnailDataUri(url, { fetchFn })).toBeNull();
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://localhost/imagem.png",
    "http://127.0.0.1/imagem.png",
    "http://[::1]/imagem.png",
  ])("recusa destino local %s antes do fetch", async (url) => {
    const fetchFn = vi.fn();

    expect(await fetchPdfThumbnailDataUri(url, { fetchFn })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("recusa domínio que resolve para IP privado", async () => {
    const fetchFn = vi.fn();
    const lookupFn = vi.fn(async () => [{ address: "10.0.0.8", family: 4 }]);

    expect(
      await fetchPdfThumbnailDataUri("https://cdn.exemplo.test/imagem.png", {
        fetchFn,
        lookupFn,
      }),
    ).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("converte imagem pública válida para data URI", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(png, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );

    const result = await fetchPdfThumbnailDataUri("https://cdn.example/imagem.png", {
      fetchFn,
      lookupFn: publicLookup,
    });

    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("aplica timeout curto à requisição", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const fetchFn = vi.fn(async () => new Response(png, { status: 200 }));

    await fetchPdfThumbnailDataUri("https://cdn.example/imagem.png", {
      fetchFn,
      lookupFn: publicLookup,
    });

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls[0]?.[0]).toBeLessThanOrEqual(3_000);
    timeout.mockRestore();
  });

  it("também limita o tempo da resolução DNS", async () => {
    vi.useFakeTimers();
    try {
      const lookupFn = vi.fn(
        () => new Promise<Array<{ address: string; family: number }>>(() => {}),
      );
      const pending = fetchPdfThumbnailDataUri("https://cdn.example/imagem.png", { lookupFn });

      await vi.advanceTimersByTimeAsync(3_000);

      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recusa corpo maior que o limite mesmo sem content-length confiável", async () => {
    const oversized = new Uint8Array(500 * 1024 + 1);
    oversized.set(png);
    const fetchFn = vi.fn(async () => new Response(oversized, { status: 200 }));

    await expect(
      fetchPdfThumbnailDataUri("https://cdn.example/grande.png", {
        fetchFn,
        lookupFn: publicLookup,
      }),
    ).resolves.toBeNull();
  });

  it("falha de fetch vira ausência de miniatura e nunca rejeita o lote", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("rede indisponível");
    });

    await expect(
      preloadPdfThumbnails([{ thumbnail_url: "https://cdn.example/falha.png", name: "Anúncio" }], {
        fetchFn,
        lookupFn: publicLookup,
      }),
    ).resolves.toEqual([
      { thumbnail_url: "https://cdn.example/falha.png", name: "Anúncio", thumbnail_data_uri: null },
    ]);
  });

  it("busca no máximo doze miniaturas", async () => {
    const fetchFn = vi.fn(async () => new Response(png, { status: 200 }));
    const rows = Array.from({ length: 13 }, (_, index) => ({
      name: `Anúncio ${index + 1}`,
      thumbnail_url: `https://cdn.example/${index + 1}.png`,
    }));

    const result = await preloadPdfThumbnails(rows, { fetchFn, lookupFn: publicLookup });

    expect(fetchFn).toHaveBeenCalledTimes(12);
    expect(result[11]?.thumbnail_data_uri).toMatch(/^data:image\/png;base64,/);
    expect(result[12]?.thumbnail_data_uri).toBeNull();
  });
});
