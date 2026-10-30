"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";

interface EstadoDoAssistente {
  enabled: boolean;
  state: "off" | "ready" | "credential_error" | "setup_error";
  provider: "anthropic" | "openai";
  credential_id: string | null;
  credential_last4: string | null;
  validation_error: string | null;
  team_style: string;
  history_message_window: number;
  history_token_window: number;
  hourly_limit: number;
  daily_limit: number;
  auto_suggest: boolean;
}

const STATUS: Record<EstadoDoAssistente["state"], string> = {
  off: "Desligado",
  ready: "Ligado e pronto",
  credential_error: "Chave inválida ou indisponível",
  setup_error: "Configuração incompleta",
};

export function ReplyAssistantSettings({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const [state, setState] = useState<EstadoDoAssistente | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [teamStyle, setTeamStyle] = useState("");
  const [historyMessages, setHistoryMessages] = useState(20);
  const [historyTokens, setHistoryTokens] = useState(4_000);
  const [hourlyLimit, setHourlyLimit] = useState(20);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [autoSuggest, setAutoSuggest] = useState(true);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: EstadoDoAssistente) => {
    setState(next);
    setProvider(next.provider);
    setTeamStyle(next.team_style);
    setHistoryMessages(next.history_message_window);
    setHistoryTokens(next.history_token_window);
    setHourlyLimit(next.hourly_limit);
    setDailyLimit(next.daily_limit);
    setAutoSuggest(next.auto_suggest);
  }, []);

  useEffect(() => {
    let alive = true;
    void apiClient
      .get<{ data: EstadoDoAssistente }>("/api/v1/ai/reply-assistant")
      .then((response) => alive && apply(response.data))
      .catch(showApiError);
    return () => {
      alive = false;
    };
  }, [apply]);

  async function credentialIdForSave(): Promise<string> {
    if (!apiKey.trim()) {
      if (state?.credential_id && state.provider === provider) return state.credential_id;
      throw new Error(t("Cole uma chave para ligar o assistente."));
    }
    const created = await apiClient.post<{ data: { id: string } }>("/api/v1/ai/credentials", {
      provider,
      label: `Assistente de resposta ${new Date().toISOString()}`,
      api_key: apiKey.trim(),
    });
    const validated = await apiClient.post<{
      data: { id: string; validated_at: string | null; validation_error: string | null };
    }>(`/api/v1/ai/credentials/${created.data.id}/revalidate`, {});
    if (!validated.data.validated_at) {
      throw new Error(
        validated.data.validation_error === "provider_status_429"
          ? t("A conta da IA atingiu o limite ou está sem saldo.")
          : t("A chave foi recusada pelo provedor."),
      );
    }
    return created.data.id;
  }

  async function save() {
    setBusy(true);
    try {
      const credentialId = await credentialIdForSave();
      const response = await apiClient.put<{ data: EstadoDoAssistente }>(
        "/api/v1/ai/reply-assistant",
        {
          enabled: true,
          provider,
          credential_id: credentialId,
          team_style: teamStyle,
          history_message_window: historyMessages,
          history_token_window: historyTokens,
          hourly_limit: hourlyLimit,
          daily_limit: dailyLimit,
          auto_suggest: autoSuggest,
        },
      );
      setApiKey("");
      apply(response.data);
      toast.success(t("Assistente ligado e pronto para sugerir respostas."));
    } catch (error) {
      if (error instanceof Error && !Reflect.has(error, "status")) toast.error(error.message);
      else showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const response = await apiClient.put<{ data: EstadoDoAssistente }>(
        "/api/v1/ai/reply-assistant",
        { enabled: false },
      );
      apply(response.data);
      toast.success(t("Assistente desligado."));
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="max-w-3xl space-y-5 rounded-xl border bg-card p-5"
      aria-label={t("Assistente de resposta")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("Assistente de resposta")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Lê o histórico e prepara um rascunho. Uma pessoa sempre revisa antes de enviar.")}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            state?.state === "ready"
              ? "bg-success-bg text-success-fg"
              : state?.state === "credential_error" || state?.state === "setup_error"
                ? "bg-error-bg text-error-fg"
                : "bg-muted text-muted-foreground"
          }`}
          role="status"
        >
          {t(state ? STATUS[state.state] : "Carregando...")}
        </span>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        {t(
          "A chave e o custo são desta organização. A chave é cifrada, nunca aparece novamente e não é registrada nos logs.",
        )}
        {state?.credential_last4
          ? ` ${t("Chave atual termina em")} ${state.credential_last4}.`
          : ""}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="reply-assistant-provider">{t("Provedor")}</Label>
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value as "anthropic" | "openai")}
            disabled={!canWrite || busy}
          >
            <SelectTrigger id="reply-assistant-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Claude</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reply-assistant-key">
            {t(state?.credential_id ? "Nova chave, somente para trocar" : "Chave da API")}
          </Label>
          <Input
            id="reply-assistant-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              provider === "anthropic"
                ? t("Cole a chave da Anthropic")
                : t("Cole a chave da OpenAI")
            }
            disabled={!canWrite || busy}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reply-assistant-style">{t("Como a equipe fala")}</Label>
        <Textarea
          id="reply-assistant-style"
          rows={4}
          value={teamStyle}
          onChange={(event) => setTeamStyle(event.target.value)}
          disabled={!canWrite || busy}
          maxLength={4_000}
        />
        <p className="text-xs text-muted-foreground">
          {t(
            "A sugestão será curta e não poderá inventar preço, prazo, frete, estoque ou condição comercial.",
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          label="Mensagens do histórico"
          value={historyMessages}
          min={5}
          max={80}
          setValue={setHistoryMessages}
          disabled={!canWrite || busy}
        />
        <NumberField
          label="Limite de texto analisado"
          value={historyTokens}
          min={1_000}
          max={16_000}
          step={500}
          setValue={setHistoryTokens}
          disabled={!canWrite || busy}
        />
        <NumberField
          label="Sugestões por hora"
          value={hourlyLimit}
          min={1}
          max={200}
          setValue={setHourlyLimit}
          disabled={!canWrite || busy}
        />
        <NumberField
          label="Sugestões por dia"
          value={dailyLimit}
          min={1}
          max={2_000}
          setValue={setDailyLimit}
          disabled={!canWrite || busy}
        />
      </div>

      <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
        <Switch
          id="reply-assistant-auto-suggest"
          checked={autoSuggest}
          onCheckedChange={(checked) => setAutoSuggest(checked === true)}
          disabled={!canWrite || busy}
        />
        <div className="space-y-1">
          <Label htmlFor="reply-assistant-auto-suggest">
            {t("Sugerir sozinho ao chegar mensagem")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("Prepara o texto na conversa aberta. Nada é enviado sem a ação de uma pessoa.")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!canWrite || busy || teamStyle.trim().length < 10}
        >
          {busy ? t("Salvando...") : t(state?.enabled ? "Salvar configuração" : "Ligar assistente")}
        </Button>
        {state?.enabled && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void disable()}
            disabled={!canWrite || busy}
          >
            {t("Desligar")}
          </Button>
        )}
      </div>
      {!canWrite && (
        <p className="text-xs text-muted-foreground">
          {t("Somente uma pessoa administradora pode alterar esta configuração.")}
        </p>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  setValue,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  setValue: (value: number) => void;
  disabled: boolean;
}) {
  const t = useT();
  const id = `reply-assistant-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t(label)}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        disabled={disabled}
      />
    </div>
  );
}
