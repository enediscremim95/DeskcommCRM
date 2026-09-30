"use client";

import { useT } from "@/hooks/i18n/useT";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { MessageTemplate } from "@/hooks/inbox/useMessageTemplates";

const TEMPLATES_KEY = ["message-templates"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canShare: boolean;
  template?: MessageTemplate | null;
}

interface CreateInput {
  title: string;
  body: string;
  shortcut?: string;
  shared?: boolean;
}

interface UpdateInput {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
}

async function enviarAudio(templateId: string, file: File): Promise<void> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`/api/v1/message-templates/${templateId}/audio`, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? "Erro ao enviar o áudio.");
  }
}

export function TemplateFormDialog({ open, onOpenChange, canShare, template }: Props) {
  const t = useT();
  const isEdit = !!template;
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [shortcut, setShortcut] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [audio, setAudio] = React.useState<File | null>(null);
  const [removeAudio, setRemoveAudio] = React.useState(false);
  const audioPreview = React.useMemo(() => (audio ? URL.createObjectURL(audio) : null), [audio]);

  React.useEffect(() => {
    return () => {
      if (audioPreview) URL.revokeObjectURL(audioPreview);
    };
  }, [audioPreview]);

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: CreateInput) =>
      apiClient.post<{ data: MessageTemplate }>("/api/v1/message-templates", input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...input }: UpdateInput) =>
      apiClient.patch<{ data: MessageTemplate }>(`/api/v1/message-templates/${id}`, input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
  const pending = create.isPending || update.isPending;

  React.useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? "");
    setBody(template?.body ?? "");
    setShortcut(template?.shortcut ?? "");
    setShared(template ? template.owner_user_id === null : false);
    setAudio(null);
    setRemoveAudio(false);
  }, [open, template]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let conteudoFoiSalvo = false;
    try {
      if (isEdit) {
        const saved = await update.mutateAsync({
          id: template.id,
          title,
          body,
          shortcut: shortcut.trim() || null,
        });
        conteudoFoiSalvo = true;
        if (removeAudio && template.audio_storage_path) {
          const response = await fetch(`/api/v1/message-templates/${template.id}/audio`, {
            method: "DELETE",
            credentials: "same-origin",
          });
          if (!response.ok) throw new Error(t("Erro ao remover o áudio."));
        }
        if (audio) await enviarAudio(saved.data.id, audio);
        toast.success(t("Template atualizado."));
      } else {
        const saved = await create.mutateAsync({
          title,
          body,
          shortcut: shortcut.trim() || undefined,
          shared: canShare ? shared : false,
        });
        conteudoFoiSalvo = true;
        if (audio) await enviarAudio(saved.data.id, audio);
        toast.success(t("Template criado."));
      }
      onOpenChange(false);
    } catch (error) {
      if (conteudoFoiSalvo) {
        toast.error(
          error instanceof Error ? error.message : t("O texto foi salvo, mas o áudio não."),
        );
        await qc.invalidateQueries({ queryKey: TEMPLATES_KEY });
        onOpenChange(false);
      }
      /* Falhas da primeira mutação já são mostradas pelo showApiError. */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("Editar template") : t("Novo template")}</DialogTitle>
          <DialogDescription>
            {t("Scripts salvos para responder mais rápido no atendimento.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-title">{t("Título")}</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Saudação inicial")}
              minLength={1}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-body">{t("Mensagem")}</Label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("Oi {{primeiro_nome}}, tudo bem?")}
              minLength={1}
              maxLength={4096}
              required
              rows={5}
            />
            <p className="text-xs text-muted-foreground">
              {t("Use")} {"{{primeiro_nome}}"} {t("e")} {"{{nome}}"} {t("para personalizar.")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-shortcut">{t("Atalho (opcional)")}</Label>
            <Input
              id="tpl-shortcut"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="oi"
              maxLength={40}
            />
          </div>
          {canShare && (
            <div className="flex items-center gap-2">
              <Switch
                id="tpl-shared"
                checked={shared}
                onCheckedChange={setShared}
                disabled={isEdit}
              />
              <Label htmlFor="tpl-shared">{t("Compartilhar com a equipe")}</Label>
            </div>
          )}
          {canShare && (shared || (isEdit && template.owner_user_id === null)) ? (
            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="tpl-audio">{t("Áudio da equipe (opcional)")}</Label>
              <Input
                id="tpl-audio"
                type="file"
                accept="audio/*"
                onChange={(event) => {
                  setAudio(event.target.files?.[0] ?? null);
                  setRemoveAudio(false);
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t("O servidor converte para OGG/Opus para chegar como mensagem de voz.")}
              </p>
              {audioPreview ? (
                <audio controls className="h-9 max-w-full" src={audioPreview} />
              ) : null}
              {!audioPreview && template?.audio_storage_path && !removeAudio ? (
                <div className="space-y-2">
                  <audio
                    controls
                    className="h-9 max-w-full"
                    src={`/api/v1/message-templates/${template.id}/audio`}
                  />
                  <Button type="button" variant="ghost" onClick={() => setRemoveAudio(true)}>
                    {t("Remover áudio")}
                  </Button>
                </div>
              ) : null}
              {removeAudio ? (
                <p className="text-xs text-muted-foreground">
                  {t("O áudio será removido ao salvar.")}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={pending}>
              {isEdit ? t("Salvar") : t("Criar template")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
