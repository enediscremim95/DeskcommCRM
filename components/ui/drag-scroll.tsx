"use client";

import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Elementos que continuam recebendo o clique normal (não iniciam arraste). */
const INTERATIVO = "a,button,input,select,textarea,label,summary,[role=button],[contenteditable=true]";

/** Distância mínima (px) para um clique virar arraste. */
const LIMIAR = 5;

function rolagemVertical(inicio: HTMLElement | null): HTMLElement {
  for (let el = inicio?.parentElement ?? null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Área com rolagem que pode ser "agarrada" com o mouse: arrastar para os lados
 * rola a própria área; para cima ou para baixo, rola a página (ou o painel que
 * a contém). Toque e caneta seguem com a rolagem nativa.
 */
export function DragScroll({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const arraste = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    vertical: HTMLElement;
    moveu: boolean;
  } | null>(null);
  const ignorarClique = useRef(false);

  return (
    <div
      ref={ref}
      className={cn("cursor-grab", className)}
      onPointerDown={(event) => {
        const el = ref.current;
        if (!el || event.pointerType !== "mouse" || event.button !== 0) return;
        if ((event.target as Element).closest(INTERATIVO)) return;
        const vertical = rolagemVertical(el);
        arraste.current = {
          x: event.clientX,
          y: event.clientY,
          left: el.scrollLeft,
          top: vertical.scrollTop,
          vertical,
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
          if (Math.hypot(dx, dy) < LIMIAR) return;
          atual.moveu = true;
          el.setPointerCapture(event.pointerId);
          el.style.cursor = "grabbing";
          el.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
        }
        event.preventDefault();
        el.scrollLeft = atual.left - dx;
        atual.vertical.scrollTop = atual.top - dy;
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
