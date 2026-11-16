import { describe, expect, it, vi } from "vitest";
import { formularioAbertoDoContato } from "./formulario-existente";
vi.mock("@/lib/channels/contato-por-telefone", () => ({ idsDoContatoEGemeos: async () => ["contact", "old-phone"] }));
function db(rows: unknown[], error: unknown = null) {
 const calls: unknown[][] = [];
 const chain: Record<string, unknown> = new Proxy({}, { get: (_, key) => key === "then" ? (resolve: (value: unknown) => unknown) => resolve({ data: rows, error }) : (...args: unknown[]) => { calls.push([key, ...args]); return chain; } });
 return { client: { from: () => chain } as never, calls };
}
describe("formulário reencontrado pela conversa", () => {
 it("preserva card antigo de campanha, sem mover etapa nem limitar por idade", async () => {
  const { client, calls } = db([{ id: "form-lead" }]);
  await expect(formularioAbertoDoContato(client, "org", "contact")).resolves.toBe("form-lead");
  expect(calls).toContainEqual(["eq", "organization_id", "org"]);
  expect(calls).toContainEqual(["in", "contact_id", ["contact", "old-phone"]]);
  expect(calls).toContainEqual(["eq", "source", "webhook"]);
  expect(calls).toContainEqual(["eq", "status", "open"]);
  expect(calls.some(([key]) => ["insert", "update", "gte"].includes(String(key)))).toBe(false);
 });
 it("não escolhe arbitrariamente entre duas demandas", async () => {
  await expect(formularioAbertoDoContato(db([{ id: "a" }, { id: "b" }]).client, "org", "contact")).rejects.toThrow("ambiguous_form_leads");
 });
 it("não cria card quando a consulta falha", async () => {
  await expect(formularioAbertoDoContato(db([], { message: "offline" }).client, "org", "contact")).rejects.toThrow("form_lead_lookup_failed");
 });
 it("deixa uma nova demanda nascer quando não há captação aberta", async () => {
  await expect(formularioAbertoDoContato(db([]).client, "org", "contact")).resolves.toBeNull();
 });
});
