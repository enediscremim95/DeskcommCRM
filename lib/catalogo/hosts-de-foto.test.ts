import { describe, expect, it } from "vitest";

import { hostDeFotoPermitido, urlDeFotoPermitida } from "./hosts-de-foto";

describe("allowlist fixa de fotos do painel", () => {
  it.each([
    "produtos.sublimando.com.br",
    "sublimando-produtos.admsublimando.workers.dev",
    "cdn.yampi.io",
    "imagens.loja.yampi.com.br",
    "cdn.bling.com.br",
    "fotos.blingcdn.com.br",
  ])("aceita %s", (host) => {
    expect(hostDeFotoPermitido(host)).toBe(true);
  });

  it.each([
    "yampi.io",
    "bling.com.br",
    "yampi.io.atacante.example",
    "blingcdn.com.br.atacante.example",
    "localhost",
  ])("recusa %s", (host) => {
    expect(hostDeFotoPermitido(host)).toBe(false);
  });

  it("aceita somente HTTPS sem credencial e sem porta alternativa", () => {
    expect(() => urlDeFotoPermitida("http://produtos.sublimando.com.br/foto.jpg")).toThrow(
      "foto_exige_https",
    );
    expect(() =>
      urlDeFotoPermitida("https://usuario:senha@produtos.sublimando.com.br/foto.jpg"),
    ).toThrow("foto_url_com_credencial");
    expect(() => urlDeFotoPermitida("https://produtos.sublimando.com.br:8443/foto.jpg")).toThrow(
      "foto_porta_nao_permitida",
    );
  });
});
