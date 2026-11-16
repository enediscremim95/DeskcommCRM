import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CRM_SHEET_BAR_CLASS, inboxGridColumns } from "./InboxLayout";

describe("layout do Inbox na fase 1A", () => {
  it("mantém a porta da ficha visível no tablet e esconde somente a partir do desktop", () => {
    expect(CRM_SHEET_BAR_CLASS).toContain("xl:hidden");
    expect(CRM_SHEET_BAR_CLASS).not.toContain("md:hidden");
  });

  it("recolhe a terceira coluna no desktop sem alterar lista e conversa", () => {
    expect(inboxGridColumns(false)).toContain("296px");
    expect(inboxGridColumns(true)).toBe(
      "xl:grid-cols-[272px_1fr] 2xl:grid-cols-[300px_1fr]",
    );
  });

  it("liga o drop somente à coluna central da conversa", () => {
    const source = readFileSync(resolve(process.cwd(), "components/inbox/InboxLayout.tsx"), "utf8");
    expect(source.match(/onDrop=\{handleDrop\}/g)).toHaveLength(1);
    expect(source).toMatch(
      /data-testid="conversation-column"[\s\S]{0,300}onDrop=\{handleDrop\}/,
    );
  });
});
