"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { FormularioDeTarefa } from "@/app/app/tasks/_components/FormularioDeTarefa";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useAtRiskLeads, type AtRiskData, type AtRiskLead } from "@/hooks/leads/useAtRiskLeads";
import { apiClient } from "@/lib/api/client";
import type { TarefaDoRadar } from "@/lib/leads/radar-de-risco";
import type { NovaTarefa, Tarefa } from "@/lib/tarefas/tipos";
import { ArrowRight, CheckCircle, ClockCountdown, Warning } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const VINTE_E_QUATRO_HORAS_MS = 24 * 3_600_000;

type AlertaDoRadar =
  | { tipo: "tarefa"; tarefa: TarefaDoRadar; faixa: "atrasada" | "proxima"; ordem: number }
  | { tipo: "lead"; lead: AtRiskLead; ordem: number };

function coldFor(hours: number, t: (texto: string) => string): string {
  if (hours < 48) return `${t("parado há")} ${hours}h`;
  return `${t("parado há")} ${Math.round(hours / 24)}d`;
}

export function prazoDaTarefa(
  iso: string,
  agora = new Date(),
  t: (texto: string) => string = (texto) => texto,
): string {
  const diffMs = new Date(iso).getTime() - agora.getTime();
  const horas = Math.max(1, Math.round(Math.abs(diffMs) / 3_600_000));
  if (diffMs <= 0) {
    if (horas < 24) return `${t("atrasada há")} ${horas} h`;
    const dias = Math.max(1, Math.round(horas / 24));
    return `${t("atrasada há")} ${dias} ${t(dias === 1 ? "dia" : "dias")}`;
  }
  return `${t("vence em")} ${horas} h`;
}

/** A seleção é exclusivamente da tela. O contrato compartilhado com o MCP permanece inteiro. */
export function montaAlertasDoRadar(
  data: AtRiskData,
  agora = new Date(),
): AlertaDoRadar[] {
  const agoraMs = agora.getTime();
  const limiteMs = agoraMs + VINTE_E_QUATRO_HORAS_MS;

  const tarefas: AlertaDoRadar[] = (data.tasks ?? []).flatMap((tarefa) => {
    const prazo = new Date(tarefa.due_date).getTime();
    if (!Number.isFinite(prazo) || prazo > limiteMs) return [];
    return [
      {
        tipo: "tarefa" as const,
        tarefa,
        faixa: prazo <= agoraMs ? ("atrasada" as const) : ("proxima" as const),
        ordem: prazo,
      },
    ];
  });

  const leads: AlertaDoRadar[] = data.items
    .filter(
      (lead) =>
        (lead.risk === "critico" || lead.risk === "em_risco") &&
        !lead.in_flight &&
        !lead.manual_followup &&
        !lead.has_open_task &&
        !lead.agenda?.appointment_id,
    )
    .map((lead) => ({ tipo: "lead", lead, ordem: lead.hours_since_activity }));

  const prioridade = (alerta: AlertaDoRadar): number => {
    if (alerta.tipo === "tarefa") return alerta.faixa === "atrasada" ? 0 : 2;
    return alerta.lead.risk === "critico" ? 1 : 3;
  };

  return [...tarefas, ...leads].sort((a, b) => {
    const porPrioridade = prioridade(a) - prioridade(b);
    if (porPrioridade !== 0) return porPrioridade;
    if (a.tipo === "tarefa" && b.tipo === "tarefa") return a.ordem - b.ordem;
    return b.ordem - a.ordem;
  });
}

export function RiskRadarList() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useAtRiskLeads();
  const [leadParaFollowup, setLeadParaFollowup] = useState<AtRiskLead | null>(null);
  const [aberturas, setAberturas] = useState(0);

  const concluirTarefa = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<{ data: { task: Tarefa } }>(`/api/v1/tasks/${id}`, { status: "done" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leads-at-risk"] });
      toast.success(t("Tarefa concluída"));
    },
    onError: () => toast.error(t("Não foi possível concluir a tarefa.")),
  });

  const criarFollowup = useMutation({
    mutationFn: (entrada: NovaTarefa) =>
      apiClient.post<{ data: { task: Tarefa } }>("/api/v1/tasks", entrada),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leads-at-risk"] });
      toast.success(t("Follow-up marcado"));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  const alertas = data ? montaAlertasDoRadar(data) : [];
  if (alertas.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
        data-testid="radar-empty"
      >
        <CheckCircle size={28} className="text-success-fg/70" aria-hidden />
        <p className="text-sm font-medium">{t("Nada pedindo atenção agora.")}</p>
      </div>
    );
  }

  function abrirFollowup(lead: AtRiskLead) {
    setLeadParaFollowup(lead);
    setAberturas((atual) => atual + 1);
  }

  return (
    <>
      <ul className="grid gap-3" data-testid="radar-alertas">
        {alertas.map((alerta) =>
          alerta.tipo === "tarefa" ? (
            <TarefaAlerta
              key={`tarefa-${alerta.tarefa.id}`}
              tarefa={alerta.tarefa}
              faixa={alerta.faixa}
              concluindo={
                concluirTarefa.isPending && concluirTarefa.variables === alerta.tarefa.id
              }
              aoConcluir={() => concluirTarefa.mutate(alerta.tarefa.id)}
            />
          ) : (
            <LeadAlerta
              key={`lead-${alerta.lead.id}`}
              lead={alerta.lead}
              aoMarcarFollowup={() => abrirFollowup(alerta.lead)}
            />
          ),
        )}
      </ul>

      {leadParaFollowup ? (
        <FormularioDeTarefa
          key={`${leadParaFollowup.id}-${aberturas}`}
          aberto
          aoMudarAbertura={(aberto) => {
            if (!aberto) setLeadParaFollowup(null);
          }}
          aoSalvar={(entrada) => criarFollowup.mutateAsync(entrada)}
          leadId={leadParaFollowup.id}
          contactId={leadParaFollowup.contact_id}
          exigirPrazo
          tituloDaCriacao="Marcar follow-up"
        />
      ) : null}
    </>
  );
}

function TarefaAlerta({
  tarefa,
  faixa,
  concluindo,
  aoConcluir,
}: {
  tarefa: TarefaDoRadar;
  faixa: "atrasada" | "proxima";
  concluindo: boolean;
  aoConcluir: () => void;
}) {
  const t = useT();
  const atrasada = faixa === "atrasada";
  const href = tarefa.lead_id
    ? `/app/leads/${tarefa.lead_id}`
    : tarefa.contact_id
      ? `/app/contacts/${tarefa.contact_id}`
      : null;
  const comQuem = tarefa.contact_name ?? tarefa.lead_title;

  return (
    <li
      data-testid="radar-item"
      data-alert-kind={atrasada ? "tarefa-atrasada" : "tarefa-proxima"}
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center",
        atrasada
          ? "border-destructive/30 bg-destructive/5"
          : "border-warning-border bg-warning-bg/40",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Warning
          size={20}
          className={cn("mt-0.5 shrink-0", atrasada ? "text-destructive" : "text-warning-fg")}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(atrasada ? "Tarefa atrasada" : "Tarefa próxima do prazo")}
          </p>
          <p className="truncate text-sm font-semibold">{tarefa.title}</p>
          {comQuem ? (
            <p className="truncate text-xs text-muted-foreground">{t("Com")} {comQuem}</p>
          ) : null}
          <p
            className={cn(
              "mt-1 inline-flex items-center gap-1 text-xs font-medium tabular-nums",
              atrasada ? "text-destructive" : "text-warning-fg",
            )}
          >
            <ClockCountdown size={13} aria-hidden />
            {prazoDaTarefa(tarefa.due_date, new Date(), t)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {href ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href}>{t(tarefa.lead_id ? "Abrir lead" : "Abrir contato")}</Link>
          </Button>
        ) : null}
        <Button size="sm" disabled={concluindo} onClick={aoConcluir}>
          <CheckCircle size={15} aria-hidden />
          {concluindo ? t("Concluindo…") : t("Marcar como feita")}
        </Button>
      </div>
    </li>
  );
}

function LeadAlerta({ lead, aoMarcarFollowup }: { lead: AtRiskLead; aoMarcarFollowup: () => void }) {
  const t = useT();

  return (
    <li
      data-testid="radar-item"
      data-alert-kind="lead-sem-proximo-passo"
      data-risk={lead.risk}
      className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Warning size={20} className="mt-0.5 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Lead sem próximo passo")}
          </p>
          <p className="truncate text-sm font-semibold">{lead.contact_name ?? lead.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {lead.stage_name ?? t("Etapa sem nome")}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-destructive tabular-nums">
            <ClockCountdown size={13} aria-hidden />
            {coldFor(lead.hours_since_activity, t)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href={`/app/leads/${lead.id}`}>
            {t("Abrir lead")}
            <ArrowRight size={14} aria-hidden />
          </Link>
        </Button>
        <Button size="sm" onClick={aoMarcarFollowup}>
          {t("Marcar follow-up")}
        </Button>
      </div>
    </li>
  );
}
