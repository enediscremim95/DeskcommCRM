import { afterEach, describe, expect, it, vi } from "vitest";

import { criarFilaDeEnviosDoTurno } from "./fila-de-envios-do-turno";

afterEach(() => {
  vi.useRealTimers();
});

describe("fila FIFO das tools que enviam mensagem", () => {
  it("mantém 6 send_message na ordem de emissão em 50 rodadas, mesmo com cadeias de 0 a 300 ms", async () => {
    vi.useFakeTimers();
    let semente = 0x5eed;
    const proximoAtraso = () => {
      semente = (semente * 1664525 + 1013904223) >>> 0;
      return semente % 301;
    };

    for (let rodada = 0; rodada < 50; rodada += 1) {
      const fila = criarFilaDeEnviosDoTurno();
      const saidas: number[] = [];
      const chamadas = Array.from({ length: 6 }, (_, indice) =>
        fila.enfileirar(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, proximoAtraso()));
          saidas.push(indice);
          return indice;
        }),
      );

      await vi.runAllTimersAsync();
      await expect(Promise.all(chamadas)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
      expect(saidas).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it("libera a próxima operação quando a anterior lança", async () => {
    const fila = criarFilaDeEnviosDoTurno();
    const primeira = fila.enfileirar(async () => {
      throw new Error("falha simulada");
    });
    const segunda = fila.enfileirar(async () => "enviada");

    await expect(primeira).rejects.toThrow("falha simulada");
    await expect(segunda).resolves.toBe("enviada");
  });

  it("mantém idêntico o caminho antigo de um único send_message", async () => {
    const enviar = vi.fn(async (texto: string) => ({ ok: true, texto }));
    const esperado = await enviar("mensagem única");
    enviar.mockClear();

    const fila = criarFilaDeEnviosDoTurno();
    const recebido = await fila.enfileirar(() => enviar("mensagem única"));

    expect(recebido).toEqual(esperado);
    expect(enviar).toHaveBeenCalledOnce();
    expect(enviar).toHaveBeenCalledWith("mensagem única");
  });
});
