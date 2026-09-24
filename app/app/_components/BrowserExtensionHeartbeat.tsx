"use client";

import { useEffect } from "react";

export const BROWSER_EXTENSION_PAIRING_KEY = "browser_extension_pairing_id";
export const BROWSER_EXTENSION_PAIRED_EVENT = "browser-extension-paired";

async function enviarPulso(pairingId: string): Promise<boolean> {
  const response = await fetch("/api/v1/browser-extension/pairing/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairing_id: pairingId }),
  });
  return response.ok;
}

/**
 * Mantém a extensão vinculada somente enquanto existe uma tela autenticada do
 * CRM aberta. O identificador não é credencial; o token continua isolado no
 * `chrome.storage.session` da extensão.
 */
export function BrowserExtensionHeartbeat() {
  useEffect(() => {
    let pairingId = window.sessionStorage.getItem(BROWSER_EXTENSION_PAIRING_KEY);

    const heartbeat = async () => {
      if (!pairingId) return;
      if (!(await enviarPulso(pairingId))) {
        window.sessionStorage.removeItem(BROWSER_EXTENSION_PAIRING_KEY);
        pairingId = null;
      }
    };
    const paired = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id) return;
      pairingId = id;
      window.sessionStorage.setItem(BROWSER_EXTENSION_PAIRING_KEY, id);
      void heartbeat();
    };

    window.addEventListener(BROWSER_EXTENSION_PAIRED_EVENT, paired);
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 5_000);
    return () => {
      window.removeEventListener(BROWSER_EXTENSION_PAIRED_EVENT, paired);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
