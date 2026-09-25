"use client";

import { useEffect } from "react";

import { EXTENSION_PRESENCE_MAX_AGE_MS } from "@/lib/browser-extension/constants";

export const BROWSER_EXTENSION_PAIRING_KEY = "browser_extension_pairing_id";
export const BROWSER_EXTENSION_PAIRED_EVENT = "browser-extension-paired";

const HEARTBEAT_ATTEMPTS_PER_WINDOW = 4;

// Com quatro tentativas por janela, duas podem falhar e ainda restam 7,5 s de folga.
export const BROWSER_EXTENSION_HEARTBEAT_INTERVAL_MS =
  EXTENSION_PRESENCE_MAX_AGE_MS / HEARTBEAT_ATTEMPTS_PER_WINDOW;

type ResultadoPulso = "ativo" | "sessao_invalida" | "falha_transitoria";

async function enviarPulso(pairingId: string): Promise<ResultadoPulso> {
  try {
    const response = await fetch("/api/v1/browser-extension/pairing/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairing_id: pairingId }),
    });

    if (response.status === 401 || response.status === 403) return "sessao_invalida";
    return response.ok ? "ativo" : "falha_transitoria";
  } catch {
    return "falha_transitoria";
  }
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
      if ((await enviarPulso(pairingId)) === "sessao_invalida") {
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
    const interval = window.setInterval(
      () => void heartbeat(),
      BROWSER_EXTENSION_HEARTBEAT_INTERVAL_MS,
    );
    return () => {
      window.removeEventListener(BROWSER_EXTENSION_PAIRED_EVENT, paired);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
