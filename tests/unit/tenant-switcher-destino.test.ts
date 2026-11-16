import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/actions/shell/setActiveOrg", () => ({ setActiveOrg: vi.fn() }));
import { destinoAposTroca } from "@/components/shell/TenantSwitcher";

// Regressão: a troca ia a /app/kanban, que redireciona para o funil e repete o
// layout dinâmico inteiro (segundos). Com o id do funil, vai direto ao quadro.
describe("destino após trocar de organização", () => {
  it("vai direto ao quadro do funil padrão quando o servidor informou o id", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(destinoAposTroca(id)).toBe(`/app/pipelines/${id}`);
  });
  it("cai em /app/kanban sem id ou com id inválido", () => {
    expect(destinoAposTroca()).toBe("/app/kanban");
    expect(destinoAposTroca("../../x")).toBe("/app/kanban");
  });
});
