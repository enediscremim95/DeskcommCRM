import { describe, expect, it, vi } from "vitest";

import {
  calcularEsperaInicialMs,
  calcularPlanoRitmoHumano,
  reagendarEm,
} from "@/lib/automation/ritmo-humano";

describe("ritmo humano das automation_rules", () => {
  it("mantém a espera inicial dentro de 40–100 segundos", () => {
    expect(calcularEsperaInicialMs(0)).toBe(40_000);
    expect(calcularEsperaInicialMs(0.5)).toBe(70_000);
    expect(calcularEsperaInicialMs(0.999_999)).toBeGreaterThanOrEqual(99_999);
    expect(calcularEsperaInicialMs(0.999_999)).toBeLessThan(100_000);
  });

  it("aplica 20s + 0,6s por caractere com variação de 0,9 a 1,2", () => {
    const minimo = calcularPlanoRitmoHumano(24, 0);
    const maximo = calcularPlanoRitmoHumano(24, 1);

    expect(minimo.alvo_ms).toBe(Math.round((20_000 + 24 * 600) * 0.9));
    expect(maximo.alvo_ms).toBe(Math.round((20_000 + 24 * 600) * 1.2));
  });

  it("limita o indicador digitando a 3–15s e preserva o alvo total", () => {
    const curta = calcularPlanoRitmoHumano(0, 0);
    const longa = calcularPlanoRitmoHumano(2_000, 1);

    expect(curta.digitando_ms).toBe(Math.round(curta.alvo_ms * 0.45));
    expect(longa.digitando_ms).toBe(15_000);
    expect(curta.digitando_ms + curta.restante_ms).toBe(curta.alvo_ms);
    expect(longa.digitando_ms + longa.restante_ms).toBe(longa.alvo_ms);
  });

  it("agenda no banco sem criar timer no processo", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    expect(reagendarEm(40_000, 1_000)).toBe("1970-01-01T00:00:41.000Z");
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
  });
});

