"use client";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useAtRiskLeads, type AtRiskLead } from "@/hooks/leads/useAtRiskLeads";
import type { TarefaDoRadar } from "@/lib/leads/radar-de-risco";
import type { RiskBucket } from "@/lib/leads/risk-radar";
import {
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  ClockCountdown,
  PaperPlaneTilt,
  Warning,
} from "@/lib/ui/icons";

const RISK_META: Record<
  Exclude<RiskBucket, "em_dia">,
  { label: string; variant: "error" | "warning" | "info" }
> = {
  critico: { label: "Crítico", variant: "error" },
  em_risco: { label: "Em risco", variant: "warning" },
  em_voo: { label: "Em voo", variant: "info" },
};

function coldFor(hours: number, t: (texto: string) => string): string {
  if (hours < 48) return `${t("parado há")} ${hours}h`;
  return `${t("parado há")} ${Math.round(hours / 24)}d`;
}

function followupWhen(iso: string, t: (texto: string) => string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return t("agora");
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 48) return `${t("em")} ${Math.max(1, hours)}h`;
  return `${t("em")} ${Math.round(hours / 24)}d`;
}

function manualFollowupWhen(iso: string, t: (texto: string) => string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const hours = Math.round(Math.abs(diffMs) / 3_600_000);
  if (diffMs <= 0) {
    if (hours < 1) return t("vence agora");
    if (hours < 48) return `${t("venceu há")} ${hours}h`;
    return `${t("venceu há")} ${Math.round(hours / 24)}d`;
  }
  return followupWhen(iso, t);
}

export function prazoDaTarefa(
  iso: string,
  agora = new Date(),
  t: (texto: string) => string = (texto) => texto,
): string {
  const prazo = new Date(iso);
  const diffMs = prazo.getTime() - agora.getTime();
  const horas = Math.max(1, Math.round(Math.abs(diffMs) / 3_600_000));
  if (diffMs <= 0) {
    if (horas < 24) return `${t("atrasada há")} ${horas} h`;
    const dias = Math.max(1, Math.round(horas / 24));
    return `${t("atrasada há")} ${dias} ${t(dias === 1 ? "dia" : "dias")}`;
  }
  const amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  if (
    prazo.getFullYear() === amanha.getFullYear() &&
    prazo.getMonth() === amanha.getMonth() &&
    prazo.getDate() === amanha.getDate()
  ) {
    return t("vence amanhã");
  }
  if (horas < 24) return `${t("vence em")} ${horas} h`;
  const dias = Math.max(1, Math.round(horas / 24));
  return `${t("vence em")} ${dias} ${t(dias === 1 ? "dia" : "dias")}`;
}

export function RiskRadarList() {
  const t = useT();
  const { data, isLoading } = useAtRiskLeads();

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // O vazio só é vazio se as DUAS listas estiverem vazias. Sem esta condição,
  // uma organização com 8 demandas sem próximo passo e nenhum lead frio veria
  // "Nenhuma demanda em risco" — escondendo exatamente o vazamento que o
  // invariante 4 existe para denunciar.
  const semPasso = data?.sem_proximo_passo ?? [];
  const tarefas = data?.tasks ?? [];
  if (!data || (data.total === 0 && semPasso.length === 0 && tarefas.length === 0)) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
        data-testid="radar-empty"
      >
        <CheckCircle size={28} className="text-success-fg/70" aria-hidden />
        <p className="text-sm font-medium">{t("Nenhuma demanda em risco")}</p>
        <p className="text-xs text-muted-foreground">
          {t("Toda demanda aberta teve atividade recente ou já tem um retorno agendado.")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {tarefas.length > 0 ? <TarefasDoRadar tarefas={tarefas} /> : null}
      {/* INVARIANTE 4 em forma acionável: o índice de atrito publica a CONTAGEM
          ("N demandas abertas sem próximo passo"); contagem sem lugar para agir
          viola o invariante 5. Esta é a lista que responde "e daí?". */}
      {semPasso.length > 0 ? (
        <section
          className="rounded-lg border border-warning-border bg-warning-bg/40 p-3"
          data-testid="radar-sem-proximo-passo"
        >
          <p className="text-sm font-medium">
            {semPasso.length}{" "}
            {semPasso.length === 1
              ? t("demanda aberta sem próximo passo")
              : t("demandas abertas sem próximo passo")}
          </p>
          <p className="mb-2 text-xs text-muted-foreground">
            {t(
              "Ninguém marcou o que acontece a seguir. Cada uma é alguém esperando sem que nada esteja combinado.",
            )}
          </p>
          <ul className="flex flex-col gap-1">
            {semPasso.slice(0, 8).map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate">{d.contact_name ?? t("Contato sem nome")}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {t("aberta há")} {d.horas_aberta}h
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2" data-testid="radar-counts">
        <Badge variant="error">
          {data.counts.critico} {t("crítico")}
        </Badge>
        <Badge variant="warning">
          {data.counts.em_risco} {t("em risco")}
        </Badge>
        <Badge variant="info">
          {data.counts.em_voo} {t("em voo")}
        </Badge>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {data.items.map((lead) => (
          <RadarRow key={lead.id} lead={lead} />
        ))}
      </ul>
    </div>
  );
}

function TarefasDoRadar({ tarefas }: { tarefas: TarefaDoRadar[] }) {
  const t = useT();
  return (
    <section className="rounded-lg border border-border p-3" data-testid="radar-tarefas">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("Tarefas")}</p>
          <p className="text-xs text-muted-foreground">
            {t("O que precisa ser feito, pela urgência.")}
          </p>
        </div>
        <Link href="/app/tasks" className="shrink-0 text-xs underline">
          {t("Ver todas")}
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {tarefas.map((tarefa) => (
          <li
            key={tarefa.id}
            className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{tarefa.title}</p>
              {tarefa.description ? (
                <p className="truncate text-xs text-muted-foreground">{tarefa.description}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-warning-fg">
              {prazoDaTarefa(tarefa.due_date, new Date(), t)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RadarRow({ lead }: { lead: AtRiskLead }) {
  const t = useT();
  const meta = RISK_META[lead.risk as Exclude<RiskBucket, "em_dia">] ?? RISK_META.em_risco;
  const href = `/app/pipelines/${lead.pipeline_id}?lead=${lead.id}`;

  const claim = useClaimConversation();
  const qc = useQueryClient();

  // Dono do NEGÓCIO — humano OU agente (0070). Antes desta linha o radar lia só
  // `owner_user_id`, então um lead que a IA trabalha há dezenas de turnos aparecia
  // como "Sem dono" e mandava um humano resgatar o que já estava sendo tocado.
  // A distinção é a MESMA do card (OwnerBadge): geométrica, nunca ícone de robô —
  // uma fonte de verdade para "quem é o dono", em todas as telas.
  const dono =
    lead.owner_kind === "ai"
      ? `${t("Agente:")} ${lead.owner_agent_name ?? t("sem nome")}`
      : lead.owner_user_id || lead.assignee_kind === "user"
        ? t("Com atendente")
        : lead.assignee_kind === "ai"
          ? t("Assistente na conversa")
          : t("Sem dono");

  // "Assumir" é tirar da IA e trazer para si: continua valendo enquanto não há
  // dono HUMANO — dono agente não bloqueia o handoff, é justamente o caso dele.
  const ownedByHuman = Boolean(lead.owner_user_id) || lead.assignee_kind === "user";
  const canClaim = Boolean(lead.conversation_id) && !ownedByHuman;

  function handleClaim() {
    if (!lead.conversation_id) return;
    claim.mutate(
      { conversation_id: lead.conversation_id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["leads-at-risk"] });
          toast.success(t("Você assumiu a demanda"));
        },
      },
    );
  }

  return (
    <li
      data-testid="radar-item"
      data-risk={lead.risk}
      className="flex items-start gap-2 pr-3 transition-colors hover:bg-accent/50"
    >
      <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3">
        <Badge variant={meta.variant} className="mt-0.5 shrink-0">
          {t(meta.label)}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {lead.contact_name ? <span className="truncate">{lead.contact_name}</span> : null}
            <span className="inline-flex items-center gap-1">
              <ClockCountdown size={13} aria-hidden />
              {coldFor(lead.hours_since_activity, t)}
            </span>
            <span className="inline-flex items-center gap-1" data-testid="radar-assignee">
              {dono}
            </span>
          </p>
          {lead.manual_followup ? (
            <div className="mt-1 rounded-md border border-warning-border bg-warning-bg/50 p-2 text-xs" data-testid="radar-followup-manual">
              <p className="inline-flex items-center gap-1 font-medium text-warning-fg">
                <CalendarBlank size={13} aria-hidden />
                {lead.manual_followup.title}
              </p>
              {lead.manual_followup.description ? <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{lead.manual_followup.description}</p> : null}
              <p className="mt-0.5 tabular-nums text-muted-foreground">
                {manualFollowupWhen(lead.manual_followup.due_date, t)}
                {lead.manual_followup.open_count > 1 ? ` · +${lead.manual_followup.open_count - 1} ${t(lead.manual_followup.open_count === 2 ? "pendente" : "pendentes")}` : ""}
              </p>
            </div>
          ) : lead.agenda?.appointment_id ? (
            <p className="mt-1 text-xs text-info-fg">{t(lead.agenda.motivo === "presenca_vencida" ? "Presença não confirmada · revise o compromisso" : lead.agenda.motivo === "presenca_pendente" ? "Confirme a presença · cobrança aguardando" : "Compromisso agendado · cobrança aguardando")}</p>
          ) : lead.in_flight && lead.next_followup_at ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-info-fg">
              <PaperPlaneTilt size={13} aria-hidden />
              {t("Assistente retorna")} {followupWhen(lead.next_followup_at, t)}
            </p>
          ) : (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-warning-fg">
              <Warning size={13} aria-hidden />
              {t("Sem próximo passo agendado")}
            </p>
          )}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2 self-center">
        {lead.agenda?.appointment_id ? <Link className="text-xs underline" href={`/app/agenda?compromisso=${lead.agenda.appointment_id}`}>{t("Ver compromisso")}</Link> : null}
        {canClaim ? (
          <Button
            size="sm"
            variant="outline"
            disabled={claim.isPending}
            onClick={handleClaim}
            data-testid="radar-claim"
          >
            {t("Assumir")}
          </Button>
        ) : null}
        <ArrowRight size={16} className="text-muted-foreground" aria-hidden />
      </div>
    </li>
  );
}
