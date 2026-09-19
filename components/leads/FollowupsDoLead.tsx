"use client";

import { useState } from "react";

import { FormularioDeTarefa } from "@/app/app/tasks/_components/FormularioDeTarefa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useTasks } from "@/hooks/tasks/useTasks";
import { CalendarBlank, CheckCircle, Plus } from "@/lib/ui/icons";
import { estaAtrasada, type NovaTarefa, type Tarefa } from "@/lib/tarefas/tipos";
import { cn } from "@/lib/utils";

interface Props {
  leadId: string;
  contactId: string | null;
  podeEditar: boolean;
}

function prazoLegivel(iso: string | null, tag: string, semPrazo: string): string {
  if (!iso) return semPrazo;
  return new Date(iso).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" });
}

/**
 * Uma superfície, uma fonte: o mesmo `crm_tasks` alimenta lead, contato e Radar.
 * O componente recebe o lead explicitamente para nunca adivinhar qual negócio
 * de um contato com mais de um funil deve receber o follow-up.
 */
export function FollowupsDoLead({ leadId, contactId, podeEditar }: Props) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [formAberto, setFormAberto] = useState(false);
  const [aberturas, setAberturas] = useState(0);
  const { tarefas, carregando, falhou, criarTarefa, alternarConcluida } = useTasks({
    lead_id: leadId,
  });
  const followups = tarefas.filter((tarefa) => tarefa.due_date !== null);

  function abrir() {
    setAberturas((atual) => atual + 1);
    setFormAberto(true);
  }

  async function salvar(entrada: NovaTarefa) {
    await criarTarefa(entrada);
  }

  return (
    <section className="space-y-2" data-testid="followups-do-lead">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
            {t("Follow-ups")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("Próximos contatos deste negócio. Quando vencem, aparecem no Radar.")}
          </p>
        </div>
        {podeEditar ? (
          <Button type="button" size="sm" variant="outline" onClick={abrir}>
            <Plus size={14} aria-hidden />
            {t("Follow-up")}
          </Button>
        ) : null}
      </div>

      {carregando ? <Skeleton className="h-14 w-full" /> : null}
      {falhou ? (
        <p role="alert" className="text-xs text-error-fg">
          {t("Não foi possível carregar os follow-ups.")}
        </p>
      ) : null}
      {!carregando && !falhou && followups.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {t("Nenhum follow-up marcado para este negócio.")}
        </p>
      ) : null}

      {followups.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {followups.map((tarefa: Tarefa) => {
            const encerrada = tarefa.status === "done" || tarefa.status === "cancelled";
            // Atrasado pede ação AGORA; a cor entra só aí (e some quando encerra).
            const atrasada = estaAtrasada(tarefa);
            return (
              <li key={tarefa.id} className="flex items-start gap-3 p-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    encerrada
                      ? "bg-surface-elevated text-text-subtle"
                      : atrasada
                        ? "bg-error-bg text-error-fg"
                        : "bg-accent-soft text-accent",
                  )}
                  aria-hidden
                >
                  <CalendarBlank size={13} weight={encerrada ? "regular" : "fill"} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={
                        encerrada ? "text-sm line-through opacity-70" : "text-sm font-medium"
                      }
                    >
                      {tarefa.title}
                    </p>
                    {encerrada ? (
                      <Badge variant="neutral">
                        {tarefa.status === "cancelled" ? t("Cancelado") : t("Feito")}
                      </Badge>
                    ) : atrasada ? (
                      <Badge variant="error">{t("Atrasado")}</Badge>
                    ) : null}
                  </div>
                  {tarefa.description ? (
                    <p className="mt-0.5 text-xs whitespace-pre-wrap text-muted-foreground">
                      {tarefa.description}
                    </p>
                  ) : null}
                  <p
                    className={cn(
                      "mt-1 text-xs tabular-nums",
                      atrasada ? "font-medium text-error-fg" : "text-muted-foreground",
                    )}
                  >
                    {prazoLegivel(tarefa.due_date, tag, t("Sem prazo"))}
                  </p>
                </div>
                {podeEditar && !encerrada ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void alternarConcluida(tarefa)}
                    aria-label={t("Marcar follow-up como feito")}
                  >
                    <CheckCircle size={16} aria-hidden />
                    {t("Feito")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <FormularioDeTarefa
        key={aberturas}
        aberto={formAberto}
        aoMudarAbertura={setFormAberto}
        aoSalvar={salvar}
        leadId={leadId}
        contactId={contactId}
        exigirPrazo
        tituloDaCriacao="Novo follow-up"
      />
    </section>
  );
}
