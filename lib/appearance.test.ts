import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  APPEARANCES,
  APPEARANCE_STORAGE_KEY,
  createThemeInitScript,
  resolveAppearance,
} from "./appearance";
import { STORAGE_KEY } from "./theme";

describe("preferência pessoal de aparência", () => {
  it("novos navegadores começam em Veritas mesmo com sistema escuro", () => {
    expect(resolveAppearance(null, null, "dark")).toEqual({
      appearance: "veritas",
      theme: "system",
      resolvedTheme: "light",
    });
  });
  it("preserva os três valores legados sem criar preferência explícita", () => {
    expect(resolveAppearance(null, "light", "dark").appearance).toBe("chatgpt-light");
    expect(resolveAppearance(null, "dark", "light").appearance).toBe("chatgpt-dark");
    expect(resolveAppearance(null, "system", "dark")).toEqual({
      appearance: "chatgpt-dark",
      theme: "system",
      resolvedTheme: "dark",
    });
    expect(resolveAppearance(null, "system", "light").appearance).toBe("chatgpt-light");
  });
  it.each(APPEARANCES)("escolha %s prevalece sobre tema legado e sistema", (appearance) => {
    expect(resolveAppearance(appearance, "system", "dark").appearance).toBe(appearance);
    expect(resolveAppearance(appearance, "dark", "dark").resolvedTheme).toBe(
      appearance === "chatgpt-dark" ? "dark" : "light",
    );
  });
  it("valores inválidos degradam sem propagar dados para o DOM", () => {
    expect(resolveAppearance("<script>", "invalid", "dark").appearance).toBe("veritas");
  });
  it("bootstrap e React concordam em todas as combinações sem gravar storage", () => {
    for (const appearance of [null, "invalid", ...APPEARANCES]) {
      for (const legacy of [null, "invalid", "light", "dark", "system"]) {
        for (const system of ["light", "dark"] as const) {
          const attributes: Record<string, string> = {};
          const style = { colorScheme: "" };
          runInNewContext(createThemeInitScript(STORAGE_KEY), {
            localStorage: {
              getItem: (key: string) => (key === APPEARANCE_STORAGE_KEY ? appearance : legacy),
            },
            window: { matchMedia: () => ({ matches: system === "dark" }) },
            document: {
              documentElement: {
                style,
                setAttribute: (key: string, value: string) => {
                  attributes[key] = value;
                },
              },
            },
          });
          const expected = resolveAppearance(appearance, legacy, system);
          expect(attributes).toEqual({
            "data-theme": expected.resolvedTheme,
            "data-appearance": expected.appearance,
          });
          expect(style.colorScheme).toBe(expected.resolvedTheme);
        }
      }
    }
  });
  it("bootstrap funciona com storage bloqueado e sem matchMedia", () => {
    const attributes: Record<string, string> = {};
    runInNewContext(createThemeInitScript(STORAGE_KEY), {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      window: {},
      document: {
        documentElement: {
          style: {},
          setAttribute: (key: string, value: string) => {
            attributes[key] = value;
          },
        },
      },
    });
    expect(attributes).toEqual({ "data-theme": "light", "data-appearance": "veritas" });
  });
});
