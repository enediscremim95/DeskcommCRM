"use client";

import { useT } from "@/hooks/i18n/useT";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useNotificationPermission } from "@/hooks/notifications/useNotificationPermission";
import {
  NOTIFY_UI_CATEGORIES,
  assinarPrefs,
  getPrefsSnapshot,
  getPrefsSnapshotDoServidor,
  gravarCanal,
  type NotifyCategory,
  type NotifyChannelPref,
} from "@/lib/notifications/prefs";
import type { EmailNotificationPreferences } from "@/lib/notifications/email-preferences";
import type { EmailNotificationPolicy } from "@/lib/notifications/email-policy";

const LABELS: Record<NotifyCategory, string> = {
  message: "Nova mensagem",
  lead_assigned: "Lead atribuído a você",
  lead_won: "Lead ganho",
  lead_lost: "Lead perdido",
  mention: "Você foi mencionado",
};

export function NotificationPrefsClient({
  initialEmailPrefs = { email_enabled: true, new_lead: true, urgent_lead: true },
  initialEmailPolicy = { urgent_batch_window_minutes: 60, urgent_daily_limit: 6 },
  canManageEmailPolicy = false,
  emailConfigured = false,
}: {
  initialEmailPrefs?: EmailNotificationPreferences;
  initialEmailPolicy?: EmailNotificationPolicy;
  canManageEmailPolicy?: boolean;
  emailConfigured?: boolean;
}) {
  const t = useT();
  const { permission, request } = useNotificationPermission();
  const prefs = useSyncExternalStore(assinarPrefs, getPrefsSnapshot, getPrefsSnapshotDoServidor);
  const denied = permission === "denied";
  const unsupported = permission === "unsupported";
  const [emailPrefs, setEmailPrefs] = useState(initialEmailPrefs);
  const [emailPolicy, setEmailPolicy] = useState(initialEmailPolicy);
  const [savingEmail, setSavingEmail] = useState<keyof EmailNotificationPreferences | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  async function onToggle(category: NotifyCategory, channel: NotifyChannelPref, on: boolean) {
    if (channel === "push" && on) {
      if (permission !== "granted") {
        const next = await request();
        if (next !== "granted") return;
      }
    }
    gravarCanal(category, channel, on);
  }

  async function saveEmailPolicy() {
    setSavingPolicy(true);
    try {
      const response = await fetch("/api/v1/notifications/email", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(emailPolicy),
      });
      if (!response.ok) throw new Error("save_failed");
      toast.success(t("Resumo de urgência atualizado."));
    } catch {
      toast.error(t("Não foi possível salvar o resumo de urgência."));
    } finally {
      setSavingPolicy(false);
    }
  }

  async function onEmailToggle(category: keyof EmailNotificationPreferences, on: boolean) {
    const previous = emailPrefs;
    setEmailPrefs({ ...emailPrefs, [category]: on });
    setSavingEmail(category);
    try {
      const response = await fetch("/api/v1/notifications/email", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [category]: on }),
      });
      if (!response.ok) throw new Error("save_failed");
    } catch {
      setEmailPrefs(previous);
      toast.error(t("Não foi possível salvar a preferência de e-mail."));
    } finally {
      setSavingEmail(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-4">
          <h2 className="font-medium">{t("Avisos importantes por e-mail")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Ligados por padrão para você não perder uma oportunidade. Cada pessoa controla os próprios avisos.",
            )}
          </p>
          {!emailConfigured ? (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              {t("O envio de e-mail ainda não foi configurado nesta instalação.")}
            </p>
          ) : null}
        </div>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4 pb-3">
            <span>
              <span className="block text-sm font-medium">
                {t("Receber avisos por e-mail")}
              </span>
              {!emailPrefs.email_enabled ? (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("Os avisos por e-mail estão desligados.")}
                </span>
              ) : null}
            </span>
            <Switch
              checked={emailPrefs.email_enabled}
              disabled={!emailConfigured || savingEmail !== null}
              onCheckedChange={(on) => void onEmailToggle("email_enabled", on)}
              aria-label={t("Receber avisos por e-mail")}
            />
          </label>
          <label className="flex items-center justify-between gap-4 border-t pt-3">
            <span>
              <span className="block text-sm font-medium">{t("Novo lead entrou")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("Formulário, WhatsApp, importação ou API.")}
              </span>
            </span>
            <Switch
              checked={emailPrefs.new_lead}
              disabled={
                !emailConfigured || !emailPrefs.email_enabled || savingEmail !== null
              }
              onCheckedChange={(on) => void onEmailToggle("new_lead", on)}
              aria-label={t("Novo lead via email")}
            />
          </label>
          <label className="flex items-center justify-between gap-4 border-t pt-3">
            <span>
              <span className="block text-sm font-medium">{t("Ação urgente no lead")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("Sinal do Radar de Risco ou tarefa vencida.")}
              </span>
            </span>
            <Switch
              checked={emailPrefs.urgent_lead}
              disabled={
                !emailConfigured || !emailPrefs.email_enabled || savingEmail !== null
              }
              onCheckedChange={(on) => void onEmailToggle("urgent_lead", on)}
              aria-label={t("Ação urgente via email")}
            />
          </label>
        </div>
      </Card>

      {canManageEmailPolicy ? (
        <Card className="p-4">
          <div>
            <h2 className="font-medium">{t("Resumo de urgência da organização")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Agrupa os leads que pedem ação e preserva a cota para convites e redefinições de senha.",
              )}
            </p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium">{t("Janela do resumo em minutos")}</span>
              <Input
                type="number"
                min={5}
                max={1440}
                value={emailPolicy.urgent_batch_window_minutes}
                onChange={(event) =>
                  setEmailPolicy((current) => ({
                    ...current,
                    urgent_batch_window_minutes: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">{t("Máximo de resumos por pessoa por dia")}</span>
              <Input
                type="number"
                min={1}
                max={24}
                value={emailPolicy.urgent_daily_limit}
                onChange={(event) =>
                  setEmailPolicy((current) => ({
                    ...current,
                    urgent_daily_limit: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
          <Button className="mt-4" disabled={savingPolicy} onClick={() => void saveEmailPolicy()}>
            {savingPolicy ? t("Salvando...") : t("Salvar resumo de urgência")}
          </Button>
        </Card>
      ) : null}

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium">{t("Categoria")}</th>
              <th className="px-4 py-3 text-center font-medium">Email</th>
              <th className="px-4 py-3 text-center font-medium">In-app</th>
              <th className="px-4 py-3 text-center font-medium">Push</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFY_UI_CATEGORIES.map((cat) => (
              <tr key={cat} className="border-b last:border-0">
                <td className="px-4 py-3">
                  {t(LABELS[cat])}
                  {cat === "message" && denied ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        "O navegador bloqueou as notificações. Libere-as nas configurações do site e recarregue.",
                      )}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-xs text-muted-foreground">{t("Não enviado")}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <Switch
                    checked={prefs[cat].in_app}
                    onCheckedChange={(on) => void onToggle(cat, "in_app", on)}
                    aria-label={`${t(LABELS[cat])} via in_app`}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <Switch
                    checked={prefs[cat].push}
                    disabled={denied || unsupported}
                    onCheckedChange={(on) => void onToggle(cat, "push", on)}
                    aria-label={`${t(LABELS[cat])} via push`}
                    data-testid={
                      cat === "message"
                        ? prefs.message.push
                          ? "alerts-toggle"
                          : "alerts-enable"
                        : undefined
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
