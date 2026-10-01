import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  agendarEncerramentoDoApp,
  avaliarAutoCuraBanco,
  criarArmazenamentoArquivo,
  type ArmazenamentoAutoCura,
} from "./auto-cura-banco";

function armazenamentoEmMemoria(): ArmazenamentoAutoCura {
  let estado = { versao: 1 as const, falhas_consecutivas_pool: 0, reinicios_em_ms: [] as number[] };
  return {
    async ler() {
      return { ...estado, reinicios_em_ms: [...estado.reinicios_em_ms] };
    },
    async salvar(novoEstado) {
      estado = { ...novoEstado, reinicios_em_ms: [...novoEstado.reinicios_em_ms] };
    },
  };
}

describe("auto-cura do banco", () => {
  beforeEach(() => vi.useRealTimers());

  it("uma falha isolada do pool não encerra o processo", async () => {
    const armazenamento = armazenamentoEmMemoria();
    const encerrar = vi.fn();

    const falha = await avaliarAutoCuraBanco({
      diagnostico: "pool_saturado",
      sonda_autorizada: true,
      armazenamento,
      ao_agendar_reinicio: encerrar,
    });
    const recuperou = await avaliarAutoCuraBanco({
      diagnostico: "ok",
      sonda_autorizada: true,
      armazenamento,
      ao_agendar_reinicio: encerrar,
    });

    expect(falha.estado.falhas_consecutivas_pool).toBe(1);
    expect(falha.deve_encerrar).toBe(false);
    expect(recuperou.estado.status).toBe("pronto");
    expect(encerrar).not.toHaveBeenCalled();
  });

  it("pool indisponível por três sondas consecutivas leva o processo a encerrar", async () => {
    const armazenamento = armazenamentoEmMemoria();
    const encerrar = vi.fn();

    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      await avaliarAutoCuraBanco({
        diagnostico: "pool_saturado",
        sonda_autorizada: true,
        armazenamento,
        ao_agendar_reinicio: encerrar,
      });
    }

    expect(encerrar).toHaveBeenCalledTimes(1);
  });

  it("banco fora de forma prolongada não cria laço e deixa o estado visível", async () => {
    const armazenamento = armazenamentoEmMemoria();
    const encerrar = vi.fn();
    let resultado;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      resultado = await avaliarAutoCuraBanco({
        diagnostico: "banco_indisponivel",
        sonda_autorizada: true,
        armazenamento,
        ao_agendar_reinicio: encerrar,
      });
    }

    expect(encerrar).not.toHaveBeenCalled();
    expect(resultado?.estado.status).toBe("banco_indisponivel_sem_reinicio");
    expect(resultado?.estado.diagnostico_atual).toBe("banco_indisponivel");
    expect(resultado?.estado.encerra_processo).toBe(false);
  });

  it("limita a três reinícios por hora mesmo se PGRST003 persistir", async () => {
    const armazenamento = armazenamentoEmMemoria();
    const encerrar = vi.fn();
    let resultado;

    for (let tentativa = 0; tentativa < 12; tentativa += 1) {
      resultado = await avaliarAutoCuraBanco({
        diagnostico: "pool_saturado",
        sonda_autorizada: true,
        agora_ms: 1_000 + tentativa,
        armazenamento,
        ao_agendar_reinicio: encerrar,
      });
    }

    expect(encerrar).toHaveBeenCalledTimes(3);
    expect(resultado?.estado.status).toBe("limite_de_reinicios_atingido");
    expect(resultado?.estado.reinicios_na_janela).toBe(3);
    expect(resultado?.estado.encerra_processo).toBe(false);
  });

  it("o orçamento de reinícios sobrevive a uma nova instância do processo", async () => {
    const diretorio = await mkdtemp(path.join(tmpdir(), "auto-cura-banco-"));
    const caminho = path.join(diretorio, "estado.json");
    const encerrar = vi.fn();
    try {
      const primeiroProcesso = criarArmazenamentoArquivo(caminho);
      for (let tentativa = 0; tentativa < 3; tentativa += 1) {
        await avaliarAutoCuraBanco({
          diagnostico: "pool_saturado",
          sonda_autorizada: true,
          agora_ms: 10_000 + tentativa,
          armazenamento: primeiroProcesso,
          ao_agendar_reinicio: encerrar,
        });
      }

      const novoProcesso = criarArmazenamentoArquivo(caminho);
      const estadoLido = await avaliarAutoCuraBanco({
        diagnostico: "pool_saturado",
        sonda_autorizada: false,
        agora_ms: 20_000,
        armazenamento: novoProcesso,
        ao_agendar_reinicio: encerrar,
      });

      expect(encerrar).toHaveBeenCalledTimes(1);
      expect(estadoLido.estado.reinicios_na_janela).toBe(1);
    } finally {
      await rm(diretorio, { recursive: true, force: true });
    }
  });

  it("não encerra se não consegue persistir o teto de segurança", async () => {
    const encerrar = vi.fn();
    const armazenamento: ArmazenamentoAutoCura = {
      async ler() {
        return { versao: 1, falhas_consecutivas_pool: 2, reinicios_em_ms: [] };
      },
      async salvar() {
        throw new Error("disco indisponível");
      },
    };

    const resultado = await avaliarAutoCuraBanco({
      diagnostico: "pool_saturado",
      sonda_autorizada: true,
      armazenamento,
      ao_agendar_reinicio: encerrar,
    });

    expect(resultado.estado.status).toBe("controle_indisponivel");
    expect(encerrar).not.toHaveBeenCalled();
  });

  it("o agendador chama process.exit(1) depois de a resposta poder sair", () => {
    vi.useFakeTimers();
    const encerrar = vi.fn();

    agendarEncerramentoDoApp(encerrar, 500);
    expect(encerrar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);

    expect(encerrar).toHaveBeenCalledWith(1);
  });
});
