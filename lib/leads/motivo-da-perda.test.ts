import { describe, expect, it } from "vitest";

import {
  entradaDePerda,
  motivoDaPerdaLegivel,
  motivoPedeDetalhe,
  motivosDePerdaConfigurados,
  opcoesDeMotivoDaPerda,
} from "./motivo-da-perda";

describe("motivo da perda", () => {
  it("usa literalmente as opções configuradas no funil", () => {
    const configurados = motivosDePerdaConfigurados({
      lost_reasons: ["Região indisponível", "Dados inválidos/Fake", "Outro"],
    });

    expect(opcoesDeMotivoDaPerda(configurados)).toEqual([
      { value: "Região indisponível", label: "Região indisponível" },
      { value: "Dados inválidos/Fake", label: "Dados inválidos/Fake" },
      { value: "Outro", label: "Outro" },
    ]);
    expect(entradaDePerda("Região indisponível", "")).toEqual({
      lost_reason: "Região indisponível",
      lost_reason_detail: null,
    });
  });

  it("volta à lista canônica quando o funil não configurou motivos", () => {
    expect(opcoesDeMotivoDaPerda([])).toEqual([
      { value: "requested_by_customer", label: "Cliente solicitou cancelamento" },
      { value: "price", label: "Preço" },
      { value: "no_response", label: "Sem resposta do cliente" },
      { value: "product_unavailable", label: "Produto indisponível" },
      { value: "cancelled_by_store", label: "Cancelado pela loja" },
      { value: "cancelled_by_customer", label: "Cancelado pelo cliente" },
      { value: "payment_failed", label: "Falha no pagamento" },
      { value: "other", label: "Outro motivo" },
    ]);
    expect(opcoesDeMotivoDaPerda()).toEqual(opcoesDeMotivoDaPerda([]));
  });

  it("mantém other como categoria e envia o texto no campo próprio", () => {
    expect(entradaDePerda("other", "  Cliente mudou de cidade  ")).toEqual({
      lost_reason: "other",
      lost_reason_detail: "Cliente mudou de cidade",
    });
  });

  it("salva outro motivo sem detalhe", () => {
    expect(entradaDePerda("other", "   ")).toEqual({
      lost_reason: "other",
      lost_reason_detail: null,
    });
  });

  it("trata Outro configurado como opção que pede detalhe", () => {
    expect(motivoPedeDetalhe("  OUTRO motivo ")).toBe(true);
    expect(entradaDePerda("Outro", "  Região ainda não atendida  ")).toEqual({
      lost_reason: "Outro",
      lost_reason_detail: "Região ainda não atendida",
    });
  });

  it("salva motivo da lista e descarta detalhe antigo do campo Outro", () => {
    expect(entradaDePerda("price", "texto que ficou no formulário")).toEqual({
      lost_reason: "price",
      lost_reason_detail: null,
    });
  });

  it("mostra o detalhe junto do motivo e preserva motivos livres já salvos", () => {
    const t = (texto: string) => texto;
    expect(motivoDaPerdaLegivel("other", "Cliente pausou o projeto", t)).toBe(
      "Outro motivo: Cliente pausou o projeto",
    );
    expect(motivoDaPerdaLegivel("Motivo cadastrado hoje", null, t)).toBe(
      "Motivo cadastrado hoje",
    );
  });
});
