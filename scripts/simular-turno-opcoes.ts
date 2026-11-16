const SEPARADOR_DE_RAJADA = "|||";
const PASSO_ENTRE_MENSAGENS_MS = 1_000;

export function parseMensagensCli(input: {
  msg?: string;
  msgs?: string;
}): string[] {
  const temMsg = input.msg !== undefined;
  const temMsgs = input.msgs !== undefined;
  if (temMsg === temMsgs) {
    throw new Error("informe apenas uma opção: --msg ou --msgs");
  }

  const mensagens = (input.msgs ?? input.msg ?? "")
    .split(temMsgs ? SEPARADOR_DE_RAJADA : "\u0000")
    .map((mensagem) => mensagem.trim());
  if (mensagens.some((mensagem) => mensagem.length === 0)) {
    throw new Error("a rajada contém mensagem vazia entre os separadores |||");
  }
  return mensagens;
}

export function parseDepoisDe(value: string): number {
  const match = /^([1-9]\d*)([dhm])$/.exec(value.trim());
  if (!match) {
    throw new Error("--depois-de deve usar o formato 3d|5h|40m");
  }
  const quantidade = Number(match[1]);
  const unidade = match[2];
  const multiplicador =
    unidade === "d" ? 24 * 60 * 60 * 1_000 : unidade === "h" ? 60 * 60 * 1_000 : 60 * 1_000;
  return quantidade * multiplicador;
}

export function relogioInicialDoTurno(
  historico: ReadonlyArray<{ sent_at: string }>,
  depoisDeMs: number | undefined,
  agoraReal: Date,
): Date {
  const ultima = historico.at(-1);
  if (!ultima) {
    return new Date(agoraReal.getTime() + (depoisDeMs ?? 0));
  }

  const ultimaData = new Date(ultima.sent_at);
  if (depoisDeMs !== undefined) {
    return new Date(ultimaData.getTime() + depoisDeMs);
  }

  // Um cenário pode ter avançado para o futuro numa execução anterior. Voltar
  // silenciosamente ao relógio real faria a próxima mensagem aparecer antes da
  // resposta já gravada. Sem avanço explícito, usa "agora", mas nunca regride a
  // linha do tempo do arquivo.
  return new Date(
    Math.max(agoraReal.getTime(), ultimaData.getTime() + PASSO_ENTRE_MENSAGENS_MS),
  );
}

export function construirRajada(falas: readonly string[], inicio: Date): {
  mensagens: Array<{ direction: "inbound"; body: string; sent_at: string }>;
  relogioDoTurno: Date;
} {
  if (falas.length === 0) throw new Error("a rajada precisa de ao menos uma mensagem");
  const mensagens = falas.map((body, index) => ({
    direction: "inbound" as const,
    body,
    sent_at: new Date(inicio.getTime() + index * PASSO_ENTRE_MENSAGENS_MS).toISOString(),
  }));
  return {
    mensagens,
    relogioDoTurno: new Date(mensagens.at(-1)!.sent_at),
  };
}
