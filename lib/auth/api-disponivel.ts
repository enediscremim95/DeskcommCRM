import { fail } from "@/lib/api/wrappers";
import { AuthTemporariamenteIndisponivel } from "./get-user-com-backoff";

/** Mantém falhas de autenticação fora do contrato 401, inclusive em rotas públicas ao proxy. */
export function comAuthDisponivel<A extends unknown[], R>(handler: (...args: A) => Promise<R>) {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (!(error instanceof AuthTemporariamenteIndisponivel)) throw error;
      return fail("service_unavailable", error.message, 503, { headers: { "Retry-After": "1" } });
    }
  };
}
