import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { quickPhone } from "./quick-contact";
import { protectedCapturePhone } from "./capture-claim";
describe("entrada rápida e bloqueio por identidade do telefone", () => {
 it.each(["(41) 99979-9652", "+55 41 99979-9652", "554199799652"])("normaliza %s", (phone) => {
   expect(quickPhone(phone)).toBe("+5541999799652");
 });
 it.each(["99715-3441", "(41) 99715-3441", "+55 (41) 99715-3441", "554197153441"])("protege %s", (phone) => {
   expect(protectedCapturePhone(phone)).toBe(true);
 });
 it("rejeita número vazio e preserva o interno autorizado", () => {
   expect(() => quickPhone("abc")).toThrow();
   expect(protectedCapturePhone("5541999799652")).toBe(false);
 });
});
