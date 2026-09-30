import { describe, expect, it, vi } from "vitest";

import {
  expurgarMidiasVencidas,
  type MidiaCandidataAoExpurgo,
} from "@/lib/messaging/media/expurgo";

const AGORA = new Date("2026-09-29T18:00:00.000Z");
const vencida: MidiaCandidataAoExpurgo = {
  id: "m-vencida",
  organization_id: "org-1",
  sent_at: "2026-09-08T17:59:59.000Z",
  media_storage_path: "org-1/c-1/m-vencida.mp4",
  media_size_bytes: 5_400_000,
  metadata: { media_status: "stored", media_filename: "video.mp4" },
};
const dentroDoPrazo: MidiaCandidataAoExpurgo = {
  id: "m-recente",
  organization_id: "org-1",
  sent_at: "2026-09-08T18:00:01.000Z",
  media_storage_path: "org-1/c-1/m-recente.jpg",
  media_size_bytes: 161_000,
  metadata: { media_status: "stored", media_filename: "foto.jpg" },
};

describe("expurgo da mídia do WhatsApp", () => {
  it("apaga o vencido, preserva a mensagem e NÃO apaga o que está dentro de 21 dias", async () => {
    const remover = vi.fn(async () => undefined);
    const marcarExpirada = vi.fn(async () => undefined);
    const resultado = await expurgarMidiasVencidas(
      {
        // O fake devolve de propósito uma linha recente. A defesa do expurgo,
        // e não a boa vontade do fake, precisa impedir a exclusão.
        listarAntesDe: async () => [vencida, dentroDoPrazo],
        marcarExpirada,
      },
      { remover },
      { agora: AGORA, retencaoDias: 21 },
    );

    expect(remover).toHaveBeenCalledOnce();
    expect(remover).toHaveBeenCalledWith([vencida.media_storage_path]);
    expect(marcarExpirada).toHaveBeenCalledOnce();
    expect(marcarExpirada).toHaveBeenCalledWith(
      vencida,
      expect.objectContaining({
        media_status: "not_stored",
        media_discard_reason: "retention_expired",
        media_retention_days: 21,
        media_filename: "video.mp4",
      }),
    );
    expect(resultado).toMatchObject({ arquivos_apagados: 1, bytes_liberados: 5_400_000 });
  });
});
