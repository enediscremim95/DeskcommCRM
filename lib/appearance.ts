export type Appearance = "veritas" | "asaas" | "chatgpt-light" | "chatgpt-dark";
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export const APPEARANCE_STORAGE_KEY = "veritas-appearance";
export const APPEARANCES: readonly Appearance[] = [
  "veritas",
  "asaas",
  "chatgpt-light",
  "chatgpt-dark",
];

/** Sem dependências: a mesma resolução roda antes do paint e no React. */
export function resolveAppearance(
  stored: string | null,
  legacy: string | null,
  system: ResolvedTheme,
): { appearance: Appearance; theme: Theme; resolvedTheme: ResolvedTheme } {
  if (
    stored === "veritas" ||
    stored === "asaas" ||
    stored === "chatgpt-light" ||
    stored === "chatgpt-dark"
  ) {
    const resolvedTheme = stored === "chatgpt-dark" ? "dark" : "light";
    return { appearance: stored, theme: resolvedTheme, resolvedTheme };
  }
  if (legacy === "light" || legacy === "dark" || legacy === "system") {
    const resolvedTheme = legacy === "system" ? system : legacy;
    return {
      appearance: resolvedTheme === "dark" ? "chatgpt-dark" : "chatgpt-light",
      theme: legacy,
      resolvedTheme,
    };
  }
  return { appearance: "veritas", theme: "system", resolvedTheme: "light" };
}

/** Apenas constantes de código entram no script, nunca dados externos. */
export function createThemeInitScript(legacyStorageKey: string): string {
  return `(function(){var a=null,t=null,d=false;try{a=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});t=localStorage.getItem(${JSON.stringify(legacyStorageKey)});}catch(e){}try{d=window.matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){}var r=(${resolveAppearance.toString()})(a,t,d?'dark':'light');var h=document.documentElement;h.setAttribute('data-theme',r.resolvedTheme);h.setAttribute('data-appearance',r.appearance);h.style.colorScheme=r.resolvedTheme;})();`;
}
