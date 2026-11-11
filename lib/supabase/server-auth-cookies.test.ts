import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn(), getUser: vi.fn(), setAll: undefined as undefined | ((cookies: { name: string; value: string; options: object }[]) => void) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: mocks.set }) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://auth.example.com", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: (_url: unknown, _key: unknown, options: { cookies: { setAll: typeof mocks.setAll } }) => {
  mocks.setAll = options.cookies.setAll;
  return { auth: { getUser: mocks.getUser } };
} }));
import { createClient } from "./server";
it.each([504, 503])("não grava exclusão de cookie em falha %s", async (status) => {
  mocks.set.mockClear();
  mocks.getUser.mockImplementation(async () => {
    mocks.setAll?.([{ name: "sessao", value: "", options: { maxAge: 0 } }]);
    return { data: { user: null }, error: { status } };
  });
  const db = await createClient();
  await db.auth.getUser();
  expect(mocks.set).not.toHaveBeenCalled();
});
describe("cookie validado", () => {
  it("grava refresh confirmado", async () => {
    mocks.set.mockClear();
    mocks.getUser.mockImplementation(async () => {
      mocks.setAll?.([{ name: "sessao", value: "renovada", options: {} }]);
      return { data: { user: { id: "u1" } }, error: null };
    });
    await (await createClient()).auth.getUser();
    expect(mocks.set).toHaveBeenCalledWith("sessao", "renovada", {});
  });
});
