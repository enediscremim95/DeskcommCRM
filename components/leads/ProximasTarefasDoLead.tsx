"use client";

import { useMemo, useState } from "react";

import { FormularioDeTarefa } from "@/app/app/tasks/_components/FormularioDeTarefa";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useTasks } from "@/hooks/tasks/useTasks";
import { CalendarPlus } from "@/lib/ui/icons";
import { MarcacaoDoLead } from "./MarcacaoDoLead";

interface Props {
  leadId: string;
  contactId: string | null;
  conversationId: string | null;
  nomeDoLead: string;
  canEdit: boolean;
}

export function ProximasTarefasDoLead({
  leadId,
  contactId,
  conversationId,
  nomeDoLead,
  canEdit,
}: Props) {
  const t = useT();
  const locale = useTagDeIdioma();
  const tasks = useTasks({ lead_id: leadId, aberto: true });
  const [open, setOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const next = useMemo(
    () =>
      [...tasks.tarefas]
        .sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        })
        .slice(0, 3),
    [tasks.tarefas],
  );

  return (
    <section
      className="rounded-lg border border-border bg-surface p-3"
      data-testid="next-lead-tasks"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
          {t("Próximas tarefas")}
        </h2>
      </div>
      {canEdit && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            onClick={() => setAgendaOpen(true)}
          >
            <CalendarPlus size={15} aria-hidden /> {t("Marcar compromisso")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            className="min-h-11 sm:min-h-8"
            onClick={() => setOpen(true)}
          >
            <CalendarPlus size={15} aria-hidden /> {t("Criar tarefa")}
          </Button>
        </div>
      )}
      {tasks.carregando ? (
        <p className="mt-2 text-xs text-text-muted">{t("Carregando…")}</p>
      ) : next.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">
          {t("Nenhuma tarefa pendente para este lead.")}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {next.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-text">{task.title}</span>
              <time className="shrink-0 text-text-muted" dateTime={task.due_date ?? undefined}>
                {task.due_date
                  ? new Intl.DateTimeFormat(locale, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(task.due_date))
                  : t("Sem prazo")}
              </time>
            </li>
          ))}
        </ul>
      )}
      <FormularioDeTarefa
        key={open ? `new-${leadId}` : `closed-${leadId}`}
        aberto={open}
        aoMudarAbertura={setOpen}
        aoSalvar={tasks.criarTarefa}
        leadId={leadId}
        contactId={contactId}
        tituloDaCriacao={t("Nova tarefa")}
      />
      <MarcacaoDoLead
        key={agendaOpen ? `agenda-${leadId}` : `agenda-fechada-${leadId}`}
        aberto={agendaOpen}
        aoMudarAbertura={setAgendaOpen}
        leadId={leadId}
        contactId={contactId}
        conversationId={conversationId}
        nomeDoLead={nomeDoLead}
      />
    </section>
  );
}
