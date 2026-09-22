import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lead sem conversa: a busca da conversa fica DESLIGADA (`enabled: false`), e no
 * TanStack Query v5 uma busca desligada fica `isPending` para sempre. A ficha usava
 * `isPending` para mostrar "Carregando conversa…" e nunca chegava aos avisos
 * "WhatsApp não conectado" / "Este lead ainda não tem conversa" (print do dono, 22/09/2026).
 */
describe("ficha do lead sem conversa", () => {
  it("só mostra 'Carregando conversa…' enquanto busca de verdade", () => {
    const ficha = readFileSync("components/leads/LeadPageClient.tsx", "utf8");
    expect(ficha).toContain("{conversation.isLoading ? (");
    expect(ficha).not.toContain("{conversation.isPending ? (");
  });
});
