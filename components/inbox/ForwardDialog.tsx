"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useContactList } from "@/hooks/contacts/useContactList";
import { useT } from "@/hooks/i18n/useT";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { randomId } from "@/lib/random-id";
import { MagnifyingGlass, UserCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/types/contacts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageIds: string[];
  channelSessionId: string;
  excludeContactId?: string | null;
  onComplete?: () => void;
}

type ResultadoVisual = { contactId: string; status: "sent" | "failed"; reason?: string };

function motivoLegivel(reason: string | undefined, t: (texto: string) => string): string {
  const motivos: Record<string, string> = {
    message_revoked: "Mensagem apagada não pode ser encaminhada.",
    internal_note: "Nota interna não pode ser encaminhada.",
    system_event: "Evento de sistema não pode ser encaminhado.",
    message_failed: "Mensagem com falha não pode ser encaminhada.",
    unsupported_type: "Este tipo de mensagem não pode ser encaminhado.",
    empty_message: "Mensagem sem conteúdo não pode ser encaminhada.",
    media_unavailable: "O arquivo de mídia não está disponível.",
    media_copy_failed: "Não foi possível copiar o arquivo de mídia.",
    idempotency_lookup_failed: "Não foi possível conferir se a mensagem já havia sido encaminhada.",
    send_failed: "Falha ao encaminhar.",
  };
  return t(motivos[reason ?? ""] ?? reason ?? "Falha ao encaminhar.");
}

export function ForwardDialog({
  open,
  onOpenChange,
  messageIds,
  channelSessionId,
  excludeContactId,
  onComplete,
}: Props) {
  const t = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<Map<string, Contact>>(new Map());
  const [sending, setSending] = useState(false);
  const [limitWarning, setLimitWarning] = useState(false);
  const [results, setResults] = useState<ResultadoVisual[]>([]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebounced("");
      setSelected(new Map());
      setResults([]);
      setLimitWarning(false);
      return;
    }
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [open, search]);

  const list = useContactList({ search: debounced || undefined });
  const contacts = useMemo(
    () =>
      (list.data?.pages.flatMap((page) => page.data) ?? []).filter(
        (contact) =>
          contact.id !== excludeContactId && !contact.is_anonymized && Boolean(contact.phone_number),
      ),
    [excludeContactId, list.data],
  );

  function toggle(contact: Contact) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(contact.id)) {
        next.delete(contact.id);
        setLimitWarning(false);
      } else if (next.size >= 5) {
        setLimitWarning(true);
      } else {
        next.set(contact.id, contact);
        setLimitWarning(false);
      }
      return next;
    });
  }

  async function openConversation(contact: Contact): Promise<string> {
    const response = await fetch("/api/v1/conversations/open-with-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_session_id: channelSessionId,
        contact_id: contact.id,
        phone_number: contact.phone_number ?? undefined,
        name: rotuloDoContato(contact, t),
      }),
    });
    const json = (await response.json()) as {
      data?: { conversation_id: string };
      error?: { message?: string };
    };
    if (!response.ok || !json.data?.conversation_id) {
      throw new Error(json.error?.message ?? t("Não foi possível abrir a conversa."));
    }
    return json.data.conversation_id;
  }

  async function send() {
    if (selected.size === 0 || sending) return;
    const requestId = randomId();
    setSending(true);
    setResults([]);
    const escolhidos = [...selected.values()];
    const abertos = await Promise.all(
      escolhidos.map(async (contact) => {
        try {
          return { contact, conversationId: await openConversation(contact) };
        } catch (error) {
          return {
            contact,
            error: error instanceof Error ? error.message : t("Não foi possível abrir a conversa."),
          };
        }
      }),
    );

    const falhasAbertura: ResultadoVisual[] = abertos
      .filter((item) => "error" in item)
      .map((item) => ({ contactId: item.contact.id, status: "failed", reason: item.error }));
    const validos = abertos.filter(
      (item): item is { contact: Contact; conversationId: string } => "conversationId" in item,
    );

    let enviados: ResultadoVisual[] = [];
    if (validos.length > 0) {
      try {
        const response = await fetch("/api/v1/messages/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_ids: messageIds,
            destination_conversation_ids: validos.map((item) => item.conversationId),
            request_id: requestId,
          }),
        });
        const json = (await response.json()) as {
          data?: {
            destinations: Array<{
              conversation_id: string;
              status: "sent" | "partial" | "failed";
              reason?: string;
              messages: Array<{ status: "sent" | "skipped" | "failed"; reason?: string }>;
            }>;
          };
          error?: { message?: string };
        };
        if (!response.ok || !json.data) {
          throw new Error(json.error?.message ?? t("Não foi possível encaminhar."));
        }
        const porConversa = new Map(json.data.destinations.map((item) => [item.conversation_id, item]));
        enviados = validos.map((item) => {
          const destino = porConversa.get(item.conversationId);
          const primeiraFalha = destino?.messages.find((message) => message.status !== "sent");
          return destino?.status === "sent"
            ? { contactId: item.contact.id, status: "sent" as const }
            : {
                contactId: item.contact.id,
                status: "failed" as const,
                reason: destino?.reason ?? primeiraFalha?.reason ?? t("Falha ao encaminhar."),
              };
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["conversations"] }),
          queryClient.invalidateQueries({ queryKey: ["messages"] }),
        ]);
        onComplete?.();
      } catch (error) {
        enviados = validos.map((item) => ({
          contactId: item.contact.id,
          status: "failed",
          reason: error instanceof Error ? error.message : t("Não foi possível encaminhar."),
        }));
      }
    }
    setResults([...falhasAbertura, ...enviados]);
    setSending(false);
  }

  const resultByContact = new Map(results.map((result) => [result.contactId, result]));

  return (
    <Dialog open={open} onOpenChange={(value) => !sending && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Encaminhar para")}</DialogTitle>
          <DialogDescription>
            {t("Escolha até 5 contatos. Cada destino recebe as mensagens na ordem da conversa.")}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Buscar por nome ou telefone…")}
            className="pl-8"
            autoFocus
            disabled={sending}
          />
        </div>
        {limitWarning && (
          <p className="text-sm text-destructive" role="alert">
            {t("Você pode escolher até 5 destinos.")}
          </p>
        )}
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {list.isLoading && contacts.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("Carregando…")}</p>
          ) : contacts.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("Nenhum contato encontrado na base.")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {contacts.map((contact) => {
                const chosen = selected.has(contact.id);
                const result = resultByContact.get(contact.id);
                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted",
                        chosen && "bg-muted",
                      )}
                      onClick={() => toggle(contact)}
                      disabled={sending || results.length > 0}
                      aria-pressed={chosen}
                    >
                      <input type="checkbox" checked={chosen} readOnly tabIndex={-1} aria-hidden />
                      <UserCircle size={24} weight="duotone" className="shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{rotuloDoContato(contact, t)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {phoneForDisplay(contact.phone_number!)}
                        </span>
                      </span>
                      {result && (
                        <span className={cn("text-xs", result.status === "sent" ? "text-emerald-600" : "text-destructive")}>
                          {result.status === "sent" ? t("Enviado") : motivoLegivel(result.reason, t)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {list.hasNextPage && results.length === 0 && (
          <Button variant="ghost" size="sm" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? t("Carregando…") : t("Carregar mais")}
          </Button>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            {results.length > 0 ? t("Fechar") : t("Cancelar")}
          </Button>
          {results.length === 0 && (
            <Button onClick={send} disabled={selected.size === 0 || sending}>
              {sending ? t("Encaminhando…") : `${t("Encaminhar")} (${selected.size})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
