const HOSTS_EXATOS = new Set([
  "produtos.sublimando.com.br",
  "sublimando-produtos.admsublimando.workers.dev",
]);

const SUFIXOS_PERMITIDOS = [
  ".yampi.io",
  ".yampi.com.br",
  ".bling.com.br",
  ".blingcdn.com.br",
] as const;

/** Lista fixa. Não existe variável de ambiente nem host fornecido pelo navegador. */
export function hostDeFotoPermitido(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (HOSTS_EXATOS.has(host)) return true;
  return SUFIXOS_PERMITIDOS.some((sufixo) => host.endsWith(sufixo) && host.length > sufixo.length);
}

export function urlDeFotoPermitida(valor: string): URL {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error("foto_url_invalida");
  }
  if (url.protocol !== "https:") throw new Error("foto_exige_https");
  if (url.username || url.password) throw new Error("foto_url_com_credencial");
  if (url.port && url.port !== "443") throw new Error("foto_porta_nao_permitida");
  if (!hostDeFotoPermitido(url.hostname)) throw new Error("foto_host_nao_permitido");
  return url;
}
