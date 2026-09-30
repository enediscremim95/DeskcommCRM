import { describe, expect, it } from "vitest";

import {
  cabeNoTetoDeMidia,
  deveGuardarMidiaRecebida,
  MEDIA_DISCARD_REASON_CAP,
  MEDIA_DISCARD_REASON_RETENTION,
  midiaFoiDescartada,
  motivoDoDescarteDaMidia,
  nomeDoArquivoDeMidia,
  WHATSAPP_MEDIA_STORAGE_CAP_BYTES_DEFAULT,
} from "./retention";

describe("política de retenção da mídia recebida", () => {
  it("guarda por padrão quando a configuração está ausente ou não é o booleano false", () => {
    expect(deveGuardarMidiaRecebida(undefined)).toBe(true);
    expect(deveGuardarMidiaRecebida(null)).toBe(true);
    expect(deveGuardarMidiaRecebida({})).toBe(true);
    expect(deveGuardarMidiaRecebida({ whatsapp_media_storage_enabled: "true" })).toBe(true);
  });

  it("só desliga com opt-out booleano explícito", () => {
    expect(deveGuardarMidiaRecebida({ whatsapp_media_storage_enabled: false })).toBe(false);
    expect(deveGuardarMidiaRecebida({ whatsapp_media_storage_enabled: true })).toBe(true);
  });

  it("lê o estado descartado e o nome textual sem confiar em metadata arbitrário", () => {
    expect(midiaFoiDescartada({ media_status: "not_stored" })).toBe(true);
    expect(midiaFoiDescartada({ media_status: "stored" })).toBe(false);
    expect(nomeDoArquivoDeMidia({ media_filename: " contrato.pdf " })).toBe("contrato.pdf");
    expect(nomeDoArquivoDeMidia({ media_filename: 12 })).toBeNull();
  });

  it("reaproveita not_stored e distingue expiração de teto", () => {
    expect(
      motivoDoDescarteDaMidia({
        media_status: "not_stored",
        media_discard_reason: MEDIA_DISCARD_REASON_RETENTION,
      }),
    ).toBe(MEDIA_DISCARD_REASON_RETENTION);
    expect(motivoDoDescarteDaMidia({ media_discard_reason: MEDIA_DISCARD_REASON_CAP })).toBe(
      MEDIA_DISCARD_REASON_CAP,
    );
    expect(motivoDoDescarteDaMidia(null)).toBeNull();
  });

  it("o teto aceita o último byte e barra o primeiro que o ultrapassa", () => {
    expect(cabeNoTetoDeMidia(WHATSAPP_MEDIA_STORAGE_CAP_BYTES_DEFAULT - 3, 3)).toBe(true);
    expect(cabeNoTetoDeMidia(WHATSAPP_MEDIA_STORAGE_CAP_BYTES_DEFAULT - 3, 4)).toBe(false);
  });
});
