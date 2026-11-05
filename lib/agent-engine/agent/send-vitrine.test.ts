import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { VitrinesConfig } from "@/lib/ai/guardrails-schema";
import { executarVitrine, sendVitrineInputSchema } from "./send-vitrine";

const vitrines: VitrinesConfig = {
  padrinhos: {
    intro: "Separei dois modelos pra você 🥰",
    fechamento: "Essas opções atendem ao que você gostaria?",
    itens: [
      { codigo: "KRAFT", titulo: "Kit Afeto com caixa kraft", fotos: 2 },
      { codigo: "PINUS", titulo: "Kit Afeto com caixa pinus", fotos: 2 },
    ],
  },
};

function cenario(overrides: Partial<Parameters<typeof executarVitrine>[0]> = {}) {
  const ordem: string[] = [];
  const inspecionarItem = vi.fn(async (item: { codigo: string }) => ({
    status: "ready" as const,
    produtoCodigo: `PAI-${item.codigo}`,
    mensagensFisicas: 2,
    precoResumo: item.codigo === "KRAFT" ? "R$ 129,90" : "R$ 159,90",
  }));
  const enviarTexto = vi.fn(async (_body: string, papel: string) => {
    ordem.push(papel);
    return { status: "sent" as const };
  });
  const enviarItem = vi.fn(async (item: { codigo: string }) => {
    ordem.push(`fotos:${item.codigo}`);
    return { ok: true, ja_enviado: false };
  });
  return {
    ordem,
    inspecionarItem,
    enviarTexto,
    enviarItem,
    args: {
      input: { assunto: "padrinhos" },
      vitrines,
      maxSendsRestantes: () => 6,
      produtosJaEnviadosNoTurno: 0,
      imagensJaEnviadasNoTurno: 0,
      textoConsumiraEnvio: () => true,
      inspecionarItem,
      enviarTexto,
      enviarItem,
      ...overrides,
    } as Parameters<typeof executarVitrine>[0],
  };
}

describe("crm_send_vitrine", () => {
  it("aceita somente assunto vindo do modelo", () => {
    expect(sendVitrineInputSchema.safeParse({ assunto: "padrinhos" }).success).toBe(true);
    expect(sendVitrineInputSchema.safeParse({ assunto: "padrinhos", codigo: "KRAFT" }).success).toBe(false);
    expect(sendVitrineInputSchema.safeParse({ assunto: "Padrinhos" }).success).toBe(false);
  });

  it("mantém a ordem fixa intro, produtos e fechamento e devolve o resumo", async () => {
    const c = cenario();
    const resultado = await executarVitrine(c.args);

    expect(c.ordem).toEqual(["intro", "fotos:KRAFT", "fotos:PINUS", "fechamento"]);
    expect(resultado).toMatchObject({
      ok: true,
      todos_ja_enviados: false,
      mostrados: [
        { codigo: "KRAFT", titulo: "Kit Afeto com caixa kraft", preco_resumo: "R$ 129,90" },
        { codigo: "PINUS", titulo: "Kit Afeto com caixa pinus", preco_resumo: "R$ 159,90" },
      ],
      instrucao: expect.stringContaining("Não repita nome nem preço"),
    });
  });

  it("lista assuntos válidos quando o modelo pede um desconhecido", async () => {
    const c = cenario({ input: { assunto: "outro" } });
    const resultado = await executarVitrine(c.args);
    expect(resultado).toMatchObject({
      ok: false,
      error: { code: "assunto_desconhecido" },
      assuntos_validos: ["padrinhos"],
    });
    expect(c.enviarTexto).not.toHaveBeenCalled();
    expect(c.enviarItem).not.toHaveBeenCalled();
  });

  it("não envia abertura nem fechamento quando todos os produtos já foram enviados", async () => {
    const c = cenario({
      inspecionarItem: vi.fn(async (item: { codigo: string }) => ({
        status: "already_sent" as const,
        produtoCodigo: `PAI-${item.codigo}`,
      })),
    });
    const resultado = await executarVitrine(c.args);
    expect(resultado).toMatchObject({ ok: true, todos_ja_enviados: true, mostrados: [] });
    expect(c.enviarTexto).not.toHaveBeenCalled();
    expect(c.enviarItem).not.toHaveBeenCalled();
  });

  it("corta no limite entre itens, nunca no meio de um produto", async () => {
    const c = cenario({ maxSendsRestantes: () => 4 });
    const resultado = await executarVitrine(c.args);
    expect(c.ordem).toEqual(["intro", "fotos:KRAFT", "fechamento"]);
    expect(resultado).toMatchObject({
      ok: true,
      cortado_por_limite: true,
      mostrados: [{ codigo: "KRAFT" }],
    });
  });

  it("não inicia a vitrine quando nem um item inteiro cabe", async () => {
    const c = cenario({ maxSendsRestantes: () => 3 });
    const resultado = await executarVitrine(c.args);
    expect(resultado).toMatchObject({
      ok: false,
      cortado_por_limite: true,
      error: { code: "max_sends_per_turn" },
    });
    expect(c.ordem).toEqual([]);
  });

  it("falha de produto não envia o fechamento", async () => {
    const c = cenario({
      enviarItem: vi.fn(async (item: { codigo: string }) => {
        c.ordem.push(`fotos:${item.codigo}`);
        return { ok: false, error: { code: "photo_failed", message: "foto falhou" } };
      }),
    });
    const resultado = await executarVitrine(c.args);
    expect(resultado).toMatchObject({ ok: false, error: { code: "photo_failed" } });
    expect(c.ordem).toEqual(["intro", "fotos:KRAFT"]);
  });

  it("fica opt-in e o sandbox usa a porta simulada sem canal real", () => {
    const fonte = fs.readFileSync(
      path.join(process.cwd(), "lib", "agent-engine", "agent", "inbound-turn.ts"),
      "utf8",
    );
    expect(fonte).toMatch(/toolIds\.includes\('crm_send_vitrine'\)[\s\S]{0,120}Object\.keys\(agentConfig\.vitrines\)\.length > 0/);
    expect(fonte).toMatch(/emSandbox[\s\S]{0,8000}simularEnvioDeItemDoCatalogo/);
    expect(fonte).toContain("preview.result.envios.push");
  });
});
