import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { VitrinesConfig } from "@/lib/ai/guardrails-schema";
import { criarFilaDeEnviosDoTurno } from "./fila-de-envios-do-turno";
import { executarVitrine } from "./send-vitrine";
import { executarVitrinePorGatilho, mensagemContemGatilho } from "./vitrine-por-gatilho";

const vitrines: VitrinesConfig = {
  louca_crista: {
    gatilhos: ["louca", "louca crista"],
    intro: "Separei uma opção para você.",
    fechamento: "Gostou desta opção?",
    itens: [{ codigo: "LOUCA-1", titulo: "Louça cristã", fotos: 1 }],
  },
  natal: {
    gatilhos: ["presente de natal"],
    itens: [{ codigo: "NATAL-1", titulo: "Kit de Natal", fotos: 1 }],
  },
};

const devemDisparar = [
  "Queria uma louça de presente.",
  "Você tem LOUÇA?",
  "Vocês têm louça?",
  "Tenho interesse em louça.",
  "Pode me mostrar uma louça?",
  "Preciso de uma louça para presente.",
  "Estou procurando louça.",
  "Fala mais dessa louça.",
  "Uma louça seria uma boa opção.",
  "Quero ver preço de louça.",
];

const naoDevemDisparar = [
  "Não quero louça.",
  "Nao quero uma louca.",
  "Quero presente sem louça.",
  "Nunca compraria louça.",
  "Deixa pra lá a louça.",
  "Sem querer falei louça.",
  "Não quero mesmo essa louça.",
  "Nada de louça para mim.",
  "Minha sogra tem louça.",
  "A loja de louçaria fica perto.",
];

function base(
  overrides: Partial<Parameters<typeof executarVitrinePorGatilho>[0]> = {},
): Parameters<typeof executarVitrinePorGatilho>[0] {
  return {
    ativa: true,
    ferramentaDisponivel: true,
    vitrines,
    mensagensDoCliente: ["Queria uma louça de presente."],
    assuntosChamadosNesteTurno: new Set(),
    emAtendimentoHumano: async () => false,
    assuntoJaMostrado: async () => false,
    executar: async () => ({ ok: true, mostrados: [{ codigo: "LOUCA-1" }] }),
    log: { info: vi.fn() },
    ...overrides,
  };
}

describe("matching literal da vitrine por gatilho", () => {
  it.each(devemDisparar)("dispara: %s", (frase) => {
    expect(mensagemContemGatilho(frase, "louca")).toBe(true);
  });

  it.each(naoDevemDisparar)("não dispara: %s", (frase) => {
    expect(mensagemContemGatilho(frase, "louca")).toBe(false);
  });

  it("compara expressão inteira, sem casar fragmento ou expressão incompleta", () => {
    expect(mensagemContemGatilho("Quero uma louça cristã.", "louca crista")).toBe(true);
    expect(mensagemContemGatilho("Quero uma louça.", "louca crista")).toBe(false);
    expect(mensagemContemGatilho("Quero uma louça cristalina.", "louca crista")).toBe(false);
  });
});

describe("execução determinística no fim do turno", () => {
  it("fica desligada por padrão e exige a ferramenta no agente", async () => {
    const executar = vi.fn(async () => ({ ok: true }));
    await expect(executarVitrinePorGatilho(base({ ativa: false, executar }))).resolves.toEqual({
      status: "desligada",
    });
    await expect(
      executarVitrinePorGatilho(base({ ferramentaDisponivel: false, executar })),
    ).resolves.toEqual({ status: "sem_ferramenta" });
    expect(executar).not.toHaveBeenCalled();
  });

  it("não dispara em atendimento humano, assunto já mostrado ou já chamado pelo agente", async () => {
    const executar = vi.fn(async () => ({ ok: true }));
    await expect(
      executarVitrinePorGatilho(base({ emAtendimentoHumano: async () => true, executar })),
    ).resolves.toEqual({ status: "atendimento_humano" });
    await expect(
      executarVitrinePorGatilho(base({ assuntoJaMostrado: async () => true, executar })),
    ).resolves.toEqual({ status: "sem_assunto_novo" });
    await expect(
      executarVitrinePorGatilho(
        base({ assuntosChamadosNesteTurno: new Set(["louca_crista"]), executar }),
      ),
    ).resolves.toEqual({ status: "sem_assunto_novo" });
    expect(executar).not.toHaveBeenCalled();
  });

  it("lê a mensagem pinada e a rajada pendente e escolhe só o primeiro assunto na ordem da tabela", async () => {
    const executar = vi.fn(async (assunto: string) => ({
      ok: true,
      mostrados: [{ codigo: assunto }],
    }));
    const resultado = await executarVitrinePorGatilho(
      base({
        mensagensDoCliente: [
          "Queria uma louça cristã.",
          "Também estou procurando presente de Natal.",
        ],
        executar,
      }),
    );

    expect(resultado).toMatchObject({ status: "executada", assunto: "louca_crista" });
    expect(executar).toHaveBeenCalledOnce();
    expect(executar).toHaveBeenCalledWith("louca_crista");
  });

  it("executa uma vez por assunto por conversa usando o registro de produtos já mostrados", async () => {
    const mostrados = new Set<string>();
    const executar = vi.fn(async (assunto: string) => {
      mostrados.add(assunto);
      return { ok: true, mostrados: [{ codigo: assunto }] };
    });
    const args = base({
      assuntoJaMostrado: async (assunto) => mostrados.has(assunto),
      executar,
    });

    expect(await executarVitrinePorGatilho(args)).toMatchObject({ status: "executada" });
    expect(await executarVitrinePorGatilho(args)).toEqual({ status: "sem_assunto_novo" });
    expect(executar).toHaveBeenCalledOnce();
  });

  it("entra depois das mensagens do agente na mesma fila FIFO", async () => {
    const fila = criarFilaDeEnviosDoTurno();
    const ordem: string[] = [];
    let liberar!: () => void;
    const bloqueio = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const falaDoAgente = fila.enfileirar(async () => {
      ordem.push("agente-inicio");
      await bloqueio;
      ordem.push("agente-fim");
    });
    const gatilho = executarVitrinePorGatilho(
      base({
        executar: () =>
          fila.enfileirar(async () => {
            ordem.push("vitrine");
            return { ok: true, mostrados: [] };
          }),
      }),
    );

    await Promise.resolve();
    liberar();
    await Promise.all([falaDoAgente, gatilho]);
    expect(ordem).toEqual(["agente-inicio", "agente-fim", "vitrine"]);
  });

  it("respeita o teto físico do executor compartilhado e não envia produto pela metade", async () => {
    const ordem: string[] = [];
    const resultado = await executarVitrinePorGatilho(
      base({
        executar: (assunto) =>
          executarVitrine({
            input: { assunto },
            vitrines,
            maxSendsRestantes: () => 2,
            produtosJaEnviadosNoTurno: 0,
            imagensJaEnviadasNoTurno: 0,
            textoConsumiraEnvio: () => true,
            inspecionarItem: async () => ({
              status: "ready",
              produtoCodigo: "PAI-LOUCA",
              mensagensFisicas: 1,
              precoResumo: "R$ 99,90",
            }),
            enviarTexto: async (_body, papel) => {
              ordem.push(papel);
              return { status: "sent" };
            },
            enviarItem: async () => {
              ordem.push("foto");
              return { ok: true };
            },
          }),
      }),
    );

    expect(resultado).toMatchObject({ status: "executada", ok: false });
    expect(ordem).toEqual([]);
  });

  it("no sandbox registra vitrine_por_gatilho e as fotos simuladas, sem rede", async () => {
    const envios: Array<Record<string, unknown>> = [];
    const rastros: Array<Record<string, unknown>> = [];
    await executarVitrinePorGatilho(
      base({
        executar: (assunto) =>
          executarVitrine({
            input: { assunto },
            vitrines,
            maxSendsRestantes: () => 3,
            produtosJaEnviadosNoTurno: 0,
            imagensJaEnviadasNoTurno: 0,
            textoConsumiraEnvio: () => true,
            inspecionarItem: async () => ({
              status: "ready",
              produtoCodigo: "PAI-LOUCA",
              mensagensFisicas: 1,
              precoResumo: "R$ 99,90",
            }),
            enviarTexto: async (texto, papel) => {
              envios.push({ tipo: "texto", papel, texto });
              return { status: "sent" };
            },
            enviarItem: async () => {
              envios.push({
                produtoCodigo: "PAI-LOUCA",
                imagens: [{ nome: "louca.jpg", url: "sandbox://louca.jpg" }],
              });
              return { ok: true, ja_enviado: false };
            },
          }),
        registrarRastro: (rastro) => rastros.push({ tool: "vitrine_por_gatilho", ...rastro }),
      }),
    );

    expect(rastros).toEqual([
      { tool: "vitrine_por_gatilho", assunto: "louca_crista", ok: true, produtosMostrados: 1 },
    ]);
    expect(envios).toEqual([
      { tipo: "texto", papel: "intro", texto: "Separei uma opção para você." },
      {
        produtoCodigo: "PAI-LOUCA",
        imagens: [{ nome: "louca.jpg", url: "sandbox://louca.jpg" }],
      },
      { tipo: "texto", papel: "fechamento", texto: "Gostou desta opção?" },
    ]);
  });

  it("turno real e sandbox passam pelo mesmo helper e pelo mesmo executor da vitrine", () => {
    const fonte = fs.readFileSync(
      path.join(process.cwd(), "lib", "agent-engine", "agent", "inbound-turn.ts"),
      "utf8",
    );
    expect(fonte.match(/await executarVitrinePorGatilho\(/g)).toHaveLength(1);
    expect(fonte).toContain("execute: (raw) => executarVitrineNoTurno!(raw, 'modelo')");
    expect(fonte).toContain("executarVitrineNoTurno!({ assunto }, 'gatilho')");
    const inicioDoTurno = fonte.indexOf('const turn = await runModelCall(');
    const pontoDoGatilho = fonte.indexOf('await executarVitrinePorGatilho(', inicioDoTurno);
    const fechamento = fonte.indexOf('const closing = await runModelCall(', pontoDoGatilho);
    expect(pontoDoGatilho).toBeGreaterThan(inicioDoTurno);
    expect(pontoDoGatilho).toBeLessThan(fechamento);
  });
});
