/**
 * Falha TRANSITÓRIA da autenticação — o GoTrue não respondeu a tempo.
 *
 * Antes, `getUser()` não tinha prazo: o `auth-js` repete um refresh que falha por
 * rede por até ~30 s, e cada chamada do mesmo request (proxy, layout, página,
 * rotas) repetia isso em série. Resultado em produção: troca de organização
 * parada 40 s em "Carregando organização", link que "não responde" e, no fim,
 * `null` → redirect para o login (ou tela em branco). Aqui a espera tem teto e a
 * falha ganha nome: quem chama decide entre "tente de novo" e "deslogado".
 */
export const MENSAGEM_AUTH_INDISPONIVEL =
  "Autenticação temporariamente indisponível. Tente novamente em instantes.";

/** Teto de UMA chamada de `getUser()`. Acima disto a espera vira erro, não travamento. */
export const PRAZO_AUTH_MS = 8_000;

// Uma classe canônica mantém os consumidores e a proteção da base compatíveis.
export { AuthTemporariamenteIndisponivel as AuthIndisponivelError } from "./get-user-com-backoff";

interface ErroDeAuth { name?: string; status?: number | null; code?: string }

/** Rede, 5xx, 429 e estouro de prazo são transitórios; token inválido/ausente não. */
export function ehFalhaTransitoria(error: ErroDeAuth | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError" || error.name === "AuthTimeoutError") return true;
  if (error.name === "AuthSessionMissingError") return false;
  const status = error.status ?? 0;
  return status >= 500 || status === 429;
}

type RespostaGetUser<U> = { data: { user: U | null }; error: (ErroDeAuth & { message: string }) | null };

/** `getUser()` com prazo: estourou → erro `AuthTimeoutError` em vez de espera sem fim. */
export async function getUserComPrazo<U>(
  getUser: () => Promise<RespostaGetUser<U>>,
  prazoMs: number = PRAZO_AUTH_MS,
): Promise<RespostaGetUser<U>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<RespostaGetUser<U>>((resolve) => {
    timer = setTimeout(
      () => resolve({
        data: { user: null },
        error: { name: "AuthTimeoutError", message: `getUser excedeu ${prazoMs} ms`, status: 0 },
      }),
      prazoMs,
    );
  });
  try {
    return await Promise.race([getUser().catch((e: unknown): RespostaGetUser<U> => ({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", message: e instanceof Error ? e.message : String(e), status: 0 },
    })), estouro]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
