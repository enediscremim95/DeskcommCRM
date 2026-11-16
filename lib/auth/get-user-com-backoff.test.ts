import { describe, expect, it, vi } from "vitest";
import { AuthTemporariamenteIndisponivel, ehAuthRecusada, ehErroTransitorioDeAuth, getUserComBackoff, getUserPublico } from "./get-user-com-backoff";

const resposta = (error: unknown) => ({ data: { user: null }, error });
describe("getUser sem destruir sessão", () => {
  it.each([
    { status: 504 }, { status: 503 }, { name: "AuthRetryableFetchError" },
    new TypeError("fetch failed"), new DOMException("timeout", "TimeoutError"),
    new Error("connect ECONNRESET"),
  ])("repete transiente e encerra como indisponível: %o", async (error) => {
    expect(ehErroTransitorioDeAuth(error)).toBe(true);
    const getUser = vi.fn().mockResolvedValue(resposta(error));
    const esperar = vi.fn().mockResolvedValue(undefined);
    await expect(getUserComBackoff(getUser, esperar)).rejects.toBeInstanceOf(AuthTemporariamenteIndisponivel);
    expect(getUser).toHaveBeenCalledTimes(3);
    expect(esperar.mock.calls).toEqual([[150], [300]]);
  });
  it("recupera na segunda tentativa", async () => {
    const sucesso = { data: { user: { id: "validado" } }, error: null };
    const getUser = vi.fn().mockResolvedValueOnce(resposta({ status: 504 })).mockResolvedValueOnce(sucesso);
    expect(await getUserComBackoff(getUser, async () => {})).toBe(sucesso);
    expect(getUser).toHaveBeenCalledTimes(2);
  });
  it("também repete exceção de rede", async () => {
    const getUser = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(getUserComBackoff(getUser, async () => {})).rejects.toBeInstanceOf(AuthTemporariamenteIndisponivel);
    expect(getUser).toHaveBeenCalledTimes(3);
  });
  it.each([
    { status: 401 }, { status: 403 }, { name: "AuthSessionMissingError", status: 400 },
    { status: 400, code: "refresh_token_not_found" },
    { status: 400, code: "refresh_token_already_used" },
    { status: 400, code: "session_expired" },
    { status: 400, code: "session_not_found" },
    { status: 400, code: "bad_jwt" },
    { status: 400, code: "invalid_grant" },
  ])("recusa real não repete: %o", async (error) => {
    expect(ehAuthRecusada(error)).toBe(true);
    expect(ehErroTransitorioDeAuth(error)).toBe(false);
    const getUser = vi.fn().mockResolvedValue(resposta(error));
    const esperar = vi.fn();
    expect(await getUserComBackoff(getUser, esperar)).toEqual(resposta(error));
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(esperar).not.toHaveBeenCalled();
  });
  it("erro desconhecido não vira visitante", async () => {
    await expect(getUserComBackoff(async () => resposta({ status: 400 }))).rejects.toBeInstanceOf(AuthTemporariamenteIndisponivel);
  });
  it("página pública renderiza na indisponibilidade", async () => {
    const getUser = vi.fn().mockResolvedValue(resposta({ status: 504 }));
    expect(await getUserPublico(getUser, async () => {})).toEqual({ data: { user: null }, error: null });
    expect(getUser).toHaveBeenCalledTimes(3);
  });
});

it.each([
  { status: 401 }, { status: 403 }, { name: "AuthSessionMissingError" },
  { status: 400, code: "refresh_token_not_found" },
])("normaliza recusa lançada: %o", async (error) => {
  const getUser = vi.fn().mockRejectedValue(error);
  expect(await getUserComBackoff(getUser)).toEqual({ data: { user: null }, error });
  expect(getUser).toHaveBeenCalledTimes(1);
});
