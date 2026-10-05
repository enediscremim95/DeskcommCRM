import { describe, expect, it } from "vitest";

import { paginaDestinoLimpa, paginasDestinoLimpas } from "./pagina-limpa";

describe("página de destino limpa", () => {
  it("remove protocolo, parâmetros, fragmento e barra final", () => {
    expect(paginaDestinoLimpa("https://CLIENTE.test/oferta/?utm_source=meta#form")).toEqual({
      endereco: "cliente.test/oferta",
      href: "https://cliente.test/oferta",
    });
  });

  it("aceita endereço sem protocolo e rejeita esquema inseguro", () => {
    expect(paginaDestinoLimpa("cliente.test/pagina")?.endereco).toBe("cliente.test/pagina");
    expect(paginaDestinoLimpa("javascript:alert(1)")).toBeNull();
  });

  it("deduplica pelo endereço exibido", () => {
    expect(
      paginasDestinoLimpas([
        "https://cliente.test/a?utm_source=meta",
        "https://CLIENTE.test/a#topo",
        "https://cliente.test/b",
      ]).map((page) => page.endereco),
    ).toEqual(["cliente.test/a", "cliente.test/b"]);
  });
});
