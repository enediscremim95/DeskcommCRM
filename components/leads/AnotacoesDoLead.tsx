"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useLeadNotes } from "@/hooks/leads/useLeadNotes";
import { Trash } from "@/lib/ui/icons";
import type { TimelineItemView } from "@/lib/types/contacts";

interface Props {
  leadId: string;
  currentUserId: string;
  canManage: boolean;
}

function textoDaAnotacao(note: TimelineItemView): string {
  const text = note.payload?.text;
  return typeof text === "string" ? text : "";
}

export function AnotacoesDoLead({ leadId, currentUserId, canManage }: Props) {
  const t = useT();
  const locale = useTagDeIdioma();
  const notes = useLeadNotes(leadId);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState<TimelineItemView | null>(null);
  const value = text.trim();

  const create = async () => {
    if (value.length === 0 || value.length > 2000 || notes.createNote.isPending) return;
    try {
      await notes.createNote.mutateAsync(value);
      setText("");
    } catch {
      // O hook já apresenta o erro padronizado da API.
    }
  };

  const confirmDelete = async () => {
    if (!deleting || notes.deleteNote.isPending) return;
    try {
      await notes.deleteNote.mutateAsync(deleting.id);
      setDeleting(null);
    } catch {
      // Mantém a confirmação aberta para a pessoa tentar novamente.
    }
  };

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(date));

  return (
    <section className="rounded-lg border border-border bg-surface p-3" data-testid="lead-notes">
      <h2 className="text-[11px] font-semibold tracking-[0.08em] text-text-muted uppercase">
        {t("Anotações")}
      </h2>

      <form
        className="mt-3 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Textarea
          aria-label={t("Nova anotação")}
          placeholder={t("Escreva uma anotação sobre este negócio")}
          value={text}
          maxLength={2000}
          rows={3}
          className="resize-y"
          disabled={notes.createNote.isPending}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-right text-[11px] text-text-muted tabular-nums sm:text-left">
            {text.length}/2000
          </span>
          <Button
            type="submit"
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={value.length === 0 || notes.createNote.isPending}
          >
            {notes.createNote.isPending ? t("Criando…") : t("Criar anotação")}
          </Button>
        </div>
      </form>

      {notes.isLoading ? (
        <p className="mt-3 text-xs text-text-muted">{t("Carregando…")}</p>
      ) : notes.isError ? (
        <div className="mt-3 space-y-2">
          <p role="alert" className="text-xs text-error-fg">
            {t("Não foi possível carregar as anotações.")}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void notes.refetch()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : notes.notes.length === 0 ? (
        <p className="mt-3 text-xs text-text-muted">{t("Nenhuma anotação ainda")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.notes.map((note) => {
            const author = note.actor_user_name?.trim() || t("Autor não identificado");
            const canDelete = canManage || note.performed_by_user_id === currentUserId;
            return (
              <li
                key={note.id}
                className="rounded-md border border-border bg-surface-elevated/50 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-text">{author}</p>
                    <time
                      className="mt-0.5 block text-[11px] text-text-muted tabular-nums"
                      dateTime={note.performed_at}
                    >
                      {formatDate(note.performed_at)}
                    </time>
                  </div>
                  {canDelete ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-11 w-11 shrink-0 text-text-muted hover:text-destructive sm:h-8 sm:w-8"
                      aria-label={t("Apagar anotação")}
                      onClick={() => setDeleting(note)}
                    >
                      <Trash size={15} aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <p className="mt-2 text-sm break-words whitespace-pre-wrap text-text">
                  {textoDaAnotacao(note)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Apagar esta anotação?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("O texto será removido do histórico do negócio e não poderá ser recuperado.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={notes.deleteNote.isPending}>
              {t("Cancelar")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={notes.deleteNote.isPending}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {notes.deleteNote.isPending ? t("Apagando…") : t("Apagar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
