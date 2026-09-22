import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DragScroll } from "./drag-scroll";

function mouse(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("DragScroll", () => {
  it("segurar e arrastar para o lado rola a tabela, e soltar não clica na linha", () => {
    const aoClicar = vi.fn();
    render(
      <DragScroll className="overflow-x-auto">
        <div data-testid="linha" onClick={aoClicar}>
          linha
        </div>
      </DragScroll>,
    );
    const area = screen.getByTestId("linha").parentElement as HTMLDivElement;
    area.setPointerCapture = vi.fn();
    area.hasPointerCapture = () => true;
    area.releasePointerCapture = vi.fn();
    area.scrollLeft = 200;

    fireEvent(screen.getByTestId("linha"), mouse("pointerdown", 300, 100));
    fireEvent(area, mouse("pointermove", 220, 100));
    fireEvent(area, mouse("pointerup", 220, 100));
    fireEvent.click(screen.getByTestId("linha"));

    expect(area.scrollLeft).toBe(280);
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it("clique sem arrastar continua funcionando", () => {
    const aoClicar = vi.fn();
    render(
      <DragScroll>
        <button type="button" onClick={aoClicar}>
          Ver anúncio
        </button>
      </DragScroll>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ver anúncio" }));
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });
});
