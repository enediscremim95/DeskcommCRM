import { logger } from "@/lib/logger";
/** Falha de infraestrutura nunca significa sessão recusada. Compatível com proxy. */
export function ehSessaoAusente(error: unknown): boolean {
  return campo(error, "name") === "AuthSessionMissingError";
}

function campo(error: unknown, key: string): unknown {
  return error && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
}

export function ehAuthRecusada(error: unknown): boolean {
  return ehSessaoAusente(error) || campo(error, "status") === 401 || campo(error, "status") === 403;
}

export function ehErroTransitorioDeAuth(error: unknown): boolean {
  if (!error || ehAuthRecusada(error)) return false;
  const status = campo(error, "status");
  const name = campo(error, "name");
  return (typeof status === "number" && (status >= 500 || status === 429 || status === 408 || status === 0)) ||
    ["AuthRetryableFetchError", "TimeoutError", "AbortError"].includes(String(name)) ||
    (name === "TypeError" && /fetch|network|load failed/i.test(String(campo(error, "message")))) ||
    /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|network|fetch failed/i.test(`${campo(error, "code")} ${campo(error, "message")}`);
}

export class AuthTemporariamenteIndisponivel extends Error {
  constructor() {
    super("Autenticação temporariamente indisponível. Tente novamente em instantes.");
    this.name = "AuthTemporariamenteIndisponivel";
    logger.error("[auth] getUser indisponível — sessão preservada");
  }
}

/** Três chamadas no máximo; sem aceitar identidade não validada nem devolver null por falha. */
export async function getUserComBackoff<T extends { error: unknown }>(
  getUser: () => Promise<T>,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let resultado: T;
    try {
      resultado = await getUser();
    } catch (error) {
      if (ehAuthRecusada(error)) {
        // Mesma resposta do SDK quando uma recusa chega como exceção.
        return { data: { user: null }, error } as unknown as T;
      }
      if (!ehErroTransitorioDeAuth(error) || tentativa === 2) throw new AuthTemporariamenteIndisponivel();
      await esperar(150 * 2 ** tentativa);
      continue;
    }
    if (!resultado.error || ehAuthRecusada(resultado.error)) return resultado;
    if (!ehErroTransitorioDeAuth(resultado.error) || tentativa === 2) throw new AuthTemporariamenteIndisponivel();
    await esperar(150 * 2 ** tentativa);
  }
  throw new AuthTemporariamenteIndisponivel();
}
