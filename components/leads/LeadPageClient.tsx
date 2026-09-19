"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChatThread, type ThreadContextItem } from "@/components/inbox/ChatThread";
import { Composer, type ComposerHandle } from "@/components/inbox/Composer";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { JanelaFechadaAviso } from "@/components/inbox/JanelaFechadaAviso";
import { RetentionNotice } from "@/components/inbox/RetentionNotice";
import { LeadFieldsForm } from "@/components/kanban/LeadFieldsForm";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useConversation, isNotFound } from "@/hooks/inbox/useConversation";
import { useMarkAsRead } from "@/hooks/inbox/useMarkAsRead";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import { OpenConversationProvider } from "@/hooks/notifications/OpenConversationContext";
import { useT } from "@/hooks/i18n/useT";
import { estadoDaJanela, formatarDecorrido } from "@/lib/channels/janela";
import { ROLE_RANK } from "@/lib/auth/types";
import { activityLabel, actorName } from "@/lib/leads/activity-vocabulary";
import type { CustomFieldDef } from "@/lib/schemas/settings";
import type { Lead } from "@/lib/types/leads";
import type { Message } from "@/lib/types/messaging";
import { ChatCircle, Gear, UserCircle } from "@/lib/ui/icons";
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

  return (
    <OpenConversationProvider conversationId={conversationId}>
      <div
        className="grid min-h-[calc(100dvh-8.5rem)] overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)]"
        data-testid="lead-page-workspace"
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        <aside className="bg-surface-muted/20 min-w-0 overflow-y-auto border-b border-border lg:border-r lg:border-b-0">
          <header className="border-b border-border p-4">
            <p className="text-[11px] font-medium tracking-wide text-text-muted uppercase">
              {pipelineName} · {stageName}
            </p>
            <h1 className="mt-1 text-lg font-semibold text-text">{lead.title}</h1>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface p-3">
              <UserCircle size={20} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-text">{nomeDoContato(contact)}</p>
                {contact?.phone_number ? (
                  <a
                    className="block text-text-muted hover:underline"
                    href={`tel:${contact.phone_number}`}
                  >
                    {contact.phone_number}
                  </a>
                ) : null}
                {contact?.email ? (
                  <a
                    className="block truncate text-text-muted hover:underline"
                    href={`mailto:${contact.email}`}
                  >
                    {contact.email}
                  </a>
                ) : null}
              </div>
            </div>
          </header>

          <div className="space-y-5 p-4">
            <DadosCompletosDoLead
              lead={lead}
              pipelineName={pipelineName}
              stageName={stageName}
              fieldDefs={fieldDefs}
            />
            <FollowupsDoLead leadId={lead.id} contactId={lead.contact_id} podeEditar={podeEditar} />
            {podeEditar ? (
              <section className="border-t border-border pt-4">
                <h2 className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">
                  {t("Dados do negócio")}
                </h2>
                <LeadFieldsForm lead={lead} pipelineId={lead.pipeline_id} fieldDefs={fieldDefs} />
              </section>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-[42rem] min-w-0 flex-col lg:min-h-0">
          {conversation.isPending ? (
            <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
              {t("Carregando conversa…")}
            </div>
          ) : selectedConversation ? (
            <>
              <ConversationHeader conversation={selectedConversation} />
              {!canReplyInConversation ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning-fg">
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
              <div className="min-h-0 flex-1 overflow-hidden">
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
                contactName={selectedConversation.contacts?.name ?? nomeDoContato(contact)}
                respondendo={respondendo}
                onCancelarResposta={() => setRespondendo(null)}
                currentContactId={selectedConversation.contact_id}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <ChatCircle size={40} weight="thin" className="text-text-muted" aria-hidden />
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
