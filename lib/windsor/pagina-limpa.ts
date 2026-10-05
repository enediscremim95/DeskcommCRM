export type PaginaDestinoLimpa = {
  endereco: string;
  href: string;
};

/**
 * Remove parâmetros e fragmentos da página de destino sem lançar em URL inválida.
 * `endereco` mantém o formato já usado no PDF: domínio + caminho, sem protocolo.
 */
export function paginaDestinoLimpa(value: string): PaginaDestinoLimpa | null {
  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (!/^https?:$/.test(parsed.protocol)) return null;

    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    const endereco = `${parsed.hostname.toLocaleLowerCase("en-US")}${path}`;
    return {
      endereco,
      href: `${parsed.protocol}//${parsed.host}${path}`,
    };
  } catch {
    return null;
  }
}

/** Deduplica pelo mesmo endereço que aparece no PDF e na tela. */
export function paginasDestinoLimpas(values: Iterable<string>): PaginaDestinoLimpa[] {
  const pages = new Map<string, PaginaDestinoLimpa>();
  for (const value of values) {
    const page = paginaDestinoLimpa(value);
    if (page && !pages.has(page.endereco)) pages.set(page.endereco, page);
  }
  return [...pages.values()];
}
