"use client";

import Link from "next/link";
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
import { useAuth } from "@/hooks/auth/AuthProvider";
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
import { ChatCircle, Gear, Phone } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { DadosCompletosDoLead } from "./DadosCompletosDoLead";
import { FollowupsDoLead } from "./FollowupsDoLead";

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

function valorDoNegocio(centavos: number | null, moeda: string | null, locale: string): string | null {
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

/**
 * A barra de progresso do funil, no cabeçalho do lead (formato Kommo): um
 * segmento por etapa, preenchidos até a etapa atual, na cor de cada etapa.
 *
 * As etapas vêm de `usePipelineStages`, o mesmo hook que o editor de webhooks
 * já usa — nenhuma consulta nova no servidor. Enquanto não chegam, a barra
 * não aparece: um esqueleto aqui prometeria um dado que pode nunca vir (funil
 * sem etapas), e o cabeçalho continua inteiro sem ela.
 */
function ProgressoDoFunil({
  pipelineId,
  stageId,
  status,
}: {
  pipelineId: string;
  stageId: string;
  status: Lead["status"];
}) {
  const t = useT();
  const { data } = usePipelineStages(pipelineId);
  const etapas = useMemo(
    () => [...(data?.data?.stages ?? [])].sort((a, b) => a.position - b.position),
    [data],
  );
  if (etapas.length === 0) return null;

  const atual = etapas.findIndex((s) => s.id === stageId);
  // Negócio ganho preenche o funil inteiro; perdido para onde parou.
  const preenchidas = status === "won" ? etapas.length - 1 : atual;

  return (
    <div className="mt-3" data-testid="lead-progresso-funil">
      <ol
        className="flex gap-1"
        aria-label={`${t("Etapa")} ${Math.max(atual, 0) + 1} ${t("de")} ${etapas.length}`}
      >
        {etapas.map((etapa, i) => {
          const feita = i <= preenchidas;
          return (
            <li
              key={etapa.id}
              title={etapa.name}
              className={cn(
                "h-1.5 min-w-0 flex-1 rounded-full transition-colors",
                !feita && "bg-border",
                feita && status === "lost" && "bg-error/60",
              )}
              style={
                feita && status !== "lost"
                  ? { backgroundColor: etapa.color ?? "var(--color-accent)" }
                  : undefined
              }
            />
          );
        })}
      </ol>
      <p className="mt-1.5 text-[11px] text-text-muted tabular-nums">
        {t("Etapa")} {Math.max(atual, 0) + 1} {t("de")} {etapas.length}
      </p>
    </div>
  );
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
  const supportReadonly = user.support?.access_mode === "support_readonly";
  const podeEditar = Boolean(
    activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent && !supportReadonly,
  );
  const podeConfigurar = activeOrg?.role === "admin" && !supportReadonly;
  const timeline = useLeadTimeline(lead.id, lead.contact_id);
  const conversation = useConversation(conversationId, Boolean(conversationId));
  const selectedConversation = conversation.data ?? null;
  const [respondendo, setRespondendo] = useState<Message | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);
  const [agoraJanela, setAgoraJanela] = useState(() => new Date());

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

  const valor = valorDoNegocio(lead.value_cents, lead.currency, locale);
  const nome = nomeDoContato(contact);

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
            <h1 className="mt-1 text-lg leading-tight font-semibold text-text">{lead.title}</h1>

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
                  lead.status === "lost"
                    ? "destructive"
                    : lead.status === "won"
                      ? "success"
                      : "default"
                }
              >
                {lead.status === "won"
                  ? t("Ganho")
                  : lead.status === "lost"
                    ? t("Perdido")
                    : stageName}
              </Badge>
            </div>

            <ProgressoDoFunil
              pipelineId={lead.pipeline_id}
              stageId={lead.stage_id}
              status={lead.status}
            />

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
                      href={`tel:${contact.phone_number}`}
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
              lead={lead}
              pipelineName={pipelineName}
              stageName={stageName}
              fieldDefs={fieldDefs}
            />
            <FollowupsDoLead leadId={lead.id} contactId={lead.contact_id} podeEditar={podeEditar} />
            {podeEditar ? (
              <section className="border-t border-border pt-4">
                <h2 className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
                  {t("Dados do negócio")}
                </h2>
                <LeadFieldsForm lead={lead} pipelineId={lead.pipeline_id} fieldDefs={fieldDefs} />
              </section>
            ) : null}
          </div>
        </aside>

        {/* ── Direita: a linha do tempo com a conversa ────────────────────── */}
        <section className="flex min-h-[42rem] min-w-0 flex-col bg-surface lg:min-h-0">
          {conversation.isPending ? (
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
    </OpenConversationProvider>
  );
}
