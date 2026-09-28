"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";

interface Connector {
  client_can_reconnect?: boolean;
  id: string;
  provider_label: string;
  instance_name: string;
  phone_number: string;
  display_name: string | null;
  remote_state: "open" | "close" | "connecting" | null;
  qr_attempts: number;
  hook_last_status: string | null;
  hook_last_error: string | null;
}

interface ApiResult<T> { data?: T; error?: { code?: string; message?: string } }

export function ManagedQrConnector({ fallback }: { fallback: ReactNode }) {
  const t = useT();
  const [connector, setConnector] = useState<Connector | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [requestingQr, setRequestingQr] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(0);
  const [retryIn, setRetryIn] = useState(0);
  const [canReconnect, setCanReconnect] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/channel-sessions/managed", { cache: "no-store" })
      .then(async (res) => ({ res, body: await res.json() as ApiResult<Connector | null> }))
      .then(({ res, body }) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error?.message ?? t("Falha ao carregar o conector."));
        setConnector(body.data ?? null);
        setCanReconnect(body.data?.client_can_reconnect === true);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t("Falha ao carregar o conector."));
      });
    return () => { cancelled = true; };
  }, [t]);

  const checkState = useCallback(async () => {
    if (!connector) return;
    setChecking(true);
    try {
      const res = await fetch("/api/v1/channel-sessions/managed/state", { method: "POST" });
      const body = await res.json() as ApiResult<Connector>;
      if (!res.ok || !body.data) throw new Error(body.error?.message ?? t("Falha ao conferir o estado."));
      setConnector(body.data);
      setError(null);
      if (body.data.remote_state === "open") {
        setQrBase64(null);
        setPairingCode(null);
        setExpiresIn(0);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Falha ao conferir o estado."));
    } finally {
      setChecking(false);
    }
  }, [connector?.id, t]);

  useEffect(() => {
    if (!connector) return;
    void checkState();
    const timer = window.setInterval(() => void checkState(), 60_000);
    return () => window.clearInterval(timer);
  }, [connector?.id, checkState]);

  useEffect(() => {
    if (expiresIn <= 0) return;
    const timer = window.setInterval(() => setExpiresIn((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [expiresIn > 0]);

  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setInterval(() => setRetryIn((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [retryIn > 0]);

  useEffect(() => {
    if (!connector || expiresIn <= 0 || connector.remote_state === "open") return;
    const timer = window.setInterval(() => void checkState(), 5_000);
    return () => window.clearInterval(timer);
  }, [connector?.id, connector?.remote_state, expiresIn, checkState]);

  async function requestQr() {
    setRequestingQr(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/channel-sessions/managed/qr", { method: "POST" });
      const body = await res.json() as ApiResult<{
        qr_base64: string | null;
        pairing_code: string | null;
        expires_in: number;
        attempts: number;
      }>;
      if (!res.ok || !body.data) {
        const wait = Number(res.headers.get("Retry-After") ?? 0);
        if (wait > 0) setRetryIn(wait);
        if (body.error?.code === "managed_connector_qr_attempts_exhausted") {
          setConnector((current) => current ? { ...current, qr_attempts: 3 } : current);
        }
        throw new Error(body.error?.message ?? t("Não foi possível gerar o QR."));
      }
      setQrBase64(body.data.qr_base64);
      setPairingCode(body.data.pairing_code);
      setExpiresIn(body.data.expires_in);
      setConnector((current) => current ? { ...current, qr_attempts: body.data!.attempts } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Não foi possível gerar o QR."));
    } finally {
      setRequestingQr(false);
    }
  }

  if (connector === undefined && !error) {
    return <div className="h-40 animate-pulse rounded-xl border bg-muted/30" aria-label={t("Carregando conexão")} />;
  }
  if (connector === null) return <>{fallback}</>;
  if (!connector) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>;
  }

  const connected = connector.remote_state === "open";
  const qrSrc = qrBase64 ? (qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`) : null;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>
            {connector.display_name?.trim() ? connector.display_name.trim() : connector.provider_label}
          </CardTitle>
          <CardDescription>
            {t("Número")} {connector.phone_number}. {t("A instância existente é preservada, o CRM apenas confere e reconecta.")}
          </CardDescription>
        </div>
        <Badge variant={connected ? "success" : connector.remote_state === "connecting" ? "warning" : "error"}>
          {connected ? t("Conectado") : connector.remote_state === "connecting" ? t("Conectando") : t("Desconectado")}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {!connected && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="font-medium text-destructive">{t("WhatsApp desconectado")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canReconnect
                ? t("Gere um QR somente quando estiver com o celular em mãos. Cada tentativa conta para o limite de segurança.")
                : t("A reconexão é feita pelo administrador da instalação.")}
            </p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {connector.hook_last_status === "failed" && connector.hook_last_error && (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {t("O número reconectou, mas a automação pós-reconexão falhou:")} {connector.hook_last_error}
          </p>
        )}

        {qrSrc && expiresIn > 0 && (
          <div className="grid gap-5 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[220px_1fr] sm:items-center">
            {/* A imagem vem do backend e contém somente o QR temporário; nenhuma credencial atravessa. */}
            <img src={qrSrc} alt={t("QR temporário para reconectar o WhatsApp")} className="aspect-square w-full max-w-[220px] rounded-lg bg-white p-2" />
            <div className="space-y-2 text-sm">
              <p className="font-medium">{t("Expira em")} {expiresIn}s</p>
              <p className="text-muted-foreground">{t("No celular, abra Aparelhos conectados e escaneie este código.")}</p>
              {pairingCode && (
                <div className="rounded-md border bg-background p-3">
                  <p className="text-xs text-muted-foreground">{t("Conectar pelo número")}</p>
                  <code className="mt-1 block text-lg font-semibold tracking-widest">{pairingCode}</code>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button hidden={!canReconnect} onClick={() => void requestQr()} disabled={connected || requestingQr || retryIn > 0 || connector.qr_attempts >= 3}>
            {requestingQr ? t("Gerando…") : retryIn > 0 ? `${t("Aguarde")} ${retryIn}s` : t("Gerar QR para reconectar")}
          </Button>
          <Button variant="outline" onClick={() => void checkState()} disabled={checking}>
            {checking ? t("Conferindo…") : t("Conferir estado")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {canReconnect
            ? t("Limite: uma geração por minuto e três tentativas até a reconexão ser confirmada. A instância e o webhook atual não são alterados.")
            : t("Solicite a reconexão ao administrador da instalação.")}
        </p>
      </CardContent>
    </Card>
  );
}
