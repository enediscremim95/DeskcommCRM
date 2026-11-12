import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { requirePlatformAdmin } from "./requirePlatformAdmin";
it("504 não redireciona admin para login", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 504 } });
  await expect(requirePlatformAdmin()).rejects.toMatchObject({ name: "AuthTemporariamenteIndisponivel" });
  expect(mocks.getUser).toHaveBeenCalledTimes(3);
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it.each([401, 403])("%s continua recusando admin", async (status) => {
  mocks.redirect.mockClear();
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status } });
  await expect(requirePlatformAdmin()).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/admin");
});
