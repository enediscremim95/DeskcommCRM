import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { homeDaInterface } from "@/lib/navigation/interface";

describe("navegação do Inbox na fase 1B", () => {
  it("/app/inbox sem id renderiza a lista em vez de redirecionar", () => {
    const source = readFileSync(resolve(process.cwd(), "app/app/inbox/page.tsx"), "utf8");
    expect(source).toContain("<InboxLayout");
    expect(source).not.toContain('redirect("/app/kanban")');
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
