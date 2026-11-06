import { describe, expect, it, vi } from "vitest";

import { baixarFotoDoPainel, MAX_BYTES_FOTO_PAINEL, tipoPelosBytes } from "./foto-do-painel";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);

describe("download seguro da foto do painel", () => {
  it("decide JPEG e PNG pelos bytes mágicos", () => {
    expect(tipoPelosBytes(JPEG)).toEqual({ mime: "image/jpeg", extensao: "jpg" });
    expect(tipoPelosBytes(PNG)).toEqual({ mime: "image/png", extensao: "png" });
    expect(tipoPelosBytes(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("resolve o host antes de baixar", async () => {
    const resolver = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response(PNG, { status: 200 }));

    const foto = await baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto.png", {
      resolver,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(resolver).toHaveBeenCalledWith("produtos.sublimando.com.br");
    expect(foto.mime).toBe("image/png");
  });

  it("recusa IP privado resolvido antes de chamar a rede", async () => {
    const fetchImpl = vi.fn();
    await expect(
      baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto.jpg", {
        resolver: async () => {
          throw new Error("unsafe_url:private_ip");
        },
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("unsafe_url:private_ip");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("não segue redirect para fora da lista", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://atacante.example/foto" } }),
    );
    await expect(
      baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto.jpg", {
        resolver: async () => undefined,
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("foto_host_nao_permitido");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("revalida host e DNS em redirect permitido", async () => {
    const resolver = vi.fn(async () => undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.yampi.io/foto.png" },
        }),
      )
      .mockResolvedValueOnce(new Response(PNG, { status: 200 }));

    await baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto", {
      resolver,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(resolver).toHaveBeenNthCalledWith(1, "produtos.sublimando.com.br");
    expect(resolver).toHaveBeenNthCalledWith(2, "cdn.yampi.io");
  });

  it("recusa pelo Content-Length antes de ler o corpo", async () => {
    const resposta = new Response(PNG, {
      status: 200,
      headers: { "content-length": String(MAX_BYTES_FOTO_PAINEL + 1) },
    });
    await expect(
      baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto.png", {
        resolver: async () => undefined,
        fetchImpl: (async () => resposta) as typeof fetch,
      }),
    ).rejects.toThrow("foto_maior_que_5mb");
  });

  it("interrompe o corpo que passa de 5 MB mesmo sem Content-Length", async () => {
    await expect(
      baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto.png", {
        resolver: async () => undefined,
        fetchImpl: (async () =>
          new Response(new Uint8Array(MAX_BYTES_FOTO_PAINEL + 1), {
            status: 200,
          })) as typeof fetch,
      }),
    ).rejects.toThrow("foto_maior_que_5mb");
  });

  it("mantém o timeout ativo enquanto o corpo ainda não terminou", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        async (_url: URL | RequestInfo, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      );
      const tentativa = baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto.png", {
        resolver: async () => undefined,
        fetchImpl: fetchImpl as typeof fetch,
      });
      const rejeicaoEsperada = expect(tentativa).rejects.toThrow("foto_timeout");

      await vi.advanceTimersByTimeAsync(5_001);
      await rejeicaoEsperada;
    } finally {
      vi.useRealTimers();
    }
  });

  it("não confia no Content-Type sem assinatura válida", async () => {
    await expect(
      baixarFotoDoPainel("https://produtos.sublimando.com.br/f/foto.jpg", {
        resolver: async () => undefined,
        fetchImpl: (async () =>
          new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          })) as typeof fetch,
      }),
    ).rejects.toThrow("foto_bytes_invalidos");
  });
});
