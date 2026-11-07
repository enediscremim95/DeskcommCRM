import { describe, expect, it } from "vitest";

import {
  caminhoDaImagemDoCatalogo,
  caminhoDaImagemDoCatalogoNaOrganizacao,
} from "./caminho-da-imagem";

const ORG = "11111111-1111-4111-8111-111111111111";
const PRODUTO = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const IMAGEM = "33333333-3333-4333-8333-333333333333.jpg";

function urlDoCatalogo(caminho: string): string {
  return `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`;
}

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

  it("a variante de envio aceita a pasta do SKU pai da mesma organização", () => {
    const caminho = `${ORG}/SUBLI-NAT-CRISTA-BASE-BEGE/foto.jpg`;
    const url = `https://crm.example/storage/v1/object/public/catalog-media/${caminho}`;

    expect(caminhoDaImagemDoCatalogoNaOrganizacao(url, ORG)).toBe(caminho);
    expect(caminhoDaImagemDoCatalogo(url, ORG, PRODUTO)).toBeNull();
  });

  it("a variante de envio continua recusando outra organização e URL externa", () => {
    expect(
      caminhoDaImagemDoCatalogoNaOrganizacao(
        `https://crm.example/storage/v1/object/public/catalog-media/99999999-9999-4999-8999-999999999999/SKU/foto.jpg`,
        ORG,
      ),
    ).toBeNull();
    expect(caminhoDaImagemDoCatalogoNaOrganizacao("https://cdn.example/foto.jpg", ORG)).toBeNull();
  });

  it.each([
    `${ORG}/..%2F${OUTRA_ORG}/x.jpg`,
    `${ORG}%2F..%2F${OUTRA_ORG}%2Fx.jpg`,
    `${ORG}//x.jpg`,
    `${ORG}/a/./b.jpg`,
    `${ORG}/a%5Cb.jpg`,
    `${ORG}/a%00b.jpg`,
  ])("recusa caminho inseguro na variante da organização: %s", (caminho) => {
    expect(caminhoDaImagemDoCatalogoNaOrganizacao(urlDoCatalogo(caminho), ORG)).toBeNull();
  });

  it.each([
    `${ORG}/${PRODUTO}/..%2F${OUTRA_ORG}/x.jpg`,
    `${ORG}%2F${PRODUTO}%2F..%2F${OUTRA_ORG}%2Fx.jpg`,
    `${ORG}/${PRODUTO}//x.jpg`,
    `${ORG}/${PRODUTO}/a/./b.jpg`,
    `${ORG}/${PRODUTO}/a%5Cb.jpg`,
    `${ORG}/${PRODUTO}/a%00b.jpg`,
  ])("recusa caminho inseguro na variante estrita: %s", (caminho) => {
    expect(caminhoDaImagemDoCatalogo(urlDoCatalogo(caminho), ORG, PRODUTO)).toBeNull();
  });

  it("mantém o caminho legítimo nas duas variantes", () => {
    const caminho = `${ORG}/${PRODUTO}/${IMAGEM}`;

    expect(caminhoDaImagemDoCatalogoNaOrganizacao(urlDoCatalogo(caminho), ORG)).toBe(caminho);
    expect(caminhoDaImagemDoCatalogo(urlDoCatalogo(caminho), ORG, PRODUTO)).toBe(caminho);
  });
});
