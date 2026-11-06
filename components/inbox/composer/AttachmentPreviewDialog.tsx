"use client";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FileText } from "@/lib/ui/icons";
import { formatBytes } from "@/components/inbox/media/media-utils";
import { LIMITE_LEGENDA_DE_MIDIA } from "@/lib/channels/limites-de-legenda";

interface Props {
  file: File | null;
  initialCaption?: string;
  sending: boolean;
  sequenceLabel?: string;
  onCancel: () => void;
  onSend: (caption: string) => void;
}

/** Preview antes do envio (padrão WhatsApp): thumb ou card + legenda. */
export function AttachmentPreviewDialog({
  file,
  initialCaption = "",
  sending,
  sequenceLabel,
  onCancel,
  onSend,
}: Props) {
  const t = useT();
  const [caption, setCaption] = useState("");
  useEffect(() => setCaption(initialCaption), [file, initialCaption]);

  const objectUrl = useMemo(
    () => (file && /^(image|video|audio)\//.test(file.type) ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  if (!file) return null;
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  const isAudio = file.type.startsWith("audio/");
  const excedeLimite = caption.length > LIMITE_LEGENDA_DE_MIDIA;

  function enviar(): void {
    if (sending || excedeLimite) return;
    onSend(caption.trim());
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Enviar anexo")}</DialogTitle>
          {sequenceLabel ? (
            <p className="text-sm text-muted-foreground" role="status">
              {sequenceLabel}
            </p>
          ) : null}
        </DialogHeader>
        <div className="flex items-center justify-center rounded-lg bg-muted/40 p-3">
          {isImage && objectUrl && (
            <img src={objectUrl} alt={file.name} className="max-h-64 rounded-md object-contain" />
          )}
          {isVideo && objectUrl && (
            <video src={objectUrl} controls className="max-h-64 rounded-md" />
          )}
          {isAudio && objectUrl && <audio src={objectUrl} controls className="w-full" />}
          {!isImage && !isVideo && !isAudio && (
            <div className="flex items-center gap-3 py-4">
              <FileText size={28} weight="duotone" className="text-primary" aria-hidden />
              <div className="text-sm">
                <p className="font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
            </div>
          )}
        </div>
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={t("Legenda (opcional)")}
          aria-label={t("Legenda")}
          aria-invalid={excedeLimite}
          className="min-h-32 resize-y"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || (!e.ctrlKey && !e.metaKey)) return;
            e.preventDefault();
            enviar();
          }}
        />
        <div className="flex items-start justify-between gap-3 text-xs">
          <span className={excedeLimite ? "text-destructive" : "text-muted-foreground"}>
            {caption.length}/{LIMITE_LEGENDA_DE_MIDIA}
          </span>
          {excedeLimite ? (
            <span className="text-right text-destructive" role="alert">
              {t("A legenda passou de 1024 caracteres. Reduza o texto para enviar.")}
            </span>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={sending}>
            {t("Cancelar")}
          </Button>
          <Button onClick={enviar} disabled={sending || excedeLimite}>
            {t("Enviar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
