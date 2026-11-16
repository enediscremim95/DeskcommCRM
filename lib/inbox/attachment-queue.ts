import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";

export type AttachmentQueueStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export interface AttachmentQueueItem {
  id: string;
  file: File;
  caption: string;
  status: AttachmentQueueStatus;
  error?: string;
}

export interface AttachmentQueueRunResult {
  items: AttachmentQueueItem[];
  status: "completed" | "paused";
  failedId?: string;
}

let queueSequence = 0;

/** FileList/DataTransfer já preservam a ordem escolhida pelo navegador. */
export function filesInOrder(files: FileList | Iterable<File> | null | undefined): File[] {
  return files ? Array.from(files) : [];
}

/** Texto arrastado não possui arquivos e, portanto, nunca é interceptado. */
export function filesFromDrop(data: Pick<DataTransfer, "files"> | null): File[] {
  return filesInOrder(data?.files).filter((file) => file.size > 0);
}

export function isFileDrag(data: Pick<DataTransfer, "types"> | null): boolean {
  return Array.from(data?.types ?? []).includes("Files");
}

export function createAttachmentQueueItems(files: Iterable<File>): {
  accepted: AttachmentQueueItem[];
  rejected: Array<{ file: File; message: string }>;
} {
  const accepted: AttachmentQueueItem[] = [];
  const rejected: Array<{ file: File; message: string }> = [];

  for (const file of files) {
    const verdict = validateOutboundMedia(file.type || "application/octet-stream", file.size);
    if (!verdict.ok) {
      rejected.push({ file, message: verdict.message });
      continue;
    }
    queueSequence += 1;
    accepted.push({
      id: `attachment-${queueSequence}`,
      file,
      caption: "",
      status: "pending",
    });
  }
  return { accepted, rejected };
}

function replaceItem(
  items: AttachmentQueueItem[],
  id: string,
  patch: Partial<AttachmentQueueItem>,
): AttachmentQueueItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * Executa um item por vez. Uma segunda chamada com o estado pausado ignora os
 * itens já enviados, que é a trava contra duplicação no retry.
 */
export async function processAttachmentQueue(
  initialItems: AttachmentQueueItem[],
  sendOne: (item: AttachmentQueueItem) => Promise<void>,
  onChange: (items: AttachmentQueueItem[]) => void = () => undefined,
): Promise<AttachmentQueueRunResult> {
  let items = initialItems.map((item) => ({ ...item }));

  for (const item of items) {
    if (item.status === "sent" || item.status === "skipped") continue;

    items = replaceItem(items, item.id, { status: "sending", error: undefined });
    onChange(items);
    const current = items.find((candidate) => candidate.id === item.id)!;
    try {
      await sendOne(current);
      items = replaceItem(items, item.id, { status: "sent", error: undefined });
      onChange(items);
    } catch (error) {
      items = replaceItem(items, item.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "attachment_send_failed",
      });
      onChange(items);
      return { items, status: "paused", failedId: item.id };
    }
  }

  return { items, status: "completed" };
}

export function skipFailedAttachment(
  items: AttachmentQueueItem[],
  failedId: string,
): AttachmentQueueItem[] {
  return replaceItem(items, failedId, { status: "skipped", error: undefined });
}
