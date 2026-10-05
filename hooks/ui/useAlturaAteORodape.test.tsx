import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  FOLGA_INFERIOR_QUADRO_PX,
  useAlturaAteORodape,
} from "./useAlturaAteORodape";

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

function Quadro() {
  const ref = useAlturaAteORodape<HTMLDivElement>();
  return <div ref={ref} data-testid="quadro" />;
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
  it("aplica em md+ a altura real restante até o rodapé", () => {
    const view = render(<Quadro />);

    expect(view.getByTestId("quadro")).toHaveStyle({
      height: `${900 - 180 - FOLGA_INFERIOR_QUADRO_PX}px`,
    });
  });

  it("não fixa altura abaixo de md", () => {
    estado.desktop = false;
    const view = render(<Quadro />);

    expect(view.getByTestId("quadro").style.height).toBe("");
  });

  it("recalcula no resize e quando o conteúdo anterior muda", () => {
    const view = render(<Quadro />);
    const quadro = view.getByTestId("quadro");

    act(() => {
      window.innerHeight = 760;
      window.dispatchEvent(new Event("resize"));
    });
    expect(quadro).toHaveStyle({ height: `${760 - 180 - FOLGA_INFERIOR_QUADRO_PX}px` });

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
      estado.observadores[0]!.callback(
        [],
        estado.observadores[0] as unknown as ResizeObserver,
      ),
    );
    expect(quadro).toHaveStyle({ height: `${760 - 220 - FOLGA_INFERIOR_QUADRO_PX}px` });
  });

  it("limpa listeners e o ResizeObserver ao desmontar", () => {
    const remover = vi.spyOn(window, "removeEventListener");
    const view = render(<Quadro />);
    const observador = estado.observadores[0]!;

    view.unmount();

    expect(remover).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remover).toHaveBeenCalledWith("orientationchange", expect.any(Function));
    expect(estado.ouvintesDaMedia).toHaveLength(0);
    expect(observador.disconnect).toHaveBeenCalledOnce();
  });
});
