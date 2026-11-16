import { randomBytes } from "node:crypto";

const TAMANHO_ALEATORIO = 10;

function prefixoDaSala(value: string): string {
  const normalizado = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");
  return normalizado || "reuniao";
}

/** Cria uma sala não enumerável, legível e sem depender de um provedor autenticado. */
export function gerarJitsiVideoUrl(titulo: string): string {
  const sufixo = randomBytes(TAMANHO_ALEATORIO).toString("hex");
  return `https://meet.jit.si/${prefixoDaSala(titulo)}-${sufixo}`;
}

/** Aceita somente uma sala direta do domínio oficial, sem parâmetros ou credenciais. */
export function jitsiVideoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "meet.jit.si" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
