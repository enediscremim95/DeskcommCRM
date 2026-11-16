import { describe, expect, it, vi } from "vitest";

import {
  createAttachmentQueueItems,
  filesFromDrop,
  filesInOrder,
  isFileDrag,
  processAttachmentQueue,
  skipFailedAttachment,
} from "./attachment-queue";

function image(name: string): File {
  return new File([new Uint8Array([1])], name, { type: "image/png" });
}

describe("fila de anexos", () => {
  it("extrai o FileList na ordem original", () => {
    const files = [image("1.png"), image("2.png"), image("3.png")];
    const list = {
      0: files[0],
      1: files[1],
      2: files[2],
      length: 3,
      item: (i: number) => files[i] ?? null,
    } as unknown as FileList;
    expect(filesInOrder(list).map((file) => file.name)).toEqual(["1.png", "2.png", "3.png"]);
  });

  it("ignora texto arrastado e aceita arquivos somente quando o drop tem Files", () => {
    expect(isFileDrag({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);
    expect(filesFromDrop({ files: [] } as unknown as DataTransfer)).toEqual([]);
    expect(isFileDrag({ types: ["Files"] } as unknown as DataTransfer)).toBe(true);
    expect(
      filesFromDrop({ files: [image("foto.png")] } as unknown as DataTransfer).map((file) => file.name),
    ).toEqual(["foto.png"]);
  });

  it("envia cinco imagens estritamente uma por vez e em ordem", async () => {
    const items = createAttachmentQueueItems(
      [1, 2, 3, 4, 5].map((number) => image(`${number}.png`)),
    ).accepted;
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn(async (item: (typeof items)[number]) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(item.file.name);
      await Promise.resolve();
      inFlight -= 1;
    });

    const result = await processAttachmentQueue(items, send);
    expect(result.status).toBe("completed");
    expect(order).toEqual(["1.png", "2.png", "3.png", "4.png", "5.png"]);
    expect(maxInFlight).toBe(1);
  });

  it("falha no terceiro pausa e tentar novamente não duplica os dois primeiros", async () => {
    const items = createAttachmentQueueItems([1, 2, 3, 4].map((n) => image(`${n}.png`))).accepted;
    const sent: string[] = [];
    let failThird = true;
    const send = async (item: (typeof items)[number]) => {
      if (item.file.name === "3.png" && failThird) {
        failThird = false;
        throw new Error("falha controlada");
      }
      sent.push(item.file.name);
    };

    const paused = await processAttachmentQueue(items, send);
    expect(paused.status).toBe("paused");
    expect(sent).toEqual(["1.png", "2.png"]);

    const retried = await processAttachmentQueue(paused.items, send);
    expect(retried.status).toBe("completed");
    expect(sent).toEqual(["1.png", "2.png", "3.png", "4.png"]);
  });

  it("Pular continua do próximo e Cancelar restantes pode descartar a fila pausada", async () => {
    const items = createAttachmentQueueItems([1, 2, 3, 4].map((n) => image(`${n}.png`))).accepted;
    const first = await processAttachmentQueue(items, async (item) => {
      if (item.file.name === "2.png") throw new Error("falhou");
    });
    const skipped = skipFailedAttachment(first.items, first.failedId!);
    const sentAfterSkip: string[] = [];
    const completed = await processAttachmentQueue(skipped, async (item) => {
      sentAfterSkip.push(item.file.name);
    });
    expect(completed.status).toBe("completed");
    expect(sentAfterSkip).toEqual(["3.png", "4.png"]);

    const cancelled: typeof first.items = [];
    expect(cancelled).toHaveLength(0);
  });
});
