import { describe, expect, it } from "vitest";

import { assinaturaDosAcessosAsOrganizacoes } from "./assinatura-acessos-organizacoes";

describe("assinaturaDosAcessosAsOrganizacoes", () => {
  it("muda quando um acesso entra ou sai", () => {
    const uma = assinaturaDosAcessosAsOrganizacoes(["org-a"]);
    const duas = assinaturaDosAcessosAsOrganizacoes(["org-a", "org-b"]);

    expect(duas).not.toBe(uma);
    expect(duas).toMatch(/^2:[a-f0-9]{64}$/);
    expect(assinaturaDosAcessosAsOrganizacoes(["org-a"])).toBe(uma);
  });

  it("não muda só porque a consulta devolveu outra ordem", () => {
    expect(assinaturaDosAcessosAsOrganizacoes(["org-b", "org-a"])).toBe(
      assinaturaDosAcessosAsOrganizacoes(["org-a", "org-b"]),
    );
  });
});
