import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { roleHasPermission, userHasPermission } from "@/lib/auth/permissions";

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("capacidades irreversíveis de organização", () => {
  for (const permission of ["organization.data.reset", "api.tokens.manage"] as const) {
    it(`${permission} libera admin e plataforma, mas recusa gerente`, () => {
      expect(roleHasPermission("manager", permission)).toBe(false);
      expect(roleHasPermission("admin", permission)).toBe(true);
      expect(
        userHasPermission(
          { is_platform_admin: true, support: null },
          { role: "viewer" },
          permission,
        ),
      ).toBe(true);
    });
  }

  it("protege a zona de perigo na tela e na Server Action", () => {
    const page = source("app/app/settings/tenant/page.tsx");
    const action = source("app/actions/settings/apagarDadosOperacionaisDaOrganizacao.ts");
    expect(page).toContain('userHasPermission(user, activeOrg, "organization.data.reset")');
    expect(page).toContain("row && podeZerarDados && <ZonaDePerigoDaOrganizacao");
    const gate = action.indexOf(
      'userHasPermission(authUser, activeOrg, "organization.data.reset")',
    );
    const effect = action.indexOf("apagarDadosOperacionaisDaOrg(");
    expect(gate).toBeGreaterThan(-1);
    expect(effect).toBeGreaterThan(gate);
  });

  it("protege criação e revogação de token antes do efeito", () => {
    const collection = source("app/api/v1/settings/api-tokens/route.ts");
    const revoke = source("app/api/v1/settings/api-tokens/[id]/revoke/route.ts");
    const createGate = collection.lastIndexOf('requirePermission("api.tokens.manage"');
    const createEffect = collection.indexOf('.from("api_tokens")\n    .insert(');
    const revokeGate = revoke.indexOf('requirePermission("api.tokens.manage"');
    const revokeEffect = revoke.indexOf('.from("api_tokens")\n    .update(');
    expect(createGate).toBeGreaterThan(-1);
    expect(createEffect).toBeGreaterThan(createGate);
    expect(revokeGate).toBeGreaterThan(-1);
    expect(revokeEffect).toBeGreaterThan(revokeGate);
  });

  it("mantém leitura para gerente, mas esconde os comandos na tela", () => {
    const route = source("app/api/v1/settings/api-tokens/route.ts");
    const page = source("app/app/settings/api-tokens/page.tsx");
    const client = source(
      "app/app/settings/api-tokens/_components/ApiTokensClient.tsx",
    );
    expect(route).toContain('requireRole("admin", { requestId, resource: "api_tokens" })');
    expect(page).toContain('userHasPermission(user, activeOrg, "api.tokens.manage")');
    expect(client).toContain("canManage && !tok.revoked_at");
    expect(client).toContain("open={canManage && createOpen}");
  });
});
