"use client";

import { useCallback, useRef, type ReactNode, type RefCallback } from "react";

import { cn } from "@/lib/utils";

/** Elementos que continuam recebendo o clique normal (não iniciam arraste). */
const INTERATIVO = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[contenteditable="true"]',
].join(",");

/** Distância mínima (px) para um clique virar arraste. */
const LIMIAR = 5;

function rolagemVertical(inicio: HTMLElement | null): HTMLElement {
  for (let el = inicio; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Área com rolagem que pode ser "agarrada" com o mouse: arrastar para os lados
 * rola a própria área; para cima ou para baixo, rola a própria área quando ela
 * tem overflow vertical, ou o painel/página que a contém. Toque e caneta seguem
 * com a rolagem nativa.
 */
interface DragScrollProps {
  className?: string;
  children: ReactNode;
  /** `xy` preserva o comportamento das tabelas; `x` nunca move a rolagem vertical. */
  eixo?: "x" | "xy";
  /** Seletores adicionais cujos descendentes não podem iniciar o arraste. */
  naoIniciaEm?: string;
  /** Permite que outro hook meça ou observe o mesmo div que recebe a rolagem. */
  containerRef?: RefCallback<HTMLDivElement>;
}

export function DragScroll({
  className,
  children,
  eixo = "xy",
  naoIniciaEm,
  containerRef,
}: DragScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const definirRef = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      containerRef?.(node);
    },
    [containerRef],
  );
  const arraste = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    vertical: HTMLElement | null;
    somenteX: boolean;
    moveu: boolean;
  } | null>(null);
  const ignorarClique = useRef(false);

  return (
    <div
      ref={definirRef}
      className={cn("cursor-grab", className)}
      onPointerDown={(event) => {
        const el = ref.current;
        if (!el || event.pointerType !== "mouse" || event.button !== 0) return;
        const alvo = event.target;
        if (!(alvo instanceof Element)) return;
        if (alvo.closest(INTERATIVO) || (naoIniciaEm && alvo.closest(naoIniciaEm))) return;
        const vertical = eixo === "xy" ? rolagemVertical(el) : null;
        arraste.current = {
          x: event.clientX,
          y: event.clientY,
          left: el.scrollLeft,
          top: vertical?.scrollTop ?? 0,
          vertical,
          somenteX: eixo === "x",
          moveu: false,
        };
      }}
      onPointerMove={(event) => {
        const el = ref.current;
        const atual = arraste.current;
        if (!el || !atual) return;
        const dx = event.clientX - atual.x;
        const dy = event.clientY - atual.y;
        if (!atual.moveu) {
          const distancia = atual.somenteX ? Math.abs(dx) : Math.hypot(dx, dy);
          if (distancia < LIMIAR) return;
          atual.moveu = true;
          el.setPointerCapture(event.pointerId);
          el.style.cursor = "grabbing";
          el.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
        }
        event.preventDefault();
        el.scrollLeft = atual.left - dx;
        if (atual.vertical) atual.vertical.scrollTop = atual.top - dy;
      }}
      onPointerUp={(event) => {
        const el = ref.current;
        const atual = arraste.current;
        arraste.current = null;
        if (!el || !atual?.moveu) return;
        ignorarClique.current = true;
        if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
        el.style.cursor = "";
        el.style.userSelect = "";
      }}
      onPointerCancel={() => {
        arraste.current = null;
        if (ref.current) {
          ref.current.style.cursor = "";
          ref.current.style.userSelect = "";
        }
      }}
      onClickCapture={(event) => {
        // Soltar o mouse depois de arrastar não pode abrir a linha embaixo dele.
        if (ignorarClique.current) {
          ignorarClique.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}
