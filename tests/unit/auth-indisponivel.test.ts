import { describe, expect, it, vi } from "vitest";

import {
  AuthIndisponivelError,
  ehFalhaTransitoria,
  getUserComPrazo,
  MENSAGEM_AUTH_INDISPONIVEL,
} from "@/lib/auth/auth-indisponivel";
import { comPrazo } from "@/components/shell/TenantSwitcher";

describe("ehFalhaTransitoria", () => {
  it("rede, 5xx, 429 e prazo estourado são transitórios", () => {
    expect(ehFalhaTransitoria({ name: "AuthRetryableFetchError" })).toBe(true);
    expect(ehFalhaTransitoria({ name: "AuthTimeoutError" })).toBe(true);
    expect(ehFalhaTransitoria({ name: "AuthApiError", status: 503 })).toBe(true);
    expect(ehFalhaTransitoria({ name: "AuthApiError", status: 429 })).toBe(true);
  });
  it("sessão ausente e token inválido NÃO são — esses deslogam de verdade", () => {
    expect(ehFalhaTransitoria({ name: "AuthSessionMissingError", status: 400 })).toBe(false);
    expect(ehFalhaTransitoria({ name: "AuthApiError", status: 401 })).toBe(false);
    expect(ehFalhaTransitoria(null)).toBe(false);
  });
});

describe("getUserComPrazo — o getUser que travava 30 s agora tem teto", () => {
  it("estouro vira AuthTimeoutError em vez de espera sem fim", async () => {
    vi.useFakeTimers();
    try {
      const preso = getUserComPrazo(() => new Promise<never>(() => {}), 8_000);
      await vi.advanceTimersByTimeAsync(8_000);
      const r = await preso;
      expect(r.data.user).toBeNull();
      expect(r.error?.name).toBe("AuthTimeoutError");
      expect(ehFalhaTransitoria(r.error)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("resposta rápida passa intacta e não deixa timer pendente", async () => {
    vi.useFakeTimers();
    try {
      const r = await getUserComPrazo(async () => ({ data: { user: { id: "u" } }, error: null }));
      expect(r.data.user).toEqual({ id: "u" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("exceção de rede vira erro transitório, não propaga", async () => {
    const r = await getUserComPrazo(async () => { throw new Error("fetch failed"); });
    expect(ehFalhaTransitoria(r.error)).toBe(true);
  });
  it("a mensagem é a que a tela mostra", () => {
    expect(new AuthIndisponivelError().message).toContain(MENSAGEM_AUTH_INDISPONIVEL);
  });
});

describe("comPrazo — a troca de organização não fica presa no 'Carregando'", () => {
  it("rejeita ao estourar e limpa o timer ao resolver", async () => {
    vi.useFakeTimers();
    try {
      const presa = comPrazo(new Promise<string>(() => {}), 20_000);
      const visto = expect(presa).rejects.toThrow("troca_excedeu_o_prazo");
      await vi.advanceTimersByTimeAsync(20_000);
      await visto;
      await expect(comPrazo(Promise.resolve("ok"), 20_000)).resolves.toBe("ok");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Guarda a integração com o backoff já publicado, inclusive no caminho do proxy.
describe("prazo total da autenticação com backoff", () => {
  it("encerra uma chamada presa em oito segundos sem aceitar uma identidade", async () => {
    vi.useFakeTimers();
    try {
      const { getUserComBackoff } = await import("@/lib/auth/get-user-com-backoff");
      const chamada = getUserComBackoff(() => new Promise<{ error: unknown }>(() => {}));
      const resultado = expect(chamada).rejects.toBeInstanceOf(AuthIndisponivelError);
      await vi.advanceTimersByTimeAsync(8_000);
      await resultado;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
