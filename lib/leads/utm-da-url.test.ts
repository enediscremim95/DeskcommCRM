import { describe, expect, it } from "vitest";

import { extrairUtmsDaUrl, origemComUtms } from "./utm-da-url";

const PAGINA =
  "https://bendito-ponto-franquia.pages.dev/?utm_source=fb&utm_medium=paid_social" +
  "&utm_campaign=CP1%20-%20CONVERS%C3%83O&utm_content=ADS02&utm_term=CJ%20Aberto&fbclid=abc123";

describe("campanha escondida na URL da página (pedido do dono, 23/09/2026)", () => {
  it("quebra a URL em campanha, conjunto e anúncio", () => {
    expect(extrairUtmsDaUrl(PAGINA)).toEqual({
      utm_source: "fb",
      utm_medium: "paid_social",
      utm_campaign: "CP1 - CONVERSÃO",
      utm_content: "ADS02",
      utm_term: "CJ Aberto",
      fbclid: "abc123",
    });
  });

  it("ignora o que não é endereço e endereço sem campanha", () => {
    expect(extrairUtmsDaUrl("LP Cloudflare")).toEqual({});
    expect(extrairUtmsDaUrl("https://site.com/obrigado")).toEqual({});
    expect(extrairUtmsDaUrl(null)).toEqual({});
  });

  it("o que a captação gravou separado vence o que veio na URL", () => {
    const juntos = Object.fromEntries(
      origemComUtms({ utm_campaign: "Campanha oficial", utm_medium: "" }, [PAGINA]),
    );
    expect(juntos.utm_campaign).toBe("Campanha oficial");
    expect(juntos.utm_source).toBe("fb");
    // Valor vazio na captação não apaga o que a URL trouxe.
    expect(juntos.utm_medium).toBe("paid_social");
  });
});
