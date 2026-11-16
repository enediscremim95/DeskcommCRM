/**
 * A ORGANIZAÇÃO ATIVA É POR ABA — o cookie `active_org` é só o "último escolhido".
 *
 * O cookie é compartilhado por todas as abas do navegador. Quem trocava de
 * organização na aba B mudava, sem querer, a organização da aba A: ao recarregar
 * A, ela mostrava a org de B (e pior: cada chamada de A passava a ler/gravar na
 * org de B). Agora cada aba lembra a SUA organização em `sessionStorage` (que é
 * por aba e sobrevive ao recarregamento) e a manda em `x-org-aba` em toda
 * requisição para a mesma origem — chamadas de API, Server Actions e a
 * navegação RSC do Next, que também passam por `window.fetch`.
 *
 * O servidor NUNCA confia no header: `resolveActiveOrg` só o aceita se for uma
 * organização de que o usuário é membro (mesma lista do cookie). Header inválido
 * cai no cookie. Este arquivo é seguro para o cliente (sem `next/headers`).
 */
export const HEADER_ORG_DA_ABA = "x-org-aba";
export const CHAVE_ORG_DA_ABA = "crm:org-da-aba";
/** Marca "já tentei alinhar o cookie a esta aba": impede laço de recarga. */
export const CHAVE_ALINHAMENTO = "crm:org-da-aba:alinhando";
/** Cookie legível de vida curta: o servidor avisa "esta é a org nova da aba". */
export const COOKIE_ORG_NOVA_DA_ABA = "org_da_aba_nova";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehOrgId(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

type Armazem = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function armazemDaAba(): Armazem | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // modo privado/bloqueado: cai no cookie, como antes
  }
}

export function lerOrgDaAba(armazem: Armazem | null = armazemDaAba()): string | null {
  try {
    const valor = armazem?.getItem(CHAVE_ORG_DA_ABA);
    return ehOrgId(valor) ? valor : null;
  } catch {
    return null;
  }
}

export function gravarOrgDaAba(orgId: string, armazem: Armazem | null = armazemDaAba()): void {
  if (!ehOrgId(orgId)) return;
  try {
    armazem?.setItem(CHAVE_ORG_DA_ABA, orgId);
  } catch {
    /* cota/privado: sem persistência por aba, o servidor usa o cookie */
  }
}

type FetchFn = typeof fetch;
const MARCA = Symbol.for("crm.fetch-com-org-da-aba");

/**
 * Faz `window.fetch` anexar `x-org-aba` nas requisições para a MESMA origem.
 * Idempotente. Devolve a função que desfaz (usada nos testes).
 */
export function instalarFetchComOrgDaAba(alvo: typeof globalThis = globalThis): () => void {
  const win = alvo as typeof globalThis & { fetch?: FetchFn; location?: Location };
  const original = win.fetch;
  if (typeof original !== "function" || !win.location) return () => {};
  if ((original as unknown as Record<symbol, unknown>)[MARCA]) return () => {};

  const embrulhado = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const org = lerOrgDaAba();
    if (!org) return original.call(win, entrada, init);
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    let mesmaOrigem = false;
    try {
      mesmaOrigem = new URL(url, win.location!.href).origin === win.location!.origin;
    } catch {
      mesmaOrigem = false;
    }
    if (!mesmaOrigem) return original.call(win, entrada, init);
    const headers = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
    if (!headers.has(HEADER_ORG_DA_ABA)) headers.set(HEADER_ORG_DA_ABA, org);
    if (entrada instanceof Request) {
      return original.call(win, new Request(entrada, { ...init, headers }));
    }
    return original.call(win, entrada, { ...init, headers });
  }) as FetchFn;
  (embrulhado as unknown as Record<symbol, unknown>)[MARCA] = true;
  win.fetch = embrulhado;
  return () => {
    if (win.fetch === embrulhado) win.fetch = original;
  };
}

/** Lê um cookie legível (não httpOnly) do documento. */
export function lerCookieLegivel(nome: string, doc: Pick<Document, "cookie"> | null = typeof document === "undefined" ? null : document): string | null {
  const achado = doc?.cookie.split("; ").find((c) => c.startsWith(`${nome}=`));
  return achado ? decodeURIComponent(achado.slice(nome.length + 1)) : null;
}

export function apagarCookieLegivel(nome: string): void {
  if (typeof document !== "undefined") document.cookie = `${nome}=; Max-Age=0; path=/; SameSite=Strict`;
}
