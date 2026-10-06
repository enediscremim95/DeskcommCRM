import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { FOLGA_INFERIOR_QUADRO_PX, useAlturaAteORodape } from "./useAlturaAteORodape";

type OuvinteDaMedia = (evento: MediaQueryListEvent) => void;

const estado = vi.hoisted(() => ({
  desktop: true,
  ouvintesDaMedia: new Set<OuvinteDaMedia>(),
  observadores: [] as Array<{
    callback: ResizeObserverCallback;
    observe: Mock<(target: Element) => void>;
    disconnect: Mock<() => void>;
  }>,
}));

function Quadro({ alturaInicial, flexInicial }: { alturaInicial?: string; flexInicial?: string }) {
  const ref = useAlturaAteORodape<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="quadro" style={{ height: alturaInicial, flex: flexInicial }} />
  );
}

function QuadroComAncestrais() {
  const ref = useAlturaAteORodape<HTMLDivElement>();
  return (
    <div data-testid="ancestral-externo">
      <div data-testid="ancestral-interno">
        <div ref={ref} data-testid="quadro" />
      </div>
    </div>
  );
}

beforeEach(() => {
  estado.desktop = true;
  estado.ouvintesDaMedia.clear();
  estado.observadores.length = 0;
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 900,
    writable: true,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 180,
    bottom: 300,
    left: 0,
    right: 400,
    width: 400,
    height: 120,
    x: 0,
    y: 180,
    toJSON: () => ({}),
  });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    paddingBottom: "0px",
    borderBottomWidth: "0px",
  } as CSSStyleDeclaration);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: estado.desktop,
      media: query,
      onchange: null,
      addEventListener: (_tipo: string, ouvinte: OuvinteDaMedia) =>
        estado.ouvintesDaMedia.add(ouvinte),
      removeEventListener: (_tipo: string, ouvinte: OuvinteDaMedia) =>
        estado.ouvintesDaMedia.delete(ouvinte),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly registro: (typeof estado.observadores)[number];

      constructor(callback: ResizeObserverCallback) {
        this.registro = {
          callback,
          observe: vi.fn<(target: Element) => void>(),
          disconnect: vi.fn<() => void>(),
        };
        estado.observadores.push(this.registro);
      }

      observe = (target: Element) => this.registro.observe(target);
      unobserve = vi.fn();
      disconnect = () => this.registro.disconnect();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useAlturaAteORodape", () => {
  it("aplica em md+ a altura real restante e impede o flex de prevalecer", () => {
    const view = render(<Quadro />);
    const quadro = view.getByTestId("quadro");

    expect(quadro.style.height).toBe(`${900 - 180 - FOLGA_INFERIOR_QUADRO_PX}px`);
    expect(quadro.style.flex).toBe("0 0 auto");
  });

  it("remove altura e flex abaixo de md", () => {
    estado.desktop = false;
    const view = render(<Quadro alturaInicial="123px" flexInicial="1 1 0%" />);
    const quadro = view.getByTestId("quadro");

    expect(quadro.style.height).toBe("");
    expect(quadro.style.flex).toBe("");
  });

  it("desconta padding-bottom e border-bottom dos ancestrais, exceto o body", () => {
    vi.mocked(window.getComputedStyle).mockImplementation((elemento) => {
      const testId = elemento.getAttribute("data-testid");
      const medidas =
        testId === "ancestral-interno"
          ? { paddingBottom: "24.5px", borderBottomWidth: "1.5px" }
          : testId === "ancestral-externo"
            ? { paddingBottom: "8px", borderBottomWidth: "2px" }
            : elemento === document.body
              ? { paddingBottom: "100px", borderBottomWidth: "100px" }
              : { paddingBottom: "auto", borderBottomWidth: "invalido" };

      return medidas as CSSStyleDeclaration;
    });

    const view = render(<QuadroComAncestrais />);

    const quadro = view.getByTestId("quadro");
    expect(quadro.style.height).toBe(`${900 - 180 - 36 - FOLGA_INFERIOR_QUADRO_PX}px`);
    expect(quadro.style.flex).toBe("0 0 auto");
  });

  it("recalcula no resize e quando o conteúdo anterior muda", () => {
    const view = render(<Quadro />);
    const quadro = view.getByTestId("quadro");

    act(() => {
      window.innerHeight = 760;
      window.dispatchEvent(new Event("resize"));
    });
    expect(quadro.style.height).toBe(`${760 - 180 - FOLGA_INFERIOR_QUADRO_PX}px`);

    vi.mocked(quadro.getBoundingClientRect).mockReturnValue({
      top: 220,
      bottom: 340,
      left: 0,
      right: 400,
      width: 400,
      height: 120,
      x: 0,
      y: 220,
      toJSON: () => ({}),
    });
    act(() =>
      estado.observadores[0]!.callback([], estado.observadores[0] as unknown as ResizeObserver),
    );
    expect(quadro.style.height).toBe(`${760 - 220 - FOLGA_INFERIOR_QUADRO_PX}px`);
  });

  it("limpa listeners e o ResizeObserver ao desmontar", () => {
    const remover = vi.spyOn(window, "removeEventListener");
    const view = render(<Quadro />);
    const quadro = view.getByTestId("quadro");
    const observador = estado.observadores[0]!;

    expect(quadro.style.height).not.toBe("");
    expect(quadro.style.flex).toBe("0 0 auto");
    view.unmount();

    expect(remover).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remover).toHaveBeenCalledWith("orientationchange", expect.any(Function));
    expect(estado.ouvintesDaMedia).toHaveLength(0);
    expect(observador.disconnect).toHaveBeenCalledOnce();
    expect(quadro.style.height).toBe("");
    expect(quadro.style.flex).toBe("");
  });
});
