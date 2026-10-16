import { afterEach, describe, expect, it, vi } from "vitest";

import { CONVERSAS_IGNORADAS, NOWEB_STORE, WahaClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("cliente de histórico", () => {
  it("lista conversas pelas mais recentes usando o campo temporal aceito pelo NOWEB", async () => {
    const requisicoes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      requisicoes.push(String(url));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }));
    const cliente = new WahaClient("http://canal.local", "segredo");

    await cliente.listChats("sessão 1", { limit: 20, offset: 7 });

    const url = new URL(requisicoes[0]!);
    expect(url.pathname).toBe("/api/sess%C3%A3o%201/chats");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("7");
    expect(url.searchParams.get("sortBy")).toBe("conversationTimestamp");
    expect(url.searchParams.get("sortOrder")).toBe("desc");
  });

  it("devolve store_desligado no 400 conhecido sem lançar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      statusCode: 400,
      message: "Enable NOWEB store config.noweb.store.enabled=True and config.noweb.store.full_sync=True when starting a new session",
    }), { status: 400, headers: { "content-type": "application/json" } })));
    const cliente = new WahaClient("http://canal.local", "segredo");

    await expect(cliente.listChats("sessao", { limit: 20, offset: 0 }))
      .resolves.toEqual({ status: "store_desligado" });
  });

  it("pagina mensagens sem baixar mídia e codifica o chat", async () => {
    const requisicoes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      requisicoes.push(String(url));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }));
    const cliente = new WahaClient("http://canal.local", "segredo");

    await cliente.getChatMessages("sessão 1", "5511@c.us", { limit: 200, offset: 7, downloadMedia: false });

    const url = new URL(requisicoes[0]!);
    expect(url.pathname).toContain("/api/sess%C3%A3o%201/chats/5511%40c.us/messages");
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("offset")).toBe("7");
    expect(url.searchParams.get("downloadMedia")).toBe("false");
  });

  it("cria sessão nova com store e fullSync ligados", async () => {
    let corpo: unknown;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        corpo = JSON.parse(String(init.body));
        return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        name: "sessao",
        status: "STOPPED",
        engine: "NOWEB",
        config: { ignore: CONVERSAS_IGNORADAS, noweb: { store: NOWEB_STORE } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new WahaClient("http://canal.local", "segredo").createSession("sessao");

    expect(corpo).toMatchObject({
      config: { ignore: CONVERSAS_IGNORADAS, noweb: { store: { enabled: true, fullSync: true } } },
    });
  });
});
