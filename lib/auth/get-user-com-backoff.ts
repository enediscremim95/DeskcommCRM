import { logger } from "@/lib/logger";
/** Falha de infraestrutura nunca significa sessão recusada. Compatível com proxy. */
export function ehSessaoAusente(error: unknown): boolean {
  return campo(error, "name") === "AuthSessionMissingError";
}

function campo(error: unknown, key: string): unknown {
  return error && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
}

const RECUSA_SESSAO_MORTA = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
  "session_not_found",
  "bad_jwt",
  "invalid_grant",
]);

export function ehAuthRecusada(error: unknown): boolean {
  if (ehSessaoAusente(error) || campo(error, "status") === 401 || campo(error, "status") === 403) return true;
  // Refresh token morto / JWT inválido: o SDK já considera sessão encerrada (auth-js 2.114).
  // Sem isto, um 400 vira 503 eterno e o cookie podre nunca é limpo.
  return RECUSA_SESSAO_MORTA.has(String(campo(error, "code") ?? ""));
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

/** Páginas públicas devem renderizar mesmo se o Auth estiver indisponível. */
export async function getUserPublico<T extends { data: { user: unknown }; error: unknown }>(
  getUser: () => Promise<T>,
  esperar?: (ms: number) => Promise<void>,
): Promise<T> {
  try {
    return await getUserComBackoff(getUser, esperar);
  } catch (error) {
    if (!(error instanceof AuthTemporariamenteIndisponivel)) throw error;
    return { data: { user: null }, error: null } as T;
  }
}
