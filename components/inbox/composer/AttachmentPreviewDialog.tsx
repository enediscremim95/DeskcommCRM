"use client";
/* eslint-disable @next/next/no-img-element -- prévia usa Blob local, sem URL otimizável. */
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
import type { AttachmentQueueItem } from "@/lib/inbox/attachment-queue";

interface Props {
  file?: File | null;
  items?: AttachmentQueueItem[];
  activeItemId?: string | null;
  initialCaption?: string;
  sending: boolean;
  sequenceLabel?: string;
  onSelectItem?: (id: string) => void;
  onCaptionChange?: (id: string, caption: string) => void;
  onCancel: () => void;
  onSend: (caption: string) => void;
  onRetry?: () => void;
  onSkip?: () => void;
  onCancelRemaining?: () => void;
}

/** Preview antes do envio (padrão WhatsApp): thumb ou card + legenda. */
export function AttachmentPreviewDialog({
  file,
  items,
  activeItemId,
  initialCaption = "",
  sending,
  sequenceLabel,
  onSelectItem,
  onCaptionChange,
  onCancel,
  onSend,
  onRetry,
  onSkip,
  onCancelRemaining,
}: Props) {
  const t = useT();
  const [legacyCaption, setLegacyCaption] = useState({ file, initialCaption, value: initialCaption });
  if (legacyCaption.file !== file || legacyCaption.initialCaption !== initialCaption) {
    setLegacyCaption({ file, initialCaption, value: initialCaption });
  }

  const queueItems = items?.length
    ? items
    : file
      ? [{ id: "legacy", file, caption: legacyCaption.value, status: "pending" as const }]
      : [];
  const activeItem =
    queueItems.find((item) => item.id === activeItemId) ??
    queueItems.find((item) => item.status !== "sent" && item.status !== "skipped") ??
    queueItems[0];
  const activeFile = activeItem?.file ?? null;
  const activeCaption = items?.length ? (activeItem?.caption ?? "") : legacyCaption.value;
  const failedItem = queueItems.find((item) => item.status === "failed");

  const objectUrl = useMemo(
    () =>
      activeFile && /^(image|video|audio)\//.test(activeFile.type)
        ? URL.createObjectURL(activeFile)
        : null,
    [activeFile],
  );
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  if (!activeFile) return null;
  const isImage = activeFile.type.startsWith("image/");
  const isVideo = activeFile.type.startsWith("video/");
  const isAudio = activeFile.type.startsWith("audio/");
  const excedeLimite = activeCaption.length > LIMITE_LEGENDA_DE_MIDIA;
  const filaExcedeLimite = queueItems.some(
    (item) => item.caption.length > LIMITE_LEGENDA_DE_MIDIA,
  );

  function enviar(): void {
    if (sending || filaExcedeLimite) return;
    onSend(activeCaption.trim());
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Enviar anexo")}</DialogTitle>
          {queueItems.length > 1 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("{total} anexos na fila").replace("{total}", String(queueItems.length))}
            </p>
          ) : null}
          {sequenceLabel ? (
            <p className="text-sm text-muted-foreground" role="status">
              {sequenceLabel}
            </p>
          ) : null}
        </DialogHeader>
        <div className="flex items-center justify-center rounded-lg bg-muted/40 p-3">
          {isImage && objectUrl && (
            <img src={objectUrl} alt={activeFile.name} className="max-h-64 rounded-md object-contain" />
          )}
          {isVideo && objectUrl && (
            <video src={objectUrl} controls className="max-h-64 rounded-md" />
          )}
          {isAudio && objectUrl && <audio src={objectUrl} controls className="w-full" />}
          {!isImage && !isVideo && !isAudio && (
            <div className="flex items-center gap-3 py-4">
              <FileText size={28} weight="duotone" className="text-primary" aria-hidden />
              <div className="text-sm">
                <p className="font-medium">{activeFile.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(activeFile.size)}</p>
              </div>
            </div>
          )}
        </div>
        {queueItems.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label={t("Anexos selecionados")}>
            {queueItems.map((item, index) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onSelectItem?.(item.id)}
                aria-label={t("Selecionar anexo {numero}").replace("{numero}", String(index + 1))}
                className={`min-w-24 rounded-md border px-2 py-1 text-left text-xs ${
                  item.id === activeItem!.id ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <span className="block truncate">{item.file.name}</span>
                <span className="text-muted-foreground">
                  {item.status === "sent"
                    ? t("Enviado")
                    : item.status === "failed"
                      ? t("Falhou")
                      : item.status === "skipped"
                        ? t("Pulado")
                        : `${index + 1}/${queueItems.length}`}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <Textarea
          value={activeCaption}
          onChange={(e) => {
            if (items?.length && activeItem) onCaptionChange?.(activeItem.id, e.target.value);
            else setLegacyCaption((current) => ({ ...current, value: e.target.value }));
          }}
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
            {activeCaption.length}/{LIMITE_LEGENDA_DE_MIDIA}
          </span>
          {excedeLimite ? (
            <span className="text-right text-destructive" role="alert">
              {t("A legenda passou de 1024 caracteres. Reduza o texto para enviar.")}
            </span>
          ) : null}
        </div>
        <DialogFooter>
          {failedItem ? (
            <>
              <Button variant="outline" onClick={onRetry} disabled={sending}>
                {t("Tentar novamente")}
              </Button>
              <Button variant="outline" onClick={onSkip} disabled={sending}>
                {t("Pular")}
              </Button>
              <Button variant="destructive" onClick={onCancelRemaining} disabled={sending}>
                {t("Cancelar restantes")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onCancel} disabled={sending}>
                {t("Cancelar")}
              </Button>
              <Button onClick={enviar} disabled={sending || filaExcedeLimite}>
                {queueItems.length > 1
                  ? t("Enviar {total} anexos").replace("{total}", String(queueItems.length))
                  : t("Enviar")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
