"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { CheckCircle, DownloadSimple, PuzzlePiece, Warning } from "@/lib/ui/icons";
import {
  BROWSER_EXTENSION_PAIRED_EVENT,
  BROWSER_EXTENSION_PAIRING_KEY,
} from "@/app/app/_components/BrowserExtensionHeartbeat";

type Estado = "preparando" | "nao_instalada" | "conectada" | "erro";

interface PairingPayload {
  pairing_code: string;
  extension_id: string;
  heartbeat_ms: number;
}

interface ExtensionResponse {
  ok: boolean;
  pairingId?: string;
  error?: string;
}

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: { message?: string };
        sendMessage(
          extensionId: string,
          message: { type: "pair"; code: string },
          callback: (response?: ExtensionResponse) => void,
        ): void;
      };
    };
  }
}

async function criarPareamento(): Promise<PairingPayload> {
  const response = await fetch("/api/v1/browser-extension/pairing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "Não foi possível preparar a extensão.");
  return payload.data;
}

function parearExtensao(payload: PairingPayload): Promise<string> {
  return new Promise((resolve, reject) => {
    const runtime = window.chrome?.runtime;
    if (!runtime) {
      reject(new Error("Extensão não instalada"));
      return;
    }
    runtime.sendMessage(
      payload.extension_id,
      { type: "pair", code: payload.pairing_code },
      (response) => {
        if (runtime.lastError || !response?.ok || !response.pairingId) {
          reject(
            new Error(response?.error ?? runtime.lastError?.message ?? "Extensão não instalada"),
          );
          return;
        }
        resolve(response.pairingId);
      },
    );
  });
}

export function BrowserExtensionSetup() {
  const t = useT();
  const [estado, setEstado] = useState<Estado>("preparando");
  const [mensagem, setMensagem] = useState(() => t("Procurando a extensão neste navegador..."));

  const conectar = useCallback(async () => {
    setEstado("preparando");
    setMensagem(t("Procurando a extensão neste navegador..."));
    try {
      const pairing = await criarPareamento();
      const pairingId = await parearExtensao(pairing);
      const heartbeat = async () => {
        const response = await fetch("/api/v1/browser-extension/pairing/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairing_id: pairingId }),
        });
        if (!response.ok) {
          setEstado("erro");
          setMensagem(t("Entre no CRM para usar."));
        }
      };
      await heartbeat();
      window.sessionStorage.setItem(BROWSER_EXTENSION_PAIRING_KEY, pairingId);
      window.dispatchEvent(
        new CustomEvent<string>(BROWSER_EXTENSION_PAIRED_EVENT, { detail: pairingId }),
      );
      setEstado("conectada");
      setMensagem(t("Extensão conectada à empresa ativa neste CRM."));
    } catch (error) {
      const textoOriginal =
        error instanceof Error ? error.message : "Não foi possível conectar a extensão.";
      const texto = t(textoOriginal);
      const naoInstalada =
        texto.toLowerCase().includes("extension") || texto.toLowerCase().includes("instalada");
      setEstado(naoInstalada ? "nao_instalada" : "erro");
      setMensagem(
        naoInstalada
          ? t("Instale a extensão, volte a esta tela e clique em Conectar agora.")
          : texto,
      );
    }
  }, [t]);

  useEffect(() => {
    const inicio = setTimeout(() => void conectar(), 0);
    return () => clearTimeout(inicio);
  }, [conectar]);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="max-w-2xl">
        <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-accent uppercase">
          WhatsApp Web
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Apoio ao atendimento")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Consulte o contato, use respostas rápidas, envie áudios e atualize o CRM sem sair da conversa.",
          )}
        </p>
      </header>

      <div className="grid max-w-4xl gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border bg-surface-elevated">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-accent-soft p-2 text-accent">
                <PuzzlePiece size={22} aria-hidden="true" />
              </div>
              <div>
                <CardTitle>{t("Instalar no Chrome")}</CardTitle>
                <CardDescription>
                  {t("O acesso é ligado automaticamente à sua sessão aberta.")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="font-semibold text-accent">1.</span>
                <span>{t("Baixe e extraia o pacote em uma pasta fixa.")}</span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-accent">2.</span>
                <span>
                  {t(
                    "Abra chrome://extensions, ative o modo do desenvolvedor e escolha Carregar sem compactação.",
                  )}
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-accent">3.</span>
                <span>
                  {t("Selecione a pasta extraída e volte a esta tela. Não há token para copiar.")}
                </span>
              </li>
            </ol>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href="/app/settings/browser-extension/download">
                  <DownloadSimple aria-hidden="true" /> {t("Baixar extensão")}
                </a>
              </Button>
              <Button
                variant="secondary"
                onClick={() => void conectar()}
                disabled={estado === "preparando"}
              >
                {t("Conectar agora")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Estado neste navegador")}</CardTitle>
            <CardDescription>
              {t("A empresa acompanha a organização ativa no CRM.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`flex gap-3 rounded-lg border p-4 ${
                estado === "conectada"
                  ? "border-success/30 bg-success/5 text-success"
                  : estado === "erro"
                    ? "border-error/30 bg-error/5 text-error"
                    : "border-border bg-surface-elevated text-text"
              }`}
              role="status"
            >
              {estado === "conectada" ? (
                <CheckCircle className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <Warning className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <div>
                <p className="text-sm font-semibold">
                  {estado === "conectada"
                    ? t("Conectada")
                    : estado === "preparando"
                      ? t("Verificando")
                      : t("Ação necessária")}
                </p>
                <p className="mt-1 text-sm text-current/80">{mensagem}</p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {t(
                "Fechar o CRM, sair da conta ou deixar a sessão expirar interrompe o acesso da extensão.",
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
