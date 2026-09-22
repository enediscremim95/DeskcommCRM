"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChatThread, type ThreadContextItem } from "@/components/inbox/ChatThread";
import { Composer, type ComposerHandle } from "@/components/inbox/Composer";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { JanelaFechadaAviso } from "@/components/inbox/JanelaFechadaAviso";
import { RetentionNotice } from "@/components/inbox/RetentionNotice";
import { LeadFieldsForm } from "@/components/kanban/LeadFieldsForm";
import { ownerInitials } from "@/components/kanban/OwnerBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useAuth, usePermission } from "@/hooks/auth/AuthProvider";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useConversation, isNotFound } from "@/hooks/inbox/useConversation";
import { useMarkAsRead } from "@/hooks/inbox/useMarkAsRead";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import { OpenConversationProvider } from "@/hooks/notifications/OpenConversationContext";
import { useT } from "@/hooks/i18n/useT";
import { usePipelineStages } from "@/hooks/webhooks/useWebhookSources";
import { estadoDaJanela, formatarDecorrido } from "@/lib/channels/janela";
import { ROLE_RANK } from "@/lib/auth/types";
import { activityLabel, actorName } from "@/lib/leads/activity-vocabulary";
import type { CustomFieldDef } from "@/lib/schemas/settings";
import type { Lead } from "@/lib/types/leads";
import type { Message } from "@/lib/types/messaging";
import type { Stage } from "@/lib/kanban/types";
import { apiClient } from "@/lib/api/client";
import { ChatCircle, Gear, Phone, Trash } from "@/lib/ui/icons";
import { DadosCompletosDoLead } from "./DadosCompletosDoLead";
import { FollowupsDoLead } from "./FollowupsDoLead";
import { DeleteLeadDialog } from "./DeleteLeadDialog";
import { StageSelector } from "./StageSelector";
import { LoseLeadDialog } from "@/components/kanban/LoseLeadDialog";

interface ContactSummary {
  id: string;
  display_name: string | null;
  name: string | null;
  phone_number: string | null;
  email: string | null;
}

interface Props {
  lead: Lead;
  pipelineName: string;
  stageName: string;
  fieldDefs: CustomFieldDef[];
  contact: ContactSummary | null;
  conversationId: string | null;
  hasConnectedChannel: boolean;
  canReplyInConversation: boolean;
}

function nomeDoContato(contact: ContactSummary | null): string {
  return contact?.display_name?.trim() || contact?.name?.trim() || "Contato sem nome";
}

function valorDoNegocio(
  centavos: number | null,
  moeda: string | null,
  locale: string,
): string | null {
  if (centavos === null) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: moeda || "BRL",
      maximumFractionDigits: 0,
    }).format(centavos / 100);
  } catch {
    return `${(centavos / 100).toFixed(2)} ${moeda || "BRL"}`;
  }
}

export function LeadPageClient({
  lead,
  pipelineName,
  stageName,
  fieldDefs,
  contact,
  conversationId,
  hasConnectedChannel,
  canReplyInConversation,
}: Props) {
  const t = useT();
  const locale = useTagDeIdioma();
  const { activeOrg, user } = useAuth();
  const router = useRouter();
  const [leadAtual, setLeadAtual] = useState(lead);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loseOpen, setLoseOpen] = useState(false);
  const [etapaPerdida, setEtapaPerdida] = useState<Stage | null>(null);
  const [movendoEtapa, setMovendoEtapa] = useState(false);
  const rollbackPerda = useRef<Lead | null>(null);
  const supportReadonly = user.support?.access_mode === "support_readonly";
  const podeEditar = Boolean(
    activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent && !supportReadonly,
  );
  const podeConfigurar = activeOrg?.role === "admin" && !supportReadonly;
  const podeExcluir = usePermission("resource.delete") && !supportReadonly;
  const timeline = useLeadTimeline(lead.id, lead.contact_id);
  const conversation = useConversation(conversationId, Boolean(conversationId));
  const selectedConversation = conversation.data ?? null;
  const [respondendo, setRespondendo] = useState<Message | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);
  const [agoraJanela, setAgoraJanela] = useState(() => new Date());
  const stagesQuery = usePipelineStages(leadAtual.pipeline_id);
  const etapas = useMemo(
    () => [...(stagesQuery.data?.data?.stages ?? [])].sort((a, b) => a.position - b.position),
    [stagesQuery.data],
  );

  useMarkAsRead(
    selectedConversation?.id ?? null,
    selectedConversation?.unread_count_for_assignee ?? 0,
  );

  useEffect(() => {
    const timer = setInterval(() => setAgoraJanela(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const contextItems = useMemo<ThreadContextItem[]>(
    () =>
      timeline.itens.map((item) => ({
        id: item.id,
        ts: item.performed_at,
        label: t(activityLabel(item.type)),
        detail: [
          actorName(
            item.actor_kind ?? null,
            {
              agente: item.actor_agent_name ?? null,
              usuario: item.actor_user_name ?? null,
            },
            t,
          ),
          item.reason ? t(item.reason) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [timeline.itens, t],
  );

  const janela = estadoDaJanela(
    selectedConversation?.channel_sessions?.provider ?? null,
    selectedConversation?.last_inbound_at ?? null,
    agoraJanela,
  );
  const motivoDaJanela =
    janela.tipo === "fechada"
      ? janela.fechadaHaMs === null
        ? t(
            "O cliente ainda não escreveu — a janela de 24h nunca abriu. Só um modelo aprovado sai daqui.",
          )
        : `${t("A janela de 24h fechou há")} ${formatarDecorrido(janela.fechadaHaMs)}. ${t("Só um modelo aprovado sai daqui — texto livre é recusado pela plataforma.")}`
      : null;
  const blockedReason = selectedConversation?.contacts?.is_blocked
    ? t("Contato bloqueado — envio de mensagens desabilitado.")
    : selectedConversation?.contacts?.is_anonymized
      ? t("Contato anonimizado — não é possível enviar mensagens.")
      : !canReplyInConversation
        ? t("WhatsApp não conectado — envio de mensagens desabilitado.")
        : null;

  const conversaInacessivel =
    conversationId &&
    !conversation.isPending &&
    !selectedConversation &&
    isNotFound(conversation.error);

  const valor = valorDoNegocio(leadAtual.value_cents, leadAtual.currency, locale);
  const nome = nomeDoContato(contact);
  const stageAtual = etapas.find((stage) => stage.id === leadAtual.stage_id);
  const nomeDaEtapa = stageAtual?.name ?? stageName;
  const diasNaEtapa = Math.max(
    0,
    Math.floor(
      (agoraJanela.getTime() -
        new Date(leadAtual.stage_entered_at ?? leadAtual.created_at).getTime()) /
        86_400_000,
    ),
  );

  const moverParaEtapa = async (stage: Stage) => {
    if (!podeEditar || movendoEtapa || stage.id === leadAtual.stage_id) return;
    if (stage.is_lost) {
      setEtapaPerdida(stage);
      setLoseOpen(true);
      return;
    }

    const anterior = leadAtual;
    setMovendoEtapa(true);
    setLeadAtual({
      ...leadAtual,
      stage_id: stage.id,
      status: stage.is_won ? "won" : "open",
      stage_entered_at: new Date().toISOString(),
    });

    try {
      const result = stage.is_won
        ? await apiClient.post<{ data: Lead }>(`/api/v1/leads/${leadAtual.id}/win`, {})
        : await apiClient.post<{ data: Lead }>(`/api/v1/leads/${leadAtual.id}/move`, {
            stage_id: stage.id,
            expected_updated_at: anterior.updated_at,
          });
      setLeadAtual(result.data);
      router.refresh();
    } catch (error) {
      setLeadAtual(anterior);
      showApiError(error);
    } finally {
      setMovendoEtapa(false);
    }
  };

  return (
    <OpenConversationProvider conversationId={conversationId}>
      <div
        className="grid min-h-[calc(100dvh-8.5rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xs lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]"
        data-testid="lead-page-workspace"
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        {/* ── Esquerda: o negócio, a etapa e a pessoa ─────────────────────── */}
        <aside className="min-w-0 overflow-y-auto border-b border-border bg-surface-elevated/40 lg:border-r lg:border-b-0">
          <header className="border-b border-border bg-surface px-4 pt-4 pb-4">
            <p className="truncate text-[11px] font-medium tracking-[0.08em] text-text-muted uppercase">
              {pipelineName}
            </p>
            <div className="mt-1 flex items-start justify-between gap-3">
              <h1 className="min-w-0 text-lg leading-tight font-semibold text-text">
                {leadAtual.title}
              </h1>
              {podeExcluir ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash size={15} aria-hidden />
                  {t("Excluir")}
                </Button>
              ) : null}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {valor ? (
                <span className="text-xl leading-none font-semibold text-text tabular-nums">
                  {valor}
                </span>
              ) : (
                <span className="text-sm text-text-subtle">{t("Sem valor")}</span>
              )}
              <Badge
                variant={
                  leadAtual.status === "lost"
                    ? "destructive"
                    : leadAtual.status === "won"
                      ? "success"
                      : "default"
                }
              >
                {leadAtual.status === "won"
                  ? t("Ganho")
                  : leadAtual.status === "lost"
                    ? t("Perdido")
                    : nomeDaEtapa}
              </Badge>
            </div>

            <StageSelector
              stages={etapas}
              stageId={leadAtual.stage_id}
              canEdit={podeEditar}
              isPending={movendoEtapa}
              onSelect={moverParaEtapa}
            />
            <p className="mt-1.5 text-[11px] text-text-muted tabular-nums">
              {diasNaEtapa === 1
                ? `${t("há")} 1 ${t("dia nesta etapa")}`
                : `${t("há")} ${diasNaEtapa} ${t("dias nesta etapa")}`}
            </p>

            {/* A pessoa do outro lado: avatar com iniciais, nome, e os dois
                jeitos de falar com ela fora do WhatsApp. */}
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-surface-elevated/60 p-3">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
              >
                {ownerInitials(nome)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{nome}</p>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted">
                  {contact?.phone_number ? (
                    <a
                      className="inline-flex min-w-0 items-center gap-1 hover:text-text hover:underline"
                      href={`https://wa.me/${contact.phone_number.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("Abrir no WhatsApp")}
                    >
                      <Phone size={12} aria-hidden />
                      <span className="truncate tabular-nums">{contact.phone_number}</span>
                    </a>
                  ) : null}
                  {contact?.email ? (
                    <a
                      className="min-w-0 truncate hover:text-text hover:underline"
                      href={`mailto:${contact.email}`}
                    >
                      {contact.email}
                    </a>
                  ) : null}
                </div>
              </div>
              {contact?.id ? (
                <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs">
                  <Link href={`/app/contacts/${contact.id}`}>{t("Ver contato")}</Link>
                </Button>
              ) : null}
            </div>
          </header>

          <div className="space-y-6 p-4">
            <DadosCompletosDoLead
              lead={leadAtual}
              pipelineName={pipelineName}
              stageName={nomeDaEtapa}
              fieldDefs={fieldDefs}
            />
            <FollowupsDoLead
              leadId={leadAtual.id}
              contactId={leadAtual.contact_id}
              podeEditar={podeEditar}
            />
            {podeEditar ? (
              <section className="border-t border-border pt-4">
                <h2 className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
                  {t("Dados do negócio")}
                </h2>
                <LeadFieldsForm
                  lead={leadAtual}
                  pipelineId={leadAtual.pipeline_id}
                  fieldDefs={fieldDefs}
                />
              </section>
            ) : null}
          </div>
        </aside>

        {/* ── Direita: a linha do tempo com a conversa ────────────────────── */}
        <section className="flex min-h-[42rem] min-w-0 flex-col bg-surface lg:min-h-0">
          {conversation.isLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
              {t("Carregando conversa…")}
            </div>
          ) : selectedConversation ? (
            <>
              <ConversationHeader conversation={selectedConversation} />
              {!canReplyInConversation ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning-bg px-4 py-2 text-xs text-warning-fg">
                  <span>
                    {t(
                      "WhatsApp não conectado. O histórico continua disponível, mas o envio está bloqueado.",
                    )}
                  </span>
                  {podeConfigurar ? (
                    <Link
                      className="font-medium underline underline-offset-2"
                      href="/app/connections"
                    >
                      {t("Conectar WhatsApp")}
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {timeline.isError ? (
                <p
                  role="alert"
                  className="border-b border-border px-4 py-2 text-xs text-warning-fg"
                >
                  {t(
                    "Não foi possível carregar os acontecimentos do negócio. As mensagens continuam disponíveis.",
                  )}
                </p>
              ) : null}
              <div className="min-h-0 flex-1 overflow-hidden bg-surface-elevated/40">
                <ChatThread
                  conversationId={selectedConversation.id}
                  onResponder={setRespondendo}
                  contextItems={contextItems}
                />
              </div>
              <RetentionNotice conversationId={selectedConversation.id} />
              {motivoDaJanela ? (
                <JanelaFechadaAviso
                  conversationId={selectedConversation.id}
                  provider={selectedConversation.channel_sessions?.provider ?? null}
                  motivo={motivoDaJanela}
                />
              ) : null}
              <Composer
                ref={composerRef}
                conversationId={selectedConversation.id}
                blockedReason={
                  supportReadonly ? t("Acompanhamento somente leitura") : blockedReason
                }
                janelaFechada={motivoDaJanela}
                disabled={selectedConversation.status === "closed"}
                contactName={selectedConversation.contacts?.name ?? nome}
                respondendo={respondendo}
                onCancelarResposta={() => setRespondendo(null)}
                currentContactId={selectedConversation.contact_id}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-surface-elevated/40 px-6 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface shadow-xs ring-1 ring-border">
                <ChatCircle size={28} weight="regular" className="text-text-muted" aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-semibold text-text">
                  {conversaInacessivel
                    ? t("Conversa não encontrada ou fora do seu acesso")
                    : hasConnectedChannel
                      ? t("Este lead ainda não tem conversa no WhatsApp")
                      : t("WhatsApp não conectado")}
                </h2>
                <p className="mt-1 max-w-md text-sm text-text-muted">
                  {hasConnectedChannel
                    ? t(
                        "Quando este contato conversar pelo canal conectado, as mensagens aparecerão aqui.",
                      )
                    : t("Conecte um número para receber e responder mensagens dentro do lead.")}
                </p>
              </div>
              {!hasConnectedChannel && podeConfigurar ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/app/connections">
                    <Gear size={16} aria-hidden />
                    {t("Conectar WhatsApp")}
                  </Link>
                </Button>
              ) : null}
            </div>
          )}
        </section>
      </div>
      <DeleteLeadDialog
        open={podeExcluir && deleteOpen}
        onOpenChange={setDeleteOpen}
        pipelineId={leadAtual.pipeline_id}
        leadIds={[leadAtual.id]}
        leadTitle={leadAtual.title}
        onDeleted={() => router.replace(`/app/pipelines/${leadAtual.pipeline_id}`)}
      />
      <LoseLeadDialog
        open={podeEditar && loseOpen}
        onOpenChange={setLoseOpen}
        leadId={leadAtual.id}
        pipelineId={leadAtual.pipeline_id}
        onBeforeSubmit={() => {
          if (!etapaPerdida) return;
          rollbackPerda.current = leadAtual;
          setLeadAtual({
            ...leadAtual,
            stage_id: etapaPerdida.id,
            status: "lost",
            stage_entered_at: new Date().toISOString(),
          });
        }}
        onLost={(updated) => {
          rollbackPerda.current = null;
          setLeadAtual(updated);
          setEtapaPerdida(null);
          router.refresh();
        }}
        onError={() => {
          if (rollbackPerda.current) setLeadAtual(rollbackPerda.current);
          rollbackPerda.current = null;
        }}
      />
    </OpenConversationProvider>
  );
}
