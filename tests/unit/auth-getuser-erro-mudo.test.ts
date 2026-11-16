import { beforeEach, describe, expect, it, vi } from "vitest";

interface RespostaGetUser {
  data: { user: unknown };
  error: { name?: string; message: string; status?: number; code?: string } | null;
}

const resposta: { atual: RespostaGetUser } = {
  atual: { data: { user: null }, error: null },
};

const erros: { msg: string; ctx: unknown }[] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/logger", () => ({
  logger: {
    error: (msg: string, ctx: unknown) => erros.push({ msg, ctx }),
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => resposta.atual },
    from: () => {
      throw new Error("não deveria consultar tabela sem usuário");
    },
  }),
}));

const { loadAuthUser, ehSessaoAusente } = await import("@/lib/auth/server");

beforeEach(() => {
  erros.length = 0;
  resposta.atual = { data: { user: null }, error: null };
});

describe("loadAuthUser — o erro do getUser deixa rastro", () => {
  it("falha transitória do GoTrue REGISTRA, com a classe e o código", async () => {
    resposta.atual = {
      data: { user: null },
      error: {
        name: "AuthRetryableFetchError",
        code: "over_request_rate_limit",
        message: "fetch failed",
        status: 503,
      },
    };

    await expect(loadAuthUser()).rejects.toMatchObject({ name: "AuthTemporariamenteIndisponivel" });
    expect(erros).toHaveLength(1);
    expect(erros[0]!.msg).toContain("sessão preservada");
  });

  it("visitante SEM SESSÃO não registra nada — é o estado normal, não incidente", async () => {
    // O que o @supabase/auth-js 2.112.1 devolve com cookie store vazio, medido:
    //   user  = null
    //   error = AuthSessionMissingError: Auth session missing! (status=400)
    resposta.atual = {
      data: { user: null },
      error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 },
    };

    expect(await loadAuthUser()).toBeNull();
    expect(
      erros,
      "deslogado é o caminho normal de /app/*: logar como erro afoga a linha diagnóstica em tráfego anônimo",
    ).toEqual([]);
  });

  it("sem erro nenhum também não registra", async () => {
    resposta.atual = { data: { user: null }, error: null };

    expect(await loadAuthUser()).toBeNull();
    expect(erros).toEqual([]);
  });
});

describe("ehSessaoAusente — o predicado, isolado", () => {
  it("reconhece a sessão ausente pelo nome", () => {
    expect(ehSessaoAusente({ name: "AuthSessionMissingError" })).toBe(true);
  });

  it("não engole erro de rede nem de token", () => {
    expect(ehSessaoAusente({ name: "AuthRetryableFetchError" })).toBe(false);
    expect(ehSessaoAusente({ name: "AuthApiError" })).toBe(false);
  });

  it("tolera ausência de erro sem lançar", () => {
    expect(ehSessaoAusente(null)).toBe(false);
    expect(ehSessaoAusente(undefined)).toBe(false);
    expect(ehSessaoAusente({})).toBe(false);
  });
});

it.each([401, 403])("loadAuthUser recusa status %s", async (status) => {
  resposta.atual = { data: { user: null }, error: { status, message: "recusado" } };
  expect(await loadAuthUser()).toBeNull();
});
