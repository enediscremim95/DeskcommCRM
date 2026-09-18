import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { historicoEstruturado, rotuloDoCampo, valorLegivel } from "@/lib/leads/dados-completos";

describe("ficha completa do lead", () => {
  it("prefere o rótulo declarado e mantém qualquer chave desconhecida legível", () => {
    expect(rotuloDoCampo("imovel")).toBe("Imóvel de interesse");
    expect(rotuloDoCampo("faixaDeInvestimento")).toBe("Faixa de investimento");
    expect(
      rotuloDoCampo("codigo_interno_x", [
        { key: "codigo_interno_x", label: "Código do imóvel", type: "text" },
      ]),
    ).toBe("Código do imóvel");
  });

  it("transforma histórico JSON textual em eventos sem esconder texto inválido", () => {
    expect(historicoEstruturado('[{"data":"2026-09-18","acao":"Ligou"}]')).toEqual([
      { data: "2026-09-18", acao: "Ligou" },
    ]);
    expect(historicoEstruturado("anotação livre")).toBeNull();
    expect(valorLegivel(false)).toBe("Não");
  });

  it("usa a mesma apresentação na ficha do contato e no dossiê do Kanban", () => {
    const contato = readFileSync("app/app/contacts/[id]/_client.tsx", "utf8");
    const dossie = readFileSync("components/kanban/LeadDossier.tsx", "utf8");
    expect(contato).toContain("<DadosCompletosDoLead");
    expect(dossie).toContain("<DadosCompletosDoLead");
  });

  it("a linha inteira do contato navega sem engolir os controles internos", () => {
    const tabela = readFileSync("components/contacts/ContactsTable.tsx", "utf8");
    expect(tabela).toContain('role="link"');
    expect(tabela).toContain('closest("a,button,input,select,textarea")');
    expect(tabela).toContain("router.push(`/app/contacts/${c.id}`)");
  });

  it("a leitura de todos os negócios fica cercada pela organização e pelo contato", () => {
    const rota = readFileSync("app/api/v1/contacts/[id]/leads/route.ts", "utf8");
    expect(rota).toContain('.eq("organization_id", authz.org.orgId)');
    expect(rota).toContain('.eq("contact_id", contactId)');
    expect(rota).not.toContain(".limit(");
  });
});
