/**
 * Fila FIFO local ao turno. Cada chamada entra na cauda no instante em que a
 * tool é emitida, e a cauda é sempre liberada, inclusive após rejeição.
 */
export function criarFilaDeEnviosDoTurno() {
  let cauda: Promise<void> = Promise.resolve();

  return {
    enfileirar<T>(operacao: () => Promise<T>): Promise<T> {
      const execucao = cauda.then(operacao);
      cauda = execucao.then(
        () => undefined,
        () => undefined,
      );
      return execucao;
    },
  };
}
