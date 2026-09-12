"use client";
import * as React from "react";
import {
  APPEARANCE_STORAGE_KEY,
  resolveAppearance,
  type Appearance,
  type Theme,
  type ResolvedTheme,
} from "./appearance";
export type { Appearance, Theme, ResolvedTheme } from "./appearance";
export { APPEARANCE_STORAGE_KEY } from "./appearance";
export const STORAGE_KEY = "deskcomm-theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};
const ThemeContext = React.createContext<ThemeContextValue | null>(null);
type Preference = { appearance: string | null; theme: string | null };
const serverPreference: Preference = { appearance: null, theme: null };
let preferenceCache: Preference | null = null;
const preferenceListeners = new Set<() => void>();
function readPreference(): Preference {
  try {
    return {
      appearance: window.localStorage.getItem(APPEARANCE_STORAGE_KEY),
      theme: window.localStorage.getItem(STORAGE_KEY),
    };
  } catch {
    return serverPreference;
  }
}
function getPreference() {
  return (preferenceCache ??= readPreference());
}
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY && event.key !== APPEARANCE_STORAGE_KEY)
    return;
  preferenceCache = readPreference();
  preferenceListeners.forEach((listener) => listener());
}
function subscribePreference(listener: () => void) {
  if (!preferenceListeners.size) window.addEventListener("storage", onStorage);
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
    if (!preferenceListeners.size) window.removeEventListener("storage", onStorage);
  };
}
function savePreference(preference: Preference) {
  preferenceCache = preference;
  try {
    if (preference.appearance)
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference.appearance);
    else window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    if (preference.theme) window.localStorage.setItem(STORAGE_KEY, preference.theme);
  } catch {
    /* A escolha funciona mesmo sem persistência disponível. */
  }
  preferenceListeners.forEach((listener) => listener());
}
function getSystemTheme(): ResolvedTheme {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
function subscribeSystem(listener: () => void) {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Snapshot fixo: ícones e labels hidratam com os mesmos valores do SSR.
  const preference = React.useSyncExternalStore(
    subscribePreference,
    getPreference,
    () => serverPreference,
  );
  const system = React.useSyncExternalStore(
    subscribeSystem,
    getSystemTheme,
    () => "light" as const,
  );
  const { theme, appearance, resolvedTheme } = resolveAppearance(
    preference.appearance,
    preference.theme,
    system,
  );
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.setAttribute("data-appearance", appearance);
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [appearance, resolvedTheme]);
  const setAppearance = React.useCallback((next: Appearance) => {
    savePreference({ appearance: next, theme: next === "chatgpt-dark" ? "dark" : "light" });
  }, []);
  const setTheme = React.useCallback((next: Theme) => {
    savePreference({ appearance: null, theme: next });
  }, []);
  const toggle = React.useCallback(() => {
    const current = getPreference();
    const resolved = resolveAppearance(current.appearance, current.theme, getSystemTheme());
    savePreference({
      appearance: null,
      theme: resolved.resolvedTheme === "dark" ? "light" : "dark",
    });
  }, []);
  const value = React.useMemo(
    () => ({ theme, resolvedTheme, appearance, setAppearance, setTheme, toggle }),
    [theme, resolvedTheme, appearance, setAppearance, setTheme, toggle],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within <ThemeProvider>");
  return context;
}
