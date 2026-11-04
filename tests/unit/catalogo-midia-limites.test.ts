import { describe, expect, it } from "vitest";

import {
  MAX_WHATSAPP_IMAGE_BYTES,
  MAX_WHATSAPP_VIDEO_BYTES,
  validarMidiaDeAtalho,
} from "@/lib/messaging/media/channel-limits";

describe("limites de mídia do atalho no WhatsApp oficial", () => {
  it("aceita somente JPEG e PNG até 5 MB", () => {
    expect(validarMidiaDeAtalho("image/jpeg", MAX_WHATSAPP_IMAGE_BYTES)).toEqual({
      ok: true,
      kind: "image",
    });
    expect(validarMidiaDeAtalho("image/webp", 10)).toMatchObject({
      ok: false,
      code: "unsupported_media_type",
    });
    expect(validarMidiaDeAtalho("image/png", MAX_WHATSAPP_IMAGE_BYTES + 1)).toMatchObject({
      ok: false,
      code: "payload_too_large",
    });
  });

  it("aceita somente MP4 e 3GPP até 16 MB", () => {
    expect(validarMidiaDeAtalho("video/mp4", MAX_WHATSAPP_VIDEO_BYTES)).toEqual({
      ok: true,
      kind: "video",
    });
    expect(validarMidiaDeAtalho("video/3gpp", 100)).toEqual({ ok: true, kind: "video" });
    expect(validarMidiaDeAtalho("video/webm", 100)).toMatchObject({
      ok: false,
      code: "unsupported_media_type",
    });
    expect(validarMidiaDeAtalho("video/mp4", MAX_WHATSAPP_VIDEO_BYTES + 1)).toMatchObject({
      ok: false,
      code: "payload_too_large",
    });
  });

  it("recusa arquivo vazio", () => {
    expect(validarMidiaDeAtalho("image/jpeg", 0)).toMatchObject({
      ok: false,
      code: "validation_failed",
    });
  });
});
