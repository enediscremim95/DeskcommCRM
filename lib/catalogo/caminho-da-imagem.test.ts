import { describe, expect, it } from "vitest";

import { caminhoDaImagemDoCatalogo } from "./caminho-da-imagem";

const ORG = "11111111-1111-4111-8111-111111111111";
const PRODUTO = "22222222-2222-4222-8222-222222222222";

describe("posse do caminho da imagem do catálogo", () => {
  it("aceita somente o prefixo da organização e do produto", () => {
    const caminho = `${ORG}/${PRODUTO}/foto.jpg`;
    expect(
      caminhoDaImagemDoCatalogo(
        `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`,
        ORG,
        PRODUTO,
      ),
    ).toBe(caminho);
  });

  it("recusa caminho de outra organização e URL externa", () => {
    expect(
      caminhoDaImagemDoCatalogo(
        `https://crm.example/storage/v1/object/public/catalog-media/99999999-9999-4999-8999-999999999999/${PRODUTO}/foto.jpg`,
        ORG,
        PRODUTO,
      ),
    ).toBeNull();
    expect(caminhoDaImagemDoCatalogo("https://cdn.example/foto.jpg", ORG, PRODUTO)).toBeNull();
  });
});
