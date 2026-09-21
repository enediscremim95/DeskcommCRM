import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaixaArrastavel, lerPosicaoSalva, limitarAJanela } from "./CaixaArrastavel";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));

const CHAVE = "relatorio:caixa-periodo:posicao:teste";

function definirJanela(largura: number, altura: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: altura });
}

function fingirTamanho(largura: number, altura: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 50,
    left: 100,
    top: 50,
    right: 100 + largura,
    bottom: 50 + altura,
    width: largura,
    height: altura,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("CaixaArrastavel", () => {
  beforeEach(() => {
    localStorage.clear();
    definirJanela(1280, 800);
    fingirTamanho(300, 60);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fica onde foi solta, lembra a posição e volta ao lugar com duplo clique", () => {
    const { container } = render(
      <CaixaArrastavel chave={CHAVE} className="caixa">
        <span>conteúdo</span>
      </CaixaArrastavel>,
    );
    const caixa = container.firstElementChild as HTMLElement;
    const alca = screen.getByRole("button", { name: "Arrastar" });

    expect(caixa.dataset.solta).toBeUndefined();

    fireEvent.pointerDown(alca, { pointerId: 1, button: 0, clientX: 110, clientY: 60 });
    fireEvent.pointerMove(alca, { pointerId: 1, clientX: 410, clientY: 260 });
    fireEvent.pointerUp(alca, { pointerId: 1, clientX: 410, clientY: 260 });

    expect(caixa.dataset.solta).toBe("true");
    expect(caixa.style.left).toBe("400px");
    expect(caixa.style.top).toBe("250px");
    expect(lerPosicaoSalva(CHAVE)).toEqual({ x: 400, y: 250, largura: 300, altura: 60 });
    expect(screen.getByRole("button", { name: "Voltar ao lugar" })).toBeInTheDocument();

    fireEvent.doubleClick(alca);
    expect(caixa.dataset.solta).toBeUndefined();
    expect(caixa.style.left).toBe("");
    expect(lerPosicaoSalva(CHAVE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Voltar ao lugar" })).not.toBeInTheDocument();
  });

  it("nunca sai da janela e se ajusta quando a janela encolhe", () => {
    const { container } = render(
      <CaixaArrastavel chave={CHAVE}>
        <span>conteúdo</span>
      </CaixaArrastavel>,
    );
    const caixa = container.firstElementChild as HTMLElement;
    const alca = screen.getByRole("button", { name: "Arrastar" });

    fireEvent.pointerDown(alca, { pointerId: 1, button: 0, clientX: 110, clientY: 60 });
    fireEvent.pointerMove(alca, { pointerId: 1, clientX: 5000, clientY: 5000 });
    fireEvent.pointerUp(alca, { pointerId: 1, clientX: 5000, clientY: 5000 });

    expect(caixa.style.left).toBe(`${1280 - 300}px`);
    expect(caixa.style.top).toBe(`${800 - 60}px`);

    act(() => {
      definirJanela(800, 600);
      window.dispatchEvent(new Event("resize"));
    });
    expect(caixa.style.left).toBe(`${800 - 300}px`);
    expect(caixa.style.top).toBe(`${600 - 60}px`);
  });

  it("lê a posição lembrada e cai no padrão se o valor estiver corrompido", () => {
    localStorage.setItem(CHAVE, JSON.stringify({ x: 200, y: 120 }));
    const { container, unmount } = render(
      <CaixaArrastavel chave={CHAVE}>
        <span>conteúdo</span>
      </CaixaArrastavel>,
    );
    expect((container.firstElementChild as HTMLElement).style.left).toBe("200px");
    unmount();

    localStorage.setItem(CHAVE, "{lixo");
    const segunda = render(
      <CaixaArrastavel chave={CHAVE}>
        <span>conteúdo</span>
      </CaixaArrastavel>,
    );
    expect((segunda.container.firstElementChild as HTMLElement).dataset.solta).toBeUndefined();
  });

  it("em tela estreita esconde a alça e ignora a posição lembrada", () => {
    definirJanela(375, 700);
    localStorage.setItem(CHAVE, JSON.stringify({ x: 200, y: 120 }));
    const { container } = render(
      <CaixaArrastavel chave={CHAVE}>
        <span>conteúdo</span>
      </CaixaArrastavel>,
    );
    expect(screen.queryByRole("button", { name: "Arrastar" })).not.toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).dataset.solta).toBeUndefined();
  });

  it("limitarAJanela mantém a caixa dentro dos limites", () => {
    const tamanho = { largura: 300, altura: 60 };
    const janela = { largura: 1000, altura: 500 };
    expect(limitarAJanela({ x: -50, y: -10 }, tamanho, janela)).toEqual({ x: 0, y: 0 });
    expect(limitarAJanela({ x: 900, y: 490 }, tamanho, janela)).toEqual({ x: 700, y: 440 });
    expect(limitarAJanela({ x: 10, y: 20 }, tamanho, janela)).toEqual({ x: 10, y: 20 });
  });
});
