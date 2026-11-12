import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), setAll: undefined as undefined | ((cookies: { name: string; value: string; options: object }[]) => void),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: (_url: unknown, _key: unknown, options: { cookies: { setAll: typeof mocks.setAll } }) => {
  mocks.setAll = options.cookies.setAll;
  return { auth: { getUser: mocks.getUser } };
} }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://auth.example.com", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" } }));
vi.mock("@/lib/supabase/cookie-secure", () => ({ cookieSecure: () => false }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { proxy } from "@/proxy";
import { comAuthDisponivel } from "@/lib/auth/api-disponivel";
import { AuthTemporariamenteIndisponivel } from "@/lib/auth/get-user-com-backoff";

beforeEach(() => { vi.resetAllMocks(); });
describe("gates preservam sessão no timeout", () => {
  it.each(["/app/inbox", "/api/v1/conversations"]) ("proxy devolve 503 sem redirect nem cookies: %s", async (path) => {
    mocks.getUser.mockImplementation(async () => {
      mocks.setAll?.([{ name: "sb-deskcomm-auth", value: "", options: { maxAge: 0 } }]);
      return { data: { user: null }, error: { status: 504 } };
    });
    const request = new NextRequest(`https://example.com${path}`, { headers: { cookie: "sb-deskcomm-auth=sessao" } });
    const res = await proxy(request);
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(request.cookies.get("sb-deskcomm-auth")?.value).toBe("sessao");
    expect(mocks.getUser).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403])("recusa %s continua levando ao login", async (status) => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status } });
    expect((await proxy(new NextRequest("https://example.com/app/inbox"))).headers.get("location")).toContain("/login");
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });
  it("API converte indisponibilidade em 503 com retry", async () => {
    const handler = comAuthDisponivel(async () => { throw new AuthTemporariamenteIndisponivel(); });
    const res = await handler();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect((await res.json()).error.code).toBe("service_unavailable");
  });
});
