"use client";

import { useCallback, useLayoutEffect, useRef, type RefCallback } from "react";

const MEDIA_DESKTOP = "(min-width: 768px)";

/**
 * Preserva uma pequena margem para o fim do quadro não disputar o último
 * pixel da viewport com arredondamento, zoom ou a barra horizontal nativa.
 */
export const FOLGA_INFERIOR_QUADRO_PX = 4;

function espacoInferiorDosAncestrais(elemento: HTMLElement): number {
  let espaco = 0;

  for (
    let ancestral = elemento.parentElement;
    ancestral && ancestral !== document.body;
    ancestral = ancestral.parentElement
  ) {
    const estilo = window.getComputedStyle(ancestral);
    const paddingInferior = Number.parseFloat(estilo.paddingBottom);
    const bordaInferior = Number.parseFloat(estilo.borderBottomWidth);

    if (!Number.isNaN(paddingInferior)) espaco += paddingInferior;
    if (!Number.isNaN(bordaInferior)) espaco += bordaInferior;
  }

  return espaco;
}

/**
 * Mantém um elemento exatamente no espaço restante até o rodapé da viewport.
 *
 * No mobile a altura continua livre. No desktop, mudanças na viewport ou no
 * conteúdo anterior ao elemento refazem a medida antes da pintura.
 */
export function useAlturaAteORodape<T extends HTMLElement>(): RefCallback<T> {
  const elementoRef = useRef<T | null>(null);
  const ref = useCallback((node: T | null) => {
    elementoRef.current = node;
  }, []);

  useLayoutEffect(() => {
    const elemento = elementoRef.current;
    if (!elemento) return;

    const media = window.matchMedia(MEDIA_DESKTOP);
    const medir = () => {
      if (!media.matches) {
        elemento.style.removeProperty("height");
        elemento.style.removeProperty("flex");
        return;
      }

      const topo = elemento.getBoundingClientRect().top;
      const espacoInferior = espacoInferiorDosAncestrais(elemento);
      const altura = Math.max(
        0,
        window.innerHeight - topo - espacoInferior - FOLGA_INFERIOR_QUADRO_PX,
      );
      elemento.style.height = `${altura}px`;
      elemento.style.flex = "none";
    };

    const observador = new ResizeObserver(medir);
    if (elemento.parentElement) observador.observe(elemento.parentElement);
    for (
      let anterior = elemento.previousElementSibling;
      anterior;
      anterior = anterior.previousElementSibling
    ) {
      observador.observe(anterior);
    }

    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    media.addEventListener("change", medir);
    medir();

    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
      media.removeEventListener("change", medir);
      observador.disconnect();
      elemento.style.removeProperty("height");
      elemento.style.removeProperty("flex");
    };
  });

  return ref;
}
