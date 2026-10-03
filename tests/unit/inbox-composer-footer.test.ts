import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rodapé do compositor", () => {
  it("limita o conjunto de avisos e compositor sem deixar o chat encolher sem teto", () => {
    const fonte = readFileSync("components/inbox/InboxLayout.tsx", "utf8");

    expect(fonte).toMatch(
      /data-testid="conversation-footer"[\s\S]{0,300}max-h-\[min\(52%,28rem\)\][\s\S]{0,120}shrink-0/,
    );
    expect(fonte).toMatch(
      /data-testid="conversation-footer-notices"[\s\S]{0,220}max-h-28[\s\S]{0,120}overflow-y-auto/,
    );
  });
});
