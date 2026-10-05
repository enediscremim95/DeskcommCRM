import { describe, expect, it } from "vitest";

import { paginaDestinoLimpa, paginasDestinoLimpas } from "./pagina-limpa";

describe("página de destino limpa", () => {
  it("mantém domínio e caminho e remove query, hash e barra final", () => {
    expect(paginaDestinoLimpa("https://CLIENTE.test/oferta/?utm_source=meta#formulario")).toEqual({
      endereco: "cliente.test/oferta",
      href: "https://cliente.test/oferta",
    });
  });

  it("deduplica endereços limpos e aceita URL sem protocolo", () => {
    expect(
      paginasDestinoLimpas([
        "cliente.test/oferta?utm_campaign=a",
        "https://CLIENTE.test/oferta#topo",
        "https://cliente.test/outra?gclid=abc",
      ]),
    ).toEqual([
      { endereco: "cliente.test/oferta", href: "https://cliente.test/oferta" },
      { endereco: "cliente.test/outra", href: "https://cliente.test/outra" },
    ]);
  });

  it("ignora URL inválida sem quebrar", () => {
    expect(paginaDestinoLimpa("javascript:alert(1)")).toBeNull();
    expect(paginasDestinoLimpas(["", "http://"])).toEqual([]);
  });
});
