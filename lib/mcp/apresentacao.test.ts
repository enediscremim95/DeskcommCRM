import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { montarApresentacaoMcp, type ApresentacaoMcpInput } from "./apresentacao";
import { opcoesDoServidorMcp } from "./configuracao";
import { crmComoFunciona } from "./tools/contexto";
import type { McpContext } from "./types";

const base = {
  productName: "Marca da instalação",
  organizationName: "Clínica Exemplo",
  businessDescription: "Atendimento de saúde preventiva.",
  currency: "BRL",
  timezone: "America/Sao_Paulo",
  locale: "pt-BR" as const,
  tokenName: "Assistente externo",
  role: "agent" as const,
  vocabulary: null,
};

describe("apresentação dinâmica do MCP", () => {
  it("não promete escrita a um token somente de leitura", () => {
    const texto = montarApresentacaoMcp({ ...base, scopes: ["mcp:read"] });

    expect(texto).toContain("Pode consultar contatos");
    expect(texto).toContain("Não pode registrar, alterar nem enviar mensagens");
    expect(texto).not.toContain("Pode registrar e alterar dados do CRM");
  });

  it("declara a escrita quando o token a recebeu", () => {
    const texto = montarApresentacaoMcp({ ...base, scopes: ["mcp:read", "mcp:write"] });
    expect(texto).toContain("Pode registrar e alterar dados do CRM");
  });

  it("avisa que a montagem com escopo próprio nunca publica sozinha", () => {
    const texto = montarApresentacaoMcp({
      ...base,
      role: "manager",
      scopes: ["mcp:read", "mcp:configure"],
    });
    expect(texto).toContain("Nada do que for montado entra no ar sozinho");
    expect(texto).toContain("publicar pela tela de Agentes");
  });

  it("não promete dados operacionais ao papel leitor, mesmo com os escopos", () => {
    const texto = montarApresentacaoMcp({
      ...base,
      role: "viewer",
      scopes: ["mcp:read", "mcp:write"],
    });

    expect(texto).toContain("papel leitor não pode consultar os dados operacionais");
    expect(texto).toContain("papel leitor não permite essas ações");
  });

  it("usa o vocabulário da organização sem incluir segredo", () => {
    const segredo = "dsk_nao_pode_aparecer";
    const entrada: ApresentacaoMcpInput & { plaintext: string } = {
      ...base,
      scopes: ["mcp:read"],
      vocabulary: { lead: "Paciente", deal: "Tratamento", won: "Iniciado", lost: "Encerrado" },
      plaintext: segredo,
    };
    const texto = montarApresentacaoMcp(entrada);

    expect(texto).toContain("Lead (Paciente) e negócio (Tratamento)");
    expect(texto).toContain("Iniciado / Encerrado");
    expect(texto).not.toContain(segredo);
  });

  it("a ferramenta devolve o mesmo texto enviado como instructions", async () => {
    const texto = montarApresentacaoMcp({ ...base, scopes: ["mcp:read"] });
    const ctx = { apresentacao: texto } as unknown as McpContext;

    expect(await crmComoFunciona.handler({}, ctx)).toBe(opcoesDoServidorMcp(texto).instructions);
    expect(crmComoFunciona.requiresRole).toBe("viewer");
    expect(crmComoFunciona.requiresScope).toBe("mcp:read");
  });

  it("o servidor usa a apresentação autenticada nas instructions e no contexto da tool", () => {
    const source = readFileSync(join(__dirname, "server.ts"), "utf8");
    expect(source).toContain('opcoesDoServidorMcp(auth.apresentacao ?? "")');
    expect(source).toContain("apresentacao: auth.apresentacao");
  });
});
