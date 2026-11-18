import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { homeDaInterface } from "@/lib/navigation/interface";
import { POUSO_PADRAO } from "@/lib/navigation/pouso";

describe("navegação do Inbox na fase 1B", () => {
  it("/app/inbox sem id renderiza a lista em vez de redirecionar", () => {
    const source = readFileSync(resolve(process.cwd(), "app/app/inbox/page.tsx"), "utf8");
    expect(source).toContain("<InboxLayout");
    expect(source).not.toContain('redirect("/app/kanban")');
  });

  it("os pousos continuam indo para Funis: nenhum deles aponta para /app/inbox", () => {
    // O Inbox deixou de redirecionar para o Kanban. Quem mandava para
    // /app/inbox contando com esse redirecionamento passaria a pousar na lista
    // de conversas, então cada pouso aponta para Funis direto.
    const pousos = [
      "app/actions/onboarding/finishOnboarding.ts",
      "app/get-started/page.tsx",
      "app/onboarding/layout.tsx",
      "app/onboarding/page.tsx",
      "app/onboarding/_components/OutrasOrganizacoes.tsx",
      "app/support-ended/page.tsx",
      "app/app/templates/page.tsx",
      "app/app/webhooks/page.tsx",
      "app/app/settings/browser-extension/page.tsx",
    ];
    for (const arquivo of pousos) {
      const source = readFileSync(resolve(process.cwd(), arquivo), "utf8");
      expect(source, arquivo).not.toMatch(/(redirect|assign)\("\/app\/inbox"\)/);
      expect(source, arquivo).toContain("POUSO_PADRAO");
    }
  });

  it("o pouso padrão é o mesmo destino de homeDaInterface", () => {
    expect(POUSO_PADRAO).toBe(homeDaInterface(null, false, "agent"));
  });

  it("mantém Funis como pouso do login", () => {
    expect(homeDaInterface(null, false, "agent")).toBe("/app/kanban");
  });

  it("restaura Inbox no menu com o nome e ícone anteriores", () => {
    expect(NAV_CATALOG.find((item) => item.href === "/app/inbox")).toMatchObject({
      label: "Inbox",
      icon: "Inbox",
      sidebar: true,
    });
  });
});
