"use client";
import Link from "next/link";
import type { MouseEvent } from "react";

import { useT } from "@/hooks/i18n/useT";
import { ChatCircle } from "@/lib/ui/icons";
import type { Lead } from "@/lib/types/leads";
import { cn } from "@/lib/utils";

/**
 * A última mensagem do negócio, com atalho para a tela do lead.
 *
 * ─── Por que atalho e não um composer aqui dentro ───────────────────────────
 *
 * Responder de dentro do quadro exigiria trazer o composer inteiro — anexos,
 * templates, notas internas, gravação de áudio — para uma segunda tela. Duas
 * cópias do mesmo campo divergem: a correção entra numa e não na outra, e o
 * atendente aprende que "no Kanban não funciona igual". O lead já é o lugar
 * onde se acompanha e conversa; o que faltava era chegar nele sem procurar.
 *
 * ─── O que a prévia resolve ─────────────────────────────────────────────────
 *
 * Sem ela o atalho é uma aposta: clicar para descobrir se vale a pena. Com a
 * última mensagem à vista, o vendedor decide olhando o quadro — que é para o
 * que o quadro serve.
 *
 * ─── Ausência é estado normal, não erro ─────────────────────────────────────
 *
 * Lead criado à mão ou por webhook não tem contato; contato pode não ter
 * conversa. Nesses casos o slot não aparece — e NÃO aparece um "sem mensagens"
 * cinza, que ocuparia a mesma linha em metade dos cards para não dizer nada.
 *
 * ─── Desenho (formato Kommo) ────────────────────────────────────────────────
 *
 * O canal é o ícone verde, como no Kommo; a palavra "WhatsApp" fica só para o
 * leitor de tela. A linha é a última do card e a mais discreta: quem lê o
 * quadro de relance quer o título e o valor, e só depois o que a pessoa disse.
 */
export function ConversaSlot({
  conversa,
  leadId,
}: {
  conversa: Lead["conversa"];
  leadId?: string;
}) {
  const t = useT();
  if (!conversa) return null;

  const preview = conversa.preview?.trim();
  const temNaoLidas = conversa.unread > 0;

  return (
    <Link
      href={leadId ? `/app/leads/${leadId}` : `/app/inbox?id=${conversa.id}`}
      // O card inteiro é arrastável e clicável (abre o lead). Sem parar a
      // propagação, o clique no atalho também abriria o lead por baixo, criando dois
      // destinos para um gesto.
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onPointerDown={(e: MouseEvent) => e.stopPropagation()}
      className={cn(
        "group/conversa mt-1.5 flex h-6 items-center gap-1.5 rounded-md border border-border/70 bg-surface-elevated/70 px-1.5 text-[11px]",
        "text-text-muted transition-colors hover:border-border-strong hover:bg-surface-elevated hover:text-text",
        temNaoLidas && "border-accent/30 bg-accent-soft/40",
      )}
      title={t("Abrir o lead e responder no WhatsApp")}
    >
      <ChatCircle size={13} weight="fill" className="shrink-0 text-success" aria-hidden />
      <span className="sr-only">{t("WhatsApp")}</span>
      <span className={cn("min-w-0 truncate", temNaoLidas && "font-medium text-text")}>
        {preview || <span className="italic">{t("conversa sem mensagens")}</span>}
      </span>
      {temNaoLidas && (
        // O número, não um ponto: "3 sem ler" e "12 sem ler" pedem urgências
        // diferentes, e um ponto colapsa as duas.
        <span
          className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-accent-foreground tabular-nums"
          aria-label={`${conversa.unread} ${t("sem ler")}`}
        >
          {conversa.unread}
        </span>
      )}
    </Link>
  );
}
