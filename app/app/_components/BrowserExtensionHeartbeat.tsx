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
    let pairingId: string | null = null;
    let interval: number | null = null;

    try {
      pairingId = window.sessionStorage.getItem(BROWSER_EXTENSION_PAIRING_KEY);
    } catch {
      pairingId = null;
    }

    const stopHeartbeat = () => {
      if (interval === null) return;
      window.clearInterval(interval);
      interval = null;
    };

    const heartbeat = async () => {
      const currentPairingId = pairingId;
      if (!currentPairingId) return;
      if (
        (await enviarPulso(currentPairingId)) === "sessao_invalida" &&
        pairingId === currentPairingId
      ) {
        pairingId = null;
        stopHeartbeat();
        try {
          window.sessionStorage.removeItem(BROWSER_EXTENSION_PAIRING_KEY);
        } catch {
          // O pareamento desta aba já foi encerrado; storage bloqueado não derruba o shell.
        }
      }
    };

    const startHeartbeat = () => {
      if (!pairingId) return;
      if (interval === null) {
        interval = window.setInterval(
          () => void heartbeat(),
          BROWSER_EXTENSION_HEARTBEAT_INTERVAL_MS,
        );
      }
      void heartbeat();
    };

    const paired = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id) return;
      pairingId = id;
      try {
        window.sessionStorage.setItem(BROWSER_EXTENSION_PAIRING_KEY, id);
      } catch {
        // O pulso segue nesta aba mesmo quando o navegador bloqueia o storage.
      }
      startHeartbeat();
    };

    window.addEventListener(BROWSER_EXTENSION_PAIRED_EVENT, paired);
    startHeartbeat();
    return () => {
      window.removeEventListener(BROWSER_EXTENSION_PAIRED_EVENT, paired);
      stopHeartbeat();
    };
  }, []);

  return null;
}
