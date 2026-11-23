import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * O proxy renova a sessão — e o render PRECISA enxergar o cookie renovado.
 * Antes, a resposta era criada uma vez e `request.cookies.set` não chegava ao
 * layout: ele refazia o refresh com o refresh token já consumido.
 */
const estado: { getUser: () => Promise<unknown> } = { getUser: async () => ({ data: { user: null }, error: null }) };
let setAllDoClient: ((c: { name: string; value: string; options: object }[]) => void) | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: typeof setAllDoClient } }) => {
    setAllDoClient = opts.cookies.setAll;
    return { auth: { getUser: () => estado.getUser() }, rpc: async () => ({ data: true, error: null }) };
  },
}));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "http://x", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k", NEXT_PUBLIC_APP_URL: "http://localhost", IMPERSONATE_COOKIE_SECRET: "s" },
}));

const { proxy } = await import("@/proxy");
const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { cookie: "sb-deskcomm-auth=velho" } });

beforeEach(() => { setAllDoClient = null; });

describe("proxy.ts", () => {
  it("cookie renovado chega ao render (x-middleware-request-cookie) e ao navegador", async () => {
    estado.getUser = async () => {
      setAllDoClient?.([{ name: "sb-deskcomm-auth", value: "novo", options: { path: "/" } }]);
      return { data: { user: { id: "u" } }, error: null };
    };
    const res = await proxy(req("/app/relatorio"));
    expect(res.headers.get("x-middleware-request-cookie")).toContain("sb-deskcomm-auth=novo");
    expect(res.headers.get("x-middleware-request-cookie")).not.toContain("velho");
    expect(res.headers.get("set-cookie")).toContain("sb-deskcomm-auth=novo");
    expect(res.headers.get("x-pathname")).toBe("/app/relatorio");
  });

  it("GoTrue fora do ar NÃO expulsa para o login: responde com indisponibilidade nas páginas", async () => {
    estado.getUser = async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 503, message: "x" } });
    const res = await proxy(req("/app/kanban"));
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
  });

  it("e responde 503 (não 401) nas rotas /api, para o cliente repetir", async () => {
    estado.getUser = async () => ({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "x" } });
    const res = await proxy(req("/api/v1/auth/interface"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("service_unavailable");
  });

  it("sessão realmente ausente continua indo ao login", async () => {
    estado.getUser = async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError", status: 400, message: "x" } });
    const res = await proxy(req("/app/kanban"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
