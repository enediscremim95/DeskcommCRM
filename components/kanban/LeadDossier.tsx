"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useRef } from "react";

import { useT } from "@/hooks/i18n/useT";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import type { Lead } from "@/lib/types/leads";
import { ConversaNoDossie } from "./ConversaNoDossie";
import { LeadFieldsForm } from "./LeadFieldsForm";
import { ScoreSlot } from "./ScoreSlot";
import { LeadTimeline } from "./LeadTimeline";
import { OwnerBadge } from "./OwnerBadge";
import { resolveLeadOwner } from "@/lib/kanban/owner";
import type { CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import { DadosCompletosDoLead } from "@/components/leads/DadosCompletosDoLead";
import { FollowupsDoLead } from "@/components/leads/FollowupsDoLead";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { ROLE_RANK } from "@/lib/auth/types";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { stageAgeTooltip } from "@/lib/kanban/card-state";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
  pipelineName: string;
  fieldDefs?: CustomFieldDef[];
  stageName: string;
  ownerNames?: Map<string, string | null>;
}

function formatBRL(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency ?? "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

function campaignOf(lead: Lead): string | null {
  const metadata = lead.source_metadata ?? {};
  for (const key of ["utm_campaign", "campaign_name", "campaign"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * O dossiê do negócio: cabeçalho vivo → timeline → campos.
 *
 * A ORDEM É a mudança em relação ao diálogo de edição: quem abre um lead quer
 * primeiro saber O QUE ACONTECEU, e só depois mexer. O formulário íntegro fica
 * por último, e o cabeçalho tem um atalho para ele — ordem preservada, custo de
 * rolagem resolvido.
 *
 * SALVAR NÃO FECHA. Quem edita precisa ver a atividade que acabou de gerar
 * entrar na timeline; fechar esconderia o registro justamente de quem o
 * produziu, e a funcionalidade que prova "sua ação fica registrada" provaria
 * isso para todo mundo menos para o autor.
 */
export function LeadDossier({
  open,
  onOpenChange,
  lead,
  pipelineId,
  pipelineName,
  fieldDefs = [],
  stageName,
  ownerNames,
}: Props) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const campos = useRef<HTMLDivElement | null>(null);
  const timeline = useLeadTimeline(open ? lead.id : null, lead.contact_id);
  const { user, activeOrg } = useAuth();
  const owner = resolveLeadOwner(lead, ownerNames);
  const score = lead.score ?? null;
  const podeEditarFollowup = Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent && user.support?.access_mode !== "support_readonly");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
        // Observável pelo mesmo motivo do board: "a assinatura morreu" e "nada
        // aconteceu" têm a mesma aparência, que é silêncio.
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        // Observável como no board: "a entrega morreu" e "nada aconteceu"
        // têm a mesma aparência, e no dossiê a segunda é ainda mais crível —
        // negócio sem novidade é um estado normal.
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base leading-6">{t("Resumo do lead")}</SheetTitle>
          <p className="text-sm font-medium text-text">{lead.title}</p>
        </SheetHeader>

        {/* ① cabeçalho vivo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-3 text-xs">
          <span className="font-medium tabular-nums text-text">
            {formatBRL(lead.value_cents, lead.currency)}
          </span>
          <span className="text-text-muted">{stageName}</span>
          <OwnerBadge
            ownerKind={owner.kind}
            ownerName={owner.name}
            agentVersion={owner.agentVersion}
          />
          {score && (
            // O MESMO componente do card, não uma cópia do medidor.
            // "Superfície nova herda as decisões da antiga" só vale como
            // mecanismo: herdar por cópia é como as duas listas do evidence —
            // funciona hoje e diverge no mês em que alguém mudar um dos dois.
            // De brinde, o rótulo honesto da âncora ("registro que sustenta",
            // nunca "momento da conversa") vem junto, sem eu reescrever nada.
            <ScoreSlot
              probability={score.probability}
              band={score.band}
              reason={score.reason}
              factors={score.factors.slice(0, 3)}
            />
          )}

          <button
            type="button"
            onClick={() => campos.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="ml-auto text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            {t("Editar campos")}
          </button>
        </div>

        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-2 border-b border-border py-3 text-xs">
          {[
            [t("Origem"), lead.source || t("Não informado")],
            [t("Campanha"), campaignOf(lead) || t("Não informado")],
            [t("Interações"), String(timeline.total)],
            [
              t("Última anotação"),
              timeline.itens.find((item) => item.type === "note")?.reason || t("Não informado"),
            ],
            [t("Criado em"), stageAgeTooltip(lead.created_at) || t("Não informado")],
            [t("Na etapa desde"), stageAgeTooltip(lead.stage_entered_at) || t("Não informado")],
            [
              t("Último contato"),
              stageAgeTooltip(lead.conversa?.last_message_at ?? lead.last_activity_at) || t("Não informado"),
            ],
            [t("Previsão de fechamento"), stageAgeTooltip(lead.expected_close_date) || t("Não informado")],
            ...(lead.status === "lost"
              ? [[t("Motivo da perda"), lead.lost_reason || t("Não informado")]]
              : []),
            [t("Responsável"), owner.name || t("Não informado")],
          ].map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-muted">{label}</dt>
              <dd className="min-w-0 break-words text-right text-text">{value}</dd>
            </div>
          ))}
        </dl>

        <Button asChild className="my-3 min-h-11 w-full">
          <Link href={`/app/leads/${lead.id}`}>{t("Abrir lead")}</Link>
        </Button>

        {/* O score NÃO aparece na timeline: recálculo é telemetria e não emite
            atividade (silêncio para telemetria, pulso para mudança de estado).
            Sem esta linha, quem visse o número mudando no cabeçalho e nunca na
            timeline concluiria que a timeline está incompleta. */}
        {score?.at && (
          <p className="pt-2 text-[11px] text-text-muted">
            {t("Probabilidade recalculada automaticamente")} ·{" "}
            {new Date(score.at).toLocaleString(tagDoIdioma)}
          </p>
        )}

        <ConversaNoDossie conversa={lead.conversa} leadId={lead.id} />

        <section className="border-b border-border py-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            {t("Ficha completa")}
          </h3>
          <DadosCompletosDoLead
            lead={lead}
            pipelineName={pipelineName}
            stageName={stageName}
            fieldDefs={fieldDefs}
          />
        </section>

        <section className="border-b border-border py-3">
          <FollowupsDoLead leadId={lead.id} contactId={lead.contact_id} podeEditar={podeEditarFollowup} />
        </section>

        {/* ② timeline */}
        <section className="flex-1 py-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            {t("Linha do tempo")}
          </h3>
          <LeadTimeline
            itens={timeline.itens}
            chegouAoVivo={timeline.chegouAoVivo}
            isLoading={timeline.isLoading}
            isError={timeline.isError}
          />
        </section>

        {/* ③ campos, por último */}
        <div ref={campos} className="border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            {t("Dados do negócio")}
          </h3>
          <LeadFieldsForm lead={lead} pipelineId={pipelineId} fieldDefs={fieldDefs} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
