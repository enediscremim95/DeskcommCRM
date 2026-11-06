export function crmPanelPreferenceKey(userId: string): string {
  return `inbox-crm-panel:${userId}`;
}

export function readCrmPanelCollapsed(storage: Pick<Storage, "getItem">, key: string): boolean {
  try {
    return storage.getItem(key) === "collapsed";
  } catch {
    return false;
  }
}

export function writeCrmPanelCollapsed(
  storage: Pick<Storage, "setItem" | "removeItem">,
  key: string,
  collapsed: boolean,
): void {
  try {
    if (collapsed) storage.setItem(key, "collapsed");
    else storage.removeItem(key);
  } catch {
    // Preferência visual não pode quebrar o Inbox.
  }
}

