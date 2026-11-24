"use client";

import { useState } from "react";

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
import { actionConfigSchema } from "@/lib/followup/graph-schema";
import {
  MODOS_DA_ACAO,
  PRIORIDADES_DA_TAREFA_DO_FLUXO,
  opcoes,
  type ModoDaAcao,
} from "@/lib/followup/vocabulario";
import { useMessageTemplates } from "@/hooks/inbox/useMessageTemplates";
import { useEtapasDeGatilho } from "@/hooks/followup/useEtapasDeGatilho";
import { useT } from "@/hooks/i18n/useT";

import type { ConfigOf } from "./shared";

/**
 * O seletor de modelo, no lugar dos dois `<Input>` que pediam um UUID colado à
 * mão. Trata os três estados em vez de fingir que a lista sempre chega:
 * carregando, vazia e erro — porque um seletor vazio sem explicação é o mesmo
 * beco sem saída que o campo de UUID era, só que mais bonito.
 */
function SeletorDeModelo({
  id,
  valor,
  onChange,
  permiteVazio,
}: {
  id: string;
  valor: string;
  onChange: (templateId: string) => void;
  permiteVazio: boolean;
}) {
  const t = useT();
  const { data: modelos, isLoading, isError } = useMessageTemplates();

  if (isLoading) return <p className="text-xs text-text-muted">{t("Carregando seus modelos…")}</p>;
  if (isError) {
    return (
      <p className="text-xs text-error-fg">
        {t("Não consegui carregar seus modelos de mensagem. Recarregue a página.")}
      </p>
    );
  }
  if (!modelos?.length) {
    return (
      <p className="text-xs text-text-muted">
        {t("Você ainda não tem modelos de mensagem. Crie um em Ajustes → Modelos e ele aparece aqui.")}
      </p>
    );
  }

  const SEM_MODELO = "__nenhum__";
  return (
    <Select
      value={valor === "" ? SEM_MODELO : valor}
      onValueChange={(v) => onChange(v === SEM_MODELO ? "" : v)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={t("Escolha um modelo")} />
      </SelectTrigger>
      <SelectContent>
        {permiteVazio && <SelectItem value={SEM_MODELO}>{t("Nenhum")}</SelectItem>}
        {modelos.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Etapa de destino do "avançar etapa" — nome do funil e da etapa, nunca o uuid. */
function SeletorDeEtapa({ valor, onChange }: { valor: string; onChange: (stageId: string) => void }) {
  const t = useT();
  const { etapas, carregando } = useEtapasDeGatilho();
  if (carregando) return <p className="text-xs text-text-muted">{t("Carregando as etapas do funil…")}</p>;
  if (!etapas.length) {
    return <p className="text-xs text-text-muted">{t("Nenhuma etapa de funil encontrada nesta organização.")}</p>;
  }
  const SEM_ETAPA = "__nenhuma__";
  return (
    <Select value={valor === "" ? SEM_ETAPA : valor} onValueChange={(v) => onChange(v === SEM_ETAPA ? "" : v)}>
      <SelectTrigger id="action-stage-id">
        <SelectValue placeholder={t("Escolha a etapa")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SEM_ETAPA}>{t("Nenhuma (o passo não move nada)")}</SelectItem>
        {etapas.map((e) => (
          <SelectItem key={e.stageId} value={e.stageId}>
            {e.pipelineName} · {e.stageName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type PrioridadeDoPasso = keyof typeof PRIORIDADES_DA_TAREFA_DO_FLUXO;

export function ActionForm({
  config,
  onChange,
}: {
  config: ConfigOf<"action">;
  onChange: (c: ConfigOf<"action">) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState(config.mode);
  const [body, setBody] = useState(config.mode === "text" ? config.body : "");
  const [promptHint, setPromptHint] = useState(config.mode === "ai_message" ? config.prompt_hint : "");
  const [fallbackTemplateId, setFallbackTemplateId] = useState(
    config.mode === "ai_message" ? (config.fallback_template_id ?? "") : "",
  );
  const [templateId, setTemplateId] = useState(config.mode === "template" ? config.template_id : "");
  const [taskTitle, setTaskTitle] = useState(config.mode === "human_task" ? config.title : "");
  const [taskDescription, setTaskDescription] = useState(
    config.mode === "human_task" ? (config.description ?? "") : "",
  );
  const [taskPriority, setTaskPriority] = useState<PrioridadeDoPasso>(
    config.mode === "human_task" ? (config.priority ?? "high") : "high",
  );
  const [taskDueMin, setTaskDueMin] = useState(
    config.mode === "human_task" && config.due_in_minutes !== undefined ? String(config.due_in_minutes) : "",
  );
  const [stageId, setStageId] = useState(config.mode === "move_stage" ? (config.stage_id ?? "") : "");
  const [error, setError] = useState<string | null>(null);

  const commit = (next: {
    mode: ModoDaAcao;
    body: string;
    promptHint: string;
    fallbackTemplateId: string;
    templateId: string;
    taskTitle: string;
    taskDescription: string;
    taskPriority: PrioridadeDoPasso;
    taskDueMin: string;
    stageId: string;
  }) => {
    const prazo = next.taskDueMin.trim() === "" ? undefined : Number(next.taskDueMin);
    const candidate =
      next.mode === "text"
        ? { mode: "text" as const, body: next.body }
        : next.mode === "ai_message"
          ? {
              mode: "ai_message" as const,
              prompt_hint: next.promptHint,
              ...(next.fallbackTemplateId.trim() ? { fallback_template_id: next.fallbackTemplateId } : {}),
            }
          : next.mode === "human_task"
            ? {
                mode: "human_task" as const,
                title: next.taskTitle,
                ...(next.taskDescription.trim() ? { description: next.taskDescription } : {}),
                priority: next.taskPriority,
                ...(prazo !== undefined ? { due_in_minutes: prazo } : {}),
              }
            : next.mode === "move_stage"
              ? { mode: "move_stage" as const, ...(next.stageId ? { stage_id: next.stageId } : {}) }
              : { mode: "template" as const, template_id: next.templateId };
    const parsed = actionConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  const fields = {
    body,
    promptHint,
    fallbackTemplateId,
    templateId,
    taskTitle,
    taskDescription,
    taskPriority,
    taskDueMin,
    stageId,
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="action-mode">{t("O que este passo faz")}</Label>
        <Select
          value={mode}
          onValueChange={(v) => {
            const next = v as ModoDaAcao;
            setMode(next);
            commit({ mode: next, ...fields });
          }}
        >
          <SelectTrigger id="action-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoes(MODOS_DA_ACAO).map(({ valor, rotulo }) => (
              <SelectItem key={valor} value={valor}>
                {t(rotulo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "text" ? (
        <div className="space-y-2">
          <Label htmlFor="action-body">{t("Texto enviado ao contato")}</Label>
          <Textarea
            id="action-body"
            maxLength={4000}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              commit({ mode, ...fields, body: e.target.value });
            }}
          />
          <p className="text-xs text-text-muted">
            {t("Sai exatamente assim, sem IA. No laço,")} {t("{{volta}}")} e {t("{{voltas}}")} {t("viram o número da volta.")}
          </p>
        </div>
      ) : mode === "ai_message" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-prompt-hint">{t("Instrução para a IA")}</Label>
            <Textarea
              id="action-prompt-hint"
              maxLength={1000}
              value={promptHint}
              onChange={(e) => {
                setPromptHint(e.target.value);
                commit({ mode, ...fields, promptHint: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-fallback">{t("Se a IA não conseguir escrever, mandar este modelo")}</Label>
            <SeletorDeModelo
              id="action-fallback"
              valor={fallbackTemplateId}
              permiteVazio
              onChange={(v) => {
                setFallbackTemplateId(v);
                commit({ mode, ...fields, fallbackTemplateId: v });
              }}
            />
          </div>
        </>
      ) : mode === "human_task" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-task-title">{t("Título da tarefa")}</Label>
            <Input
              id="action-task-title"
              maxLength={200}
              value={taskTitle}
              placeholder={t("Ligar para {{nome}}")}
              onChange={(e) => {
                setTaskTitle(e.target.value);
                commit({ mode, ...fields, taskTitle: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-task-description">{t("Descrição (opcional)")}</Label>
            <Textarea
              id="action-task-description"
              maxLength={2000}
              value={taskDescription}
              onChange={(e) => {
                setTaskDescription(e.target.value);
                commit({ mode, ...fields, taskDescription: e.target.value });
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="action-task-priority">{t("Prioridade")}</Label>
              <Select
                value={taskPriority}
                onValueChange={(v) => {
                  const p = v as PrioridadeDoPasso;
                  setTaskPriority(p);
                  commit({ mode, ...fields, taskPriority: p });
                }}
              >
                <SelectTrigger id="action-task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opcoes(PRIORIDADES_DA_TAREFA_DO_FLUXO).map(({ valor, rotulo }) => (
                    <SelectItem key={valor} value={valor}>
                      {t(rotulo)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-task-due">{t("Prazo (minutos)")}</Label>
              <Input
                id="action-task-due"
                type="number"
                min={0}
                max={43200}
                value={taskDueMin}
                onChange={(e) => {
                  setTaskDueMin(e.target.value);
                  commit({ mode, ...fields, taskDueMin: e.target.value });
                }}
              />
            </div>
          </div>
          <p className="text-xs text-text-muted">
            {t("Nada é enviado ao contato. A tarefa vai para quem atende a conversa ou o número; sem ninguém, para o dono do negócio e depois para a administração. Um aviso abre na Central.")}{" "}
            {t("{{nome}}")} {t("vira o nome do contato.")}
          </p>
        </>
      ) : mode === "move_stage" ? (
        <div className="space-y-2">
          <Label htmlFor="action-stage-id">{t("Etapa de destino")}</Label>
          <SeletorDeEtapa
            valor={stageId}
            onChange={(v) => {
              setStageId(v);
              commit({ mode, ...fields, stageId: v });
            }}
          />
          <p className="text-xs text-text-muted">
            {t("Só avança: se a etapa estiver antes da atual, for Ganho ou Perdido, ou de outro funil, o negócio fica onde está e o motivo aparece no acompanhamento. Nada é enviado ao contato.")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="action-template-id">{t("Modelo de mensagem")}</Label>
          <SeletorDeModelo
            id="action-template-id"
            valor={templateId}
            permiteVazio={false}
            onChange={(v) => {
              setTemplateId(v);
              commit({ mode, ...fields, templateId: v });
            }}
          />
        </div>
      )}
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
