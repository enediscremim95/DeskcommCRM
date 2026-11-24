/**
 * Qual e-mail vira CONVIDADO do evento do Google quando a IA marca um horário.
 *
 * Opt-in por tipo de agendamento (`calendar_event_types.guest_invite_enabled`,
 * migration 0320). Desligado = comportamento de antes, sem convidado — mesmo
 * que o modelo mande um e-mail. Ligado: o e-mail que o cliente informou na
 * conversa vence; sem ele, o e-mail do contato no CRM; sem nenhum, segue sem
 * convidado (o horário é marcado do mesmo jeito).
 *
 * Quem transforma `guest_email` em convite é o worker de push do Google
 * (`lib/agenda/google/sync-executor.ts`, `participantes`), que escreve com
 * `sendUpdates=all` (`transport.ts`) — é o Google que manda o e-mail. Conexão
 * do Google desconectada: o compromisso é marcado e o e-mail fica guardado em
 * `guest_email`, mas convite nenhum sai até a conexão voltar (o push fica
 * pendente, comportamento atual do sync). Nada aqui mexe em OAuth.
 */
import { z } from "zod";

const email = z.email().max(254);

export type OrigemDoConvite = "desligado" | "informado" | "contato" | "sem_email" | "invalido";

export function resolverEmailDoConvidado(input: {
  ligado: boolean;
  informado?: string | null;
  doContato?: string | null;
}): { email: string | null; origem: OrigemDoConvite } {
  if (!input.ligado) return { email: null, origem: "desligado" };
  const informado = input.informado?.trim().toLowerCase();
  if (informado) {
    return email.safeParse(informado).success
      ? { email: informado, origem: "informado" }
      : { email: null, origem: "invalido" };
  }
  const doContato = input.doContato?.trim().toLowerCase();
  if (doContato && email.safeParse(doContato).success) return { email: doContato, origem: "contato" };
  return { email: null, origem: "sem_email" };
}
