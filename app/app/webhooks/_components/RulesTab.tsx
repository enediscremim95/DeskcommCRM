"use client";
import * as React from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Robot, Plus, Trash, PencilSimple } from "@/lib/ui/icons";
import { SeloDeAutoria } from "@/components/operacao/SeloDeAutoria";
import {
  useApplyAutomationModel,
  useAutomationRules,
  useUpdateAutomationRule,
  useDeleteAutomationRule,
  type AutomationRuleRow,
} from "@/hooks/webhooks/useAutomationRules";
import { TRIGGER_LABELS, type TriggerEvent } from "./labels";
import { RuleEditor } from "./RuleEditor";
import { useT } from "@/hooks/i18n/useT";
import {
  channelLabel,
  useChannelSessions,
  type ChannelSession,
} from "@/hooks/channels/useChannelSessions";
import { usePipelineStages, usePipelines } from "@/hooks/webhooks/useWebhookSources";
import type { Stage } from "@/lib/kanban/types";
import { MODELO_ATENDIMENTO_PREFIXO } from "@/lib/automation/catalogo";

const RULES_QUERY_KEY = ["automation-rules"];

function triggerLabel(trigger: string, t: (texto: string) => string): string {
  return t(TRIGGER_LABELS[trigger as TriggerEvent] ?? trigger);
}

export function resumoDaRegra(
  rule: AutomationRuleRow,
  stages: Stage[],
  t: (texto: string) => string,
): string {
  const nomeDaEtapa = (id: unknown) =>
    stages.find((stage) => stage.id === id)?.name ?? t("a etapa configurada");
  const condicao = rule.conditions[0];
  let quando = triggerLabel(rule.trigger_event, t).replace(/^Quando /i, "").toLocaleLowerCase();
  if (rule.trigger_event === "lead.stage_changed" && condicao?.field === "event.to_stage_id") {
    quando = `${t("o lead entrar na etapa")} “${nomeDaEtapa(condicao.value)}”`;
  } else if (rule.trigger_event === "message.received" && condicao?.value) {
    quando = `${t("chegar uma mensagem que contém")} “${condicao.value}”`;
  }

  const acoes = rule.actions.map((action) => {
    if (action.type === "send_whatsapp_message") {
      const texto = String(action.config.template ?? "");
      const curto = texto.length > 92 ? `${texto.slice(0, 89)}…` : texto;
      return `${t("mande a mensagem")} “${curto}”`;
    }
    if (action.type === "send_ai_message") return t("peça para a IA escrever e enviar a mensagem");
    if (action.type === "create_or_move_lead") {
      return `${t("mova o lead para")} “${nomeDaEtapa(action.config.stage_id)}”`;
    }
    if (action.type === "assign_owner") return t("atribua o responsável e pare o atendimento automático");
    if (action.type === "add_tag") return t("adicione a tag configurada");
    if (action.type === "remove_tag") return t("remova a tag configurada");
    if (action.type === "start_message_flow") return t("inicie o fluxo de follow-up configurado");
    return t("execute a ação configurada");
  });
  return `${t("QUANDO")} ${quando}, ${t("ENTÃO")} ${acoes.join(` ${t("e")} `)}.`;
}

export function resumoDasTravas(
  rule: AutomationRuleRow,
  sessions: ChannelSession[] | undefined,
  t: (texto: string) => string,
): string | null {
  const envio = rule.actions.find(
    (action) => action.type === "send_whatsapp_message" || action.type === "send_ai_message",
  );
  if (!envio) return null;
  const sessionId = String(envio.config.channel_session_id ?? "");
  const session = sessions?.find((item) => item.id === sessionId);
  const numero = session ? channelLabel(session, t) : t("número configurado");
  const limite = session?.daily_message_limit;
  return `${t("RESPEITANDO a janela de horário, o consentimento e o limite diário")}${
    limite ? ` ${t("de")} ${limite} ${t("mensagens")}` : ""
  } ${t("do número")} ${numero}.`;
}

export function RulesTab() {
  const t = useT();
  const { data, isLoading } = useAutomationRules();
  const update = useUpdateAutomationRule();
  const del = useDeleteAutomationRule();
  const applyModel = useApplyAutomationModel();
  const qc = useQueryClient();
  const { data: sessions } = useChannelSessions();
  const { data: pipelinesRes } = usePipelines();
  const defaultPipeline = pipelinesRes?.data?.find((p) => p.is_default) ?? pipelinesRes?.data?.[0];
  const { data: stagesRes } = usePipelineStages(defaultPipeline?.id ?? null);
  const stages = stagesRes?.data?.stages ?? [];

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AutomationRuleRow | null>(null);
  const [deleting, setDeleting] = React.useState<AutomationRuleRow | null>(null);
  const [activating, setActivating] = React.useState<AutomationRuleRow | null>(null);

  const rules = data?.data ?? [];

  const aplicarModelo = async () => {
    try {
      const response = await applyModel.mutateAsync();
      const { criadas, preservadas } = response.data;
      toast.success(
        criadas > 0
          ? t("Modelos criados e pausados. Revise cada regra antes de ligar.")
          : t("O modelo já estava aplicado. Suas edições foram preservadas."),
        preservadas > 0 ? { description: t("Nenhuma regra foi duplicada.") } : undefined,
      );
    } catch {
      // showApiError já apresentou o motivo.
    }
  };

  const modelCard = (
    <Card className="border-accent/30 bg-accent/5">
      <CardHeader className="gap-2">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <CardTitle>{t("Fluxo modelo de atendimento")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("Cria modelos pausados de primeira abordagem, avanço do lead, entrega a uma pessoa e follow-up por etapa.")}
            </p>
          </div>
          <Button onClick={aplicarModelo} disabled={applyModel.isPending} className="w-full sm:w-auto">
            <Robot /> {applyModel.isPending ? t("Aplicando…") : t("Aplicar modelos pausados")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {t("São modelos editáveis. As mensagens são exemplos e nenhuma regra é ligada sem sua revisão.")}
      </CardContent>
    </Card>
  );

  const toggleActive = (rule: AutomationRuleRow, checked: boolean, modeloRevisado = false) => {
    if (checked && rule.name.startsWith(MODELO_ATENDIMENTO_PREFIXO) && !modeloRevisado) {
      setActivating(rule);
      return;
    }
    qc.setQueryData<{ data: AutomationRuleRow[] }>(RULES_QUERY_KEY, (old) =>
      old ? { data: old.data.map((r) => (r.id === rule.id ? { ...r, is_active: checked } : r)) } : old,
    );
    update.mutate(
      { id: rule.id, is_active: checked },
      {
        onSuccess: () => toast.success(checked ? t("Automação ligada.") : t("Automação pausada.")),
        onError: () => qc.invalidateQueries({ queryKey: RULES_QUERY_KEY }),
      },
    );
  };

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (rule: AutomationRuleRow) => {
    setEditing(rule);
    setEditorOpen(true);
  };

  if (isLoading) {
    return (
      <div className="grid gap-3 pt-4 sm:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="space-y-6 pt-4">
        {modelCard}
        <div className="flex justify-center pt-4">
          <Card className="max-w-md">
          <CardHeader className="items-center text-center">
            <Robot className="mb-2 h-10 w-10 text-accent" />
            <CardTitle>{t("Crie sua primeira automação")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {t("Ex.: quando entrar um contato novo, enviar uma mensagem de boas-vindas.")}
            </p>
            <Button onClick={openCreate}>
              <Plus /> {t("Nova automação")}
            </Button>
          </CardContent>
          </Card>
        </div>
        <RuleEditor open={editorOpen} onOpenChange={setEditorOpen} rule={editing} />
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      {modelCard}
      <div className="flex sm:justify-end">
        <Button onClick={openCreate} className="w-full sm:w-auto">
          <Plus /> {t("Nova automação")}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rules.map((r) => (
          <Card key={r.id}>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="truncate">{r.name}</CardTitle>
                <Badge variant={r.is_active ? "success" : "neutral"}>
                  {r.is_active ? t("Ativa") : t("Pausada")}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{triggerLabel(r.trigger_event, t)}</p>
              <p className="text-sm leading-relaxed text-text">{resumoDaRegra(r, stages, t)}</p>
              {(() => {
                const trava = resumoDasTravas(r, sessions, t);
                if (!trava) {
                  return <p className="text-xs text-muted-foreground">{t("Esta regra não envia mensagem sozinha.")}</p>;
                }
                return (
                  <p className="rounded-sm bg-muted/60 p-2 text-xs text-muted-foreground">
                    {trava}
                  </p>
                );
              })()}
              {/* Uma regra ligada roda sozinha para sempre: quem a ligou é parte
                  do estado dela, não um detalhe de auditoria. */}
              <SeloDeAutoria kind={r.last_change_actor_kind} em={r.last_change_at} />
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-2">
              <Switch
                checked={r.is_active}
                disabled={update.isPending}
                onCheckedChange={(checked) => toggleActive(r, checked)}
                aria-label={`${r.is_active ? t("Pausar") : t("Ligar")} ${r.name}`}
              />
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(r)}
                  aria-label={t("Editar automação")}
                >
                  <PencilSimple />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(r)}
                  aria-label={t("Excluir automação")}
                >
                  <Trash />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <RuleEditor open={editorOpen} onOpenChange={setEditorOpen} rule={editing} />

      <AlertDialog open={!!activating} onOpenChange={(open) => !open && setActivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Você revisou este modelo?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Confirme que revisou a mensagem, a condição, a etapa, o número e o responsável. Ao ligar, a regra pode agir sozinha.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Voltar e revisar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!activating) return;
                toggleActive(activating, true, true);
                setActivating(null);
              }}
            >
              {t("Revisei e quero ligar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Excluir esta automação?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} {t("para de rodar imediatamente. Essa ação não pode ser desfeita.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleting) return;
                await del.mutateAsync(deleting.id);
                toast.success(t("Automação excluída."));
                setDeleting(null);
              }}
            >
              {t("Excluir")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
