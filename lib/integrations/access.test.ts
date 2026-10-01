import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { integrationAccessFromRows, type IntegrationPermissionRow } from "./types";

const redisFake = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  failGet: false,
  failDel: false,
  get: vi.fn(async (key: string) => {
    if (redisFake.failGet) throw new Error("redis_offline");
    return redisFake.store.get(key) ?? null;
  }),
  set: vi.fn(async (key: string, value: unknown) => {
    redisFake.store.set(key, structuredClone(value));
    return "OK";
  }),
  del: vi.fn(async (key: string) => {
    if (redisFake.failDel) throw new Error("redis_offline");
    return redisFake.store.delete(key) ? 1 : 0;
  }),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = redisFake.get;
    set = redisFake.set;
    del = redisFake.del;
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    UPSTASH_REDIS_REST_URL: "http://redis.test",
    UPSTASH_REDIS_REST_TOKEN: "token-de-teste",
  },
}));

const {
  __resetIntegrationAccessCacheForTests,
  comCacheDeAcessoAsIntegracoes,
  invalidarCacheDeAcessoAsIntegracoes,
} = await import("./access-cache");

function fonteCom(rows: IntegrationPermissionRow[]) {
  const ler = vi.fn(async () => integrationAccessFromRows(rows));
  return { ler };
}

const aberto: IntegrationPermissionRow[] = [
  { integration: "whatsapp", client_visible: true, client_can_reconnect: true },
  { integration: "n8n", client_visible: true, client_can_reconnect: false },
  { integration: "windsor", client_visible: true, client_can_reconnect: false },
];

const fechado: IntegrationPermissionRow[] = [
  { integration: "whatsapp", client_visible: false, client_can_reconnect: false },
  { integration: "n8n", client_visible: false, client_can_reconnect: false },
  { integration: "windsor", client_visible: false, client_can_reconnect: false },
];

beforeEach(() => {
  redisFake.store.clear();
  redisFake.failGet = false;
  redisFake.failDel = false;
  redisFake.get.mockClear();
  redisFake.set.mockClear();
  redisFake.del.mockClear();
  __resetIntegrationAccessCacheForTests();
});

describe("cache do acesso às integrações", () => {
  it("a única escrita invalida o cache somente depois do banco confirmar", () => {
    const route = readFileSync(
      "app/api/v1/admin/tenants/[id]/integrations/route.ts",
      "utf8",
    );
    const falha = route.indexOf("if (error)");
    const invalidacao = route.indexOf("await invalidarCacheDeAcessoAsIntegracoes(id)");
    const auditoria = route.indexOf("await audit(", invalidacao);

    expect(falha).toBeGreaterThan(-1);
    expect(invalidacao).toBeGreaterThan(falha);
    expect(auditoria).toBeGreaterThan(invalidacao);
  });

  it("usa a organização na chave e evita a segunda ida ao banco", async () => {
    const orgA = fonteCom(aberto);
    const orgB = fonteCom(fechado);

    expect((await comCacheDeAcessoAsIntegracoes("org-a", orgA.ler)).whatsapp.client_visible)
      .toBe(true);
    expect((await comCacheDeAcessoAsIntegracoes("org-a", orgA.ler)).whatsapp.client_visible)
      .toBe(true);
    expect((await comCacheDeAcessoAsIntegracoes("org-b", orgB.ler)).whatsapp.client_visible)
      .toBe(false);

    expect(orgA.ler).toHaveBeenCalledTimes(1);
    expect(orgB.ler).toHaveBeenCalledTimes(1);
    expect([...redisFake.store.keys()].sort()).toEqual([
      "crm:integration-access:v1:org-a",
      "crm:integration-access:v1:org-b",
    ]);
  });

  it("cai no banco quando o Redis não responde", async () => {
    redisFake.failGet = true;
    const fonte = fonteCom(fechado);

    const access = await comCacheDeAcessoAsIntegracoes("org-a", fonte.ler);

    expect(access.whatsapp.client_visible).toBe(false);
    expect(fonte.ler).toHaveBeenCalledTimes(1);
  });

  it("não grava o fallback quando a leitura do banco falha", async () => {
    const bancoFora = vi.fn(async () => null);
    expect((await comCacheDeAcessoAsIntegracoes("org-a", bancoFora)).whatsapp.client_visible)
      .toBe(true);

    const bancoVoltou = fonteCom(fechado);
    const access = await comCacheDeAcessoAsIntegracoes("org-a", bancoVoltou.ler);

    expect(access.whatsapp.client_visible).toBe(false);
    expect(bancoVoltou.ler).toHaveBeenCalledTimes(1);
  });

  it("invalida depois da escrita e não devolve a configuração antiga", async () => {
    const antes = fonteCom(aberto);
    await comCacheDeAcessoAsIntegracoes("org-a", antes.ler);

    await invalidarCacheDeAcessoAsIntegracoes("org-a");
    const depois = fonteCom(fechado);
    const access = await comCacheDeAcessoAsIntegracoes("org-a", depois.ler);

    expect(redisFake.del).toHaveBeenCalledWith("crm:integration-access:v1:org-a");
    expect(access.whatsapp.client_visible).toBe(false);
    expect(depois.ler).toHaveBeenCalledTimes(1);
  });

  it("ignora o cache se o Redis cair durante a invalidação", async () => {
    const antes = fonteCom(aberto);
    await comCacheDeAcessoAsIntegracoes("org-a", antes.ler);
    redisFake.failDel = true;

    await expect(invalidarCacheDeAcessoAsIntegracoes("org-a")).resolves.toBeUndefined();
    const depois = fonteCom(fechado);
    const access = await comCacheDeAcessoAsIntegracoes("org-a", depois.ler);

    expect(access.whatsapp.client_visible).toBe(false);
    expect(depois.ler).toHaveBeenCalledTimes(1);
  });

  it("uma leitura iniciada antes da invalidação não reinstala o valor velho", async () => {
    let resolverBanco!: (value: ReturnType<typeof integrationAccessFromRows>) => void;
    const consulta = new Promise<ReturnType<typeof integrationAccessFromRows>>((resolve) => {
      resolverBanco = resolve;
    });
    const ler = vi.fn(() => consulta);

    const leitura = comCacheDeAcessoAsIntegracoes("org-a", ler);
    await vi.waitFor(() => expect(ler).toHaveBeenCalledTimes(1));
    await invalidarCacheDeAcessoAsIntegracoes("org-a");
    resolverBanco(integrationAccessFromRows(aberto));
    await leitura;

    expect(redisFake.store.has("crm:integration-access:v1:org-a")).toBe(false);
  });
});
