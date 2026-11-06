/** Rascunho local do composer. Somente texto pode entrar nesta chave. */
export function composerDraftKey(orgId: string, userId: string, conversationId: string): string {
  return `inbox-composer-draft:${orgId}:${userId}:${conversationId}`;
}

export function readComposerDraft(storage: Pick<Storage, "getItem">, key: string): string {
  try {
    return storage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeComposerDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  key: string,
  text: string,
): void {
  try {
    if (text.length > 0) storage.setItem(key, text);
    else storage.removeItem(key);
  } catch {
    // Navegador sem storage disponível não pode impedir o atendimento.
  }
}
