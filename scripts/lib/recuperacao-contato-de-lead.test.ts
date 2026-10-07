import { describe, expect, it } from "vitest";

import {
  nomeDoContatoRecuperado,
  planejarRecuperacao,
  rawPhoneDoMetadata,
  telefoneMascarado,
  tituloDepoisDaRecuperacao,
} from "./recuperacao-contato-de-lead";

describe("recuperação de contato de lead", () => {
  const lead = {
    id: "lead-1",
    organization_id: "org-1",
    title: "Lead sem nome",
    source_metadata: { raw_phone: " 041995999437 " },
  };

  it("monta plano somente quando raw_phone vira telefone válido", () => {
    expect(planejarRecuperacao(lead)).toEqual({
      leadId: "lead-1",
      organizationId: "org-1",
      phone: "+5541995999437",
    });
    expect(planejarRecuperacao({ ...lead, source_metadata: { raw_phone: "999237616" } })).toBeNull();
    expect(planejarRecuperacao({ ...lead, source_metadata: {} })).toBeNull();
  });

  it("não aceita metadado ausente, vazio ou de outro tipo", () => {
    expect(rawPhoneDoMetadata(null)).toBeNull();
    expect(rawPhoneDoMetadata({ raw_phone: " " })).toBeNull();
    expect(rawPhoneDoMetadata({ raw_phone: 41999999999 })).toBeNull();
  });

  it("preserva título informativo e só troca o sentinela", () => {
    expect(tituloDepoisDaRecuperacao("Empresa ACME", "Ana", "+5541999999999")).toBeNull();
    expect(tituloDepoisDaRecuperacao("Lead sem nome", "Ana", "+5541999999999")).toBe("Ana");
    expect(tituloDepoisDaRecuperacao("Lead sem nome", null, "+5541999999999")).toBe(
      "+5541999999999",
    );
  });

  it("usa o título informativo no contato novo, sem inventar nome", () => {
    expect(nomeDoContatoRecuperado("Empresa ACME", "+5541999999999")).toBe("Empresa ACME");
    expect(nomeDoContatoRecuperado("Lead sem nome", "+5541999999999")).toBe("+5541999999999");
  });

  it("mostra somente os quatro últimos dígitos no log", () => {
    const masked = telefoneMascarado("+5541995999437");
    expect(masked).toBe("*********9437");
    expect(masked).not.toContain("41995999");
  });
});
