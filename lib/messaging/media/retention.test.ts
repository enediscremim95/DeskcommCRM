import { describe, expect, it } from "vitest";

import {
  deveGuardarMidiaRecebida,
  midiaFoiDescartada,
  nomeDoArquivoDeMidia,
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
});
