"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface Estado { enabled: boolean }

export function ChannelAutomaticAttendance({ channelId }: { channelId: string }) {
  const t = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const queryKey = ["channel-automatic-attendance", channelId];
  const query = useQuery({
    queryKey,
    queryFn: () => apiClient.get<{ data: Estado }>(
      `/api/v1/channel-sessions/${channelId}/automatic-attendance`,
    ),
  });
  const enabled = query.data?.data.enabled === true;

  async function change(next: boolean) {
    setSaving(true);
    try {
      const saved = await apiClient.patch<{ data: Estado }>(
        `/api/v1/channel-sessions/${channelId}/automatic-attendance`,
        { enabled: next },
      );
      queryClient.setQueryData(queryKey, saved);
      toast.success(t(next ? "Atendimento automático ligado." : "Atendimento automático desligado."));
    } catch {
      toast.error(t("Não foi possível alterar o atendimento automático. O estado anterior foi mantido."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-lg border p-3 ${enabled ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={id} className="font-semibold">{t("Atendimento automático")}</Label>
            {!query.isLoading && !query.isError && (
              <Badge variant={enabled ? "success" : "warning"}>
                {t(enabled ? "LIGADO" : "DESLIGADO")}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {query.isLoading
              ? t("Conferindo o estado atual…")
              : query.isError
                ? t("Não foi possível confirmar o estado. Por segurança, nenhuma alteração está disponível.")
                : enabled
                  ? t("A IA pode responder automaticamente as mensagens deste número.")
                  : t("As mensagens entram no CRM, com conversa, contato e lead, mas nenhuma resposta automática é enviada.")}
          </p>
        </div>
        <Switch
          id={id}
          checked={enabled}
          disabled={query.isLoading || query.isError || saving}
          onCheckedChange={(checked) => void change(checked)}
          aria-label={t("Atendimento automático deste número")}
        />
      </div>
    </div>
  );
}
