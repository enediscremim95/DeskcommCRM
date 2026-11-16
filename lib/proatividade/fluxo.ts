import { emExpediente, type ConfigProatividade } from "./config";
export type Fase = "whatsapp" | "whatsapp_corrigido" | "email";
export type Resultado = "sent" | "failed" | "uncertain" | "started";
export interface Tentativa {
  phase: Fase;
  outcome: Resultado;
  created_at: string;
}
export interface PortasProatividade {
  /** Relê bloqueio, resposta humana/inbound, estado do card e configuração antes de cada efeito. */
  elegivel(): Promise<boolean>;
  reservar(phase: Fase): Promise<boolean>;
  enviar(phase: Fase): Promise<Exclude<Resultado, "started">>;
  concluir(phase: Fase, outcome: Resultado): Promise<void>;
  atencao(): Promise<void>;
}
/** Uma fase por tick; nenhuma espera prende o worker. A tabela única decide concorrência. */
export async function executarPasso(
  c: ConfigProatividade,
  timezone: string,
  attempts: Tentativa[],
  ports: PortasProatividade,
  now = new Date(),
): Promise<"done" | "retry"> {
  if (!c.enabled) return "done";
  if (!emExpediente(now, timezone, c)) return "retry";
  if (!(await ports.elegivel())) return "done";
  if (attempts.some((a) => a.outcome === "sent")) return "done";
  const active = attempts.find((a) => a.outcome === "started");
  if (active && now.getTime() - Date.parse(active.created_at) < 10 * 60_000) return "retry";
  if (active || attempts.some((a) => a.outcome === "uncertain")) {
    await ports.atencao();
    return "done";
  }
  const phases: Fase[] = ["whatsapp", "whatsapp_corrigido", "email"];
  const phase = phases.find((p) => !attempts.some((a) => a.phase === p));
  if (!phase || attempts.length >= c.max_attempts) {
    await ports.atencao();
    return "done";
  }
  if (!(await ports.reservar(phase))) return "retry";
  // Revalidar após o claim evita envio se o lead respondeu ou a org desligou no intervalo.
  if (!(await ports.elegivel())) {
    await ports.concluir(phase, "failed");
    return "done";
  }
  let outcome: Resultado;
  try {
    outcome = await ports.enviar(phase);
  } catch {
    outcome = "uncertain";
  }
  await ports.concluir(phase, outcome);
  if (outcome === "uncertain") {
    await ports.atencao();
    return "done";
  }
  if (outcome === "sent") return "done";
  if (attempts.length + 1 >= c.max_attempts || phase === "email") {
    await ports.atencao();
    return "done";
  }
  return "retry";
}
