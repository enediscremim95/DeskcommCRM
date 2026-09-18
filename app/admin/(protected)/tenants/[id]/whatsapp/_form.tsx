"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

interface SafeConnector {
  provider_label: string;
  base_url: string;
  instance_name: string;
  phone_number: string;
  display_name: string | null;
  has_api_key: boolean;
  reconnect_hook_url: string | null;
}

export function ManagedConnectorAdminForm({ organizationId }: { organizationId: string }) {
  const t = useT();
  const [existing, setExisting] = useState<SafeConnector | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/v1/admin/tenants/${organizationId}/managed-channel`, { cache: "no-store" })
      .then(async (res) => ({ res, body: await res.json() as { data?: SafeConnector | null; error?: { message?: string } } }))
      .then(({ res, body }) => {
        if (!res.ok) throw new Error(body.error?.message ?? t("Falha ao carregar."));
        setExisting(body.data ?? null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("Falha ao carregar.")))
      .finally(() => setLoading(false));
  }, [organizationId, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(null); setMessage(null);
    const data = new FormData(event.currentTarget);
    const key = String(data.get("api_key") ?? "").trim();
    const hook = String(data.get("reconnect_hook_url") ?? "").trim();
    const payload = {
      base_url: String(data.get("base_url") ?? ""),
      instance_name: String(data.get("instance_name") ?? ""),
      phone_number: String(data.get("phone_number") ?? ""),
      display_name: String(data.get("display_name") ?? "") || null,
      api_key: key || null,
      reconnect_hook_url: hook || null,
    };
    try {
      const res = await fetch(`/api/v1/admin/tenants/${organizationId}/managed-channel`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await res.json() as { data?: SafeConnector; error?: { message?: string } };
      if (!res.ok || !body.data) throw new Error(body.error?.message ?? t("Não foi possível salvar."));
      setExisting(body.data);
      setMessage(t("Conector salvo. A chave ficou cifrada e não pode ser lida de volta."));
      const keyField = event.currentTarget.elements.namedItem("api_key") as HTMLInputElement | null;
      if (keyField) keyField.value = "";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Não foi possível salvar."));
    } finally { setSaving(false); }
  }

  if (loading) return <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />;
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t("Conector de WhatsApp da organização")}</CardTitle>
        <CardDescription>
          {t("Cadastre uma instância já existente. Salvar não cria, apaga, pareia nem altera webhook no serviço externo.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="base_url">{t("URL base")}</Label><Input id="base_url" name="base_url" type="url" required defaultValue={existing?.base_url ?? ""} placeholder="https://whatsapp.exemplo.com.br" /></div>
          <div className="space-y-2"><Label htmlFor="instance_name">{t("Nome da instância")}</Label><Input id="instance_name" name="instance_name" required defaultValue={existing?.instance_name ?? ""} /></div>
          <div className="space-y-2"><Label htmlFor="phone_number">{t("Número com DDI")}</Label><Input id="phone_number" name="phone_number" inputMode="tel" required defaultValue={existing?.phone_number ?? ""} placeholder="5541999999999" /></div>
          <div className="space-y-2"><Label htmlFor="display_name">{t("Nome exibido")}</Label><Input id="display_name" name="display_name" defaultValue={existing?.display_name ?? ""} placeholder={existing?.provider_label ?? t("WhatsApp do agente")} /></div>
          <div className="space-y-2"><Label htmlFor="api_key">{t("Chave da instância")}</Label><Input id="api_key" name="api_key" type="password" autoComplete="new-password" required={!existing?.has_api_key} placeholder={existing?.has_api_key ? t("Deixe vazio para manter a atual") : t("Cole a chave")} /><p className="text-xs text-muted-foreground">{t("Write-only: depois de salvar, nem o navegador nem a API conseguem lê-la de volta.")}</p></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="reconnect_hook_url">{t("URL chamada após reconectar (opcional)")}</Label><Input id="reconnect_hook_url" name="reconnect_hook_url" type="url" defaultValue={existing?.reconnect_hook_url ?? ""} placeholder="https://automacao.exemplo.com/webhook/whatsapp-reconectado" /></div>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          {message && <p role="status" className="text-sm text-emerald-700 sm:col-span-2">{message}</p>}
          <div className="sm:col-span-2"><Button type="submit" disabled={saving}>{saving ? t("Salvando…") : t("Salvar conector")}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}
