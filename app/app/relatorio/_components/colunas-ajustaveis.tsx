"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface ConfiguracaoColunaAjustavel {
  larguraMinima: number;
  larguraPadrao: number;
}

interface ColunasAjustaveisOptions<Column extends string> {
  storageKey: string;
  colunas: Record<Column, ConfiguracaoColunaAjustavel>;
  traduzir: (texto: string) => string;
  larguraMaxima?: number;
}

export function useColunasAjustaveis<Column extends string>({
  storageKey,
  colunas,
  traduzir,
  larguraMaxima = 1200,
}: ColunasAjustaveisOptions<Column>) {
  const [larguras, setLarguras] = useState<Partial<Record<Column, number>>>({});
  const largurasRef = useRef<Partial<Record<Column, number>>>({});
  const redimensionamento = useRef<{
    coluna: Column;
    pointerId: number;
    inicioX: number;
    larguraInicial: number;
  } | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const armazenado = window.localStorage.getItem(storageKey);
        const valor: unknown = armazenado ? JSON.parse(armazenado) : {};
        const proximo =
          valor && typeof valor === "object" && !Array.isArray(valor)
            ? (Object.fromEntries(
                Object.entries(valor).filter(([coluna, largura]) => {
                  const configuracao = colunas[coluna as Column];
                  return (
                    configuracao != null &&
                    typeof largura === "number" &&
                    Number.isFinite(largura) &&
                    largura >= configuracao.larguraMinima &&
                    largura <= larguraMaxima
                  );
                }),
              ) as Partial<Record<Column, number>>)
            : {};
        largurasRef.current = proximo;
        setLarguras(proximo);
      } catch {
        largurasRef.current = {};
        setLarguras({});
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [colunas, larguraMaxima, storageKey]);

  const salvarLarguras = (proximo: Partial<Record<Column, number>>) => {
    largurasRef.current = proximo;
    setLarguras(proximo);
    if (Object.keys(proximo).length === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(proximo));
  };

  const definirLargura = (coluna: Column, largura: number) => {
    const configuracao = colunas[coluna];
    salvarLarguras({
      ...largurasRef.current,
      [coluna]: Math.min(larguraMaxima, Math.max(configuracao.larguraMinima, Math.round(largura))),
    });
  };

  const iniciar = (event: ReactPointerEvent<HTMLButtonElement>, coluna: Column) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const configuracao = colunas[coluna];
    const medida = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
    redimensionamento.current = {
      coluna,
      pointerId: event.pointerId,
      inicioX: event.clientX,
      larguraInicial: largurasRef.current[coluna] ?? (medida || configuracao.larguraPadrao),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const continuar = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const atual = redimensionamento.current;
    if (!atual || atual.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    definirLargura(atual.coluna, atual.larguraInicial + event.clientX - atual.inicioX);
  };

  const parar = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (redimensionamento.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    redimensionamento.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const restaurar = (coluna: Column) => {
    const proximo = { ...largurasRef.current };
    delete proximo[coluna];
    salvarLarguras(proximo);
  };

  const estiloDaColuna = (coluna: Column): CSSProperties | undefined => {
    const largura = larguras[coluna];
    return largura == null ? undefined : { width: largura, minWidth: largura, maxWidth: largura };
  };

  const alcaDaColuna = (coluna: Column, rotulo: string) => {
    const configuracao = colunas[coluna];
    const descricao = `${traduzir("Ajustar largura da coluna")} ${rotulo}. ${traduzir("Clique duas vezes para restaurar")}`;
    return (
      <button
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={descricao}
        aria-valuemin={configuracao.larguraMinima}
        aria-valuemax={larguraMaxima}
        aria-valuenow={larguras[coluna] ?? configuracao.larguraPadrao}
        title={descricao}
        className="group absolute inset-y-0 right-0 z-10 hidden w-3 translate-x-1/2 cursor-col-resize touch-none select-none [@media(pointer:fine)]:block"
        onPointerDown={(event) => iniciar(event, coluna)}
        onPointerMove={continuar}
        onPointerUp={parar}
        onPointerCancel={parar}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          restaurar(coluna);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            restaurar(coluna);
            return;
          }
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          const larguraAtual = largurasRef.current[coluna] ?? configuracao.larguraPadrao;
          definirLargura(coluna, larguraAtual + (event.key === "ArrowRight" ? 8 : -8));
        }}
      >
        <span className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
      </button>
    );
  };

  return { alcaDaColuna, estiloDaColuna };
}
