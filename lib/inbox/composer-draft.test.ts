import { beforeEach, describe, expect, it } from "vitest";

import { composerDraftKey, readComposerDraft, writeComposerDraft } from "./composer-draft";

describe("rascunho do composer por conversa", () => {
  beforeEach(() => localStorage.clear());

  it("isola organização, usuário e conversa na chave", () => {
    expect(composerDraftKey("org-a", "user-a", "conversation-a")).toBe(
      "inbox-composer-draft:org-a:user-a:conversation-a",
    );
  });

  it("A escreve, troca para B e volta para A sem o texto de B vazar", () => {
    const a = composerDraftKey("org", "user", "a");
    const b = composerDraftKey("org", "user", "b");
    writeComposerDraft(localStorage, a, "texto de A");
    expect(readComposerDraft(localStorage, b)).toBe("");
    writeComposerDraft(localStorage, b, "texto de B");
    expect(readComposerDraft(localStorage, a)).toBe("texto de A");
    expect(readComposerDraft(localStorage, b)).toBe("texto de B");
  });

  it("enviar limpa a chave e a API só aceita texto, nunca arquivo", () => {
    const key = composerDraftKey("org", "user", "a");
    writeComposerDraft(localStorage, key, "mensagem pronta");
    writeComposerDraft(localStorage, key, "");
    expect(localStorage.getItem(key)).toBeNull();
    expect(String(writeComposerDraft)).not.toContain("File");
    expect(String(writeComposerDraft)).not.toContain("Blob");
  });
});
