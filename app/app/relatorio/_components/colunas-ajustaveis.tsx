"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type HTMLAttributes,
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
  ordem?: {
    storageKey: string;
    padrao: readonly Column[];
    fixa: Column;
  };
}

type PosicaoDaQueda = "antes" | "depois";

function normalizarOrdem<Column extends string>(
  candidata: readonly unknown[],
  padrao: readonly Column[],
  fixa: Column,
): Column[] {
  const validas = new Set<Column>(padrao);
  const semRepetir = candidata.filter(
    (coluna, indice): coluna is Column =>
      typeof coluna === "string" &&
      validas.has(coluna as Column) &&
      coluna !== fixa &&
      candidata.indexOf(coluna) === indice,
  );
  const faltantes = padrao.filter((coluna) => coluna !== fixa && !semRepetir.includes(coluna));
  return [fixa, ...semRepetir, ...faltantes];
}

export function useColunasAjustaveis<Column extends string>({
  storageKey,
  colunas,
  traduzir,
  larguraMaxima = 1200,
  ordem,
}: ColunasAjustaveisOptions<Column>) {
  const [larguras, setLarguras] = useState<Partial<Record<Column, number>>>({});
  const largurasRef = useRef<Partial<Record<Column, number>>>({});
  const redimensionamento = useRef<{
    coluna: Column;
    pointerId: number;
    inicioX: number;
    larguraInicial: number;
  } | null>(null);
  const ordemPadrao = ordem?.padrao;
  const assinaturaDaOrdem = ordemPadrao?.join("|") ?? "";
  const colunaFixa = ordem?.fixa;
  const ordemStorageKey = ordem?.storageKey;
  const ordemNormalizada = useMemo(
    () => {
      if (!colunaFixa || !assinaturaDaOrdem) return [] as Column[];
      const padrao = assinaturaDaOrdem.split("|") as Column[];
      return normalizarOrdem(padrao, padrao, colunaFixa);
    },
    [assinaturaDaOrdem, colunaFixa],
  );
  const [ordemDasColunas, setOrdemDasColunas] = useState<Column[]>(ordemNormalizada);
  const ordemRef = useRef<Column[]>(ordemNormalizada);
  const [podeReordenar, setPodeReordenar] = useState(false);
  const [alvoDaQueda, setAlvoDaQueda] = useState<{
    coluna: Column;
    posicao: PosicaoDaQueda;
  } | null>(null);
  const alvoDaQuedaRef = useRef<typeof alvoDaQueda>(null);
  const colunaArrastada = useRef<Column | null>(null);

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

  useEffect(() => {
    if (!ordemStorageKey || !colunaFixa) return;
    const timeout = window.setTimeout(() => {
      let proxima = ordemNormalizada;
      try {
        const armazenada = window.localStorage.getItem(ordemStorageKey);
        const valor: unknown = armazenada ? JSON.parse(armazenada) : [];
        if (Array.isArray(valor)) {
          proxima = normalizarOrdem(valor, ordemNormalizada, colunaFixa);
        }
      } catch {
        window.localStorage.removeItem(ordemStorageKey);
      }
      ordemRef.current = proxima;
      setOrdemDasColunas(proxima);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [assinaturaDaOrdem, colunaFixa, ordemNormalizada, ordemStorageKey]);

  useEffect(() => {
    const consulta = window.matchMedia?.("(min-width: 768px) and (pointer: fine)");
    const atualizar = () => setPodeReordenar(consulta?.matches ?? true);
    atualizar();
    consulta?.addEventListener?.("change", atualizar);
    return () => consulta?.removeEventListener?.("change", atualizar);
  }, []);

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

  const salvarOrdem = (proxima: Column[]) => {
    if (!ordemStorageKey || !colunaFixa) return;
    const normalizada = normalizarOrdem(proxima, ordemNormalizada, colunaFixa);
    ordemRef.current = normalizada;
    setOrdemDasColunas(normalizada);
    if (normalizada.every((coluna, indice) => coluna === ordemNormalizada[indice])) {
      window.localStorage.removeItem(ordemStorageKey);
    } else {
      window.localStorage.setItem(ordemStorageKey, JSON.stringify(normalizada));
    }
  };

  const restaurarOrdemPadrao = () => {
    if (!ordemStorageKey) return;
    ordemRef.current = ordemNormalizada;
    setOrdemDasColunas(ordemNormalizada);
    alvoDaQuedaRef.current = null;
    setAlvoDaQueda(null);
    window.localStorage.removeItem(ordemStorageKey);
  };

  const propriedadesDeArraste = (
    coluna: Column,
  ): HTMLAttributes<HTMLTableCellElement> & { "data-drop-position"?: PosicaoDaQueda } => {
    const fixa = colunaFixa === coluna;
    const ativo = Boolean(ordemStorageKey && podeReordenar && !fixa);
    return {
      draggable: ativo,
      onPointerDown: (event) => {
        if (!ordemStorageKey || event.pointerType !== "mouse" || event.button !== 0) return;
        if ((event.target as Element).closest('[role="separator"]')) return;
        event.stopPropagation();
      },
      onDragStart: (event: ReactDragEvent<HTMLTableCellElement>) => {
        if (!ativo || (event.target as Element).closest('[role="separator"]')) {
          event.preventDefault();
          return;
        }
        colunaArrastada.current = coluna;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", coluna);
      },
      onDragOver: (event: ReactDragEvent<HTMLTableCellElement>) => {
        const arrastada = colunaArrastada.current;
        if (!ordemStorageKey || !arrastada || arrastada === coluna) return;
        event.preventDefault();
        const caixa = event.currentTarget.getBoundingClientRect();
        const posicao: PosicaoDaQueda =
          coluna === colunaFixa || event.clientX >= caixa.left + caixa.width / 2
            ? "depois"
            : "antes";
        alvoDaQuedaRef.current = { coluna, posicao };
        setAlvoDaQueda(alvoDaQuedaRef.current);
      },
      onDrop: (event: ReactDragEvent<HTMLTableCellElement>) => {
        const arrastada = colunaArrastada.current;
        if (!ordemStorageKey || !arrastada || arrastada === coluna) return;
        event.preventDefault();
        const alvoAtual = alvoDaQuedaRef.current;
        const posicao = alvoAtual?.coluna === coluna ? alvoAtual.posicao : "depois";
        const semArrastada = ordemRef.current.filter((item) => item !== arrastada);
        const indiceDoAlvo = semArrastada.indexOf(coluna);
        const indice = coluna === colunaFixa ? 1 : indiceDoAlvo + (posicao === "depois" ? 1 : 0);
        const proxima = [...semArrastada];
        proxima.splice(Math.max(1, indice), 0, arrastada);
        salvarOrdem(proxima);
        colunaArrastada.current = null;
        alvoDaQuedaRef.current = null;
        setAlvoDaQueda(null);
      },
      onDragEnd: () => {
        colunaArrastada.current = null;
        alvoDaQuedaRef.current = null;
        setAlvoDaQueda(null);
      },
      "data-drop-position":
        alvoDaQueda?.coluna === coluna ? alvoDaQueda.posicao : undefined,
    };
  };

  const classeDoIndicadorDeQueda = (coluna: Column) => {
    if (alvoDaQueda?.coluna !== coluna) return "";
    return alvoDaQueda.posicao === "antes"
      ? "before:absolute before:inset-y-1 before:left-0 before:z-20 before:w-1 before:rounded-full before:bg-primary"
      : "after:absolute after:inset-y-1 after:right-0 after:z-20 after:w-1 after:rounded-full after:bg-primary";
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
        {/* A divisória fica VISÍVEL o tempo todo, não só sob o mouse. Enquanto ela
            só aparecia no hover de uma faixa de 3px, o recurso existia e ninguém
            achava: o dono do produto pediu duas vezes o que já estava publicado,
            porque nada na tela contava que dava para arrastar. Ao passar o mouse
            ela engorda e ganha a cor de ação, para confirmar o que fazer ali. */}
        <span className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-all group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary" />
      </button>
    );
  };

  return {
    alcaDaColuna,
    estiloDaColuna,
    ordemDasColunas,
    propriedadesDeArraste,
    classeDoIndicadorDeQueda,
    restaurarOrdemPadrao,
    ordemFoiAlterada:
      ordemDasColunas.length === ordemNormalizada.length &&
      ordemDasColunas.some((coluna, indice) => coluna !== ordemNormalizada[indice]),
  };
}
