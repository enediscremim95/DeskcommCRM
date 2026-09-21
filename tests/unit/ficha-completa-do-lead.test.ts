import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  apresentacaoDoValor,
  historicoEstruturado,
  linhasDaNota,
  rotuloDoCampo,
  valorLegivel,
} from "@/lib/leads/dados-completos";

describe("ficha completa do lead", () => {
  it("e-mail, endereço e código ficam numa linha só; prosa quebra em palavra", () => {
    expect(apresentacaoDoValor("ferrernelson33@yahoo.com")).toBe("email");
    expect(apresentacaoDoValor("https://exemplo.com/lp?utm=x")).toBe("url");
    expect(apresentacaoDoValor("site-4cee4438f1de40f0867f2b1c")).toBe("codigo");
    expect(apresentacaoDoValor("Cobertura Batel")).toBe("texto");
    expect(apresentacaoDoValor("20/09/2026, 17:20")).toBe("texto");
    expect(apresentacaoDoValor("R$ 1.500,00")).toBe("texto");
  });

  it("nota corrida vira uma linha por informação sem perder nada", () => {
    expect(linhasDaNota("E-mail: ferrernelson33@yahoo.com · Origem: LP CO0025")).toEqual([
      { rotulo: "E-mail", valor: "ferrernelson33@yahoo.com" },
      { rotulo: "Origem", valor: "LP CO0025" },
    ]);
    expect(linhasDaNota("Quer visitar sábado\nLigar às 10:00")).toEqual([
      { valor: "Quer visitar sábado" },
      { valor: "Ligar às 10:00" },
    ]);
    expect(linhasDaNota("Cliente pediu retorno amanhã às 9:30")).toBeNull();
    expect(linhasDaNota("Site: https://a.com · Obs: ok")).toEqual([
      { rotulo: "Site", valor: "https://a.com" },
      { rotulo: "Obs", valor: "ok" },
    ]);
  });

  it("a ficha decide o layout pela largura do painel, sem cortar rótulo", () => {
    const ficha = readFileSync("components/leads/DadosCompletosDoLead.tsx", "utf8");
    expect(ficha).toContain("@container");
    expect(ficha).toContain("@md:grid-cols-[9rem_minmax(0,1fr)]");
    expect(ficha).not.toContain("sm:grid-cols-2");
    expect(ficha).not.toMatch(/<dt className="[^"]*truncate/);
    expect(ficha).toContain("copyToClipboard");
  });

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
