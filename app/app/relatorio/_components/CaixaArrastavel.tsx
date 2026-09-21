"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react";
import { GripVertical, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

/**
 * Caixa que a pessoa pode arrastar pela tela segurando a alça.
 *
 * - Enquanto não foi arrastada, fica no fluxo normal da página (onde o layout
 *   a colocou). Ao arrastar, vira `position: fixed` e fica onde foi solta.
 * - A posição é lembrada neste navegador (`localStorage`), por chave, junto
 *   com o tamanho que a caixa tinha: é o que permite limitar a posição lida à
 *   janela atual sem medir nada em efeito.
 * - Nunca sai da área visível: é limitada à janela e reposicionada se a
 *   janela encolher.
 * - Duplo clique na alça, ou o botão "Voltar ao lugar", devolve ao fluxo.
 * - Em telas estreitas (< 640 px) a alça some e a caixa fica no fluxo: no
 *   celular ela já ocupa a largura toda, uma caixa fixa cobriria o conteúdo e
 *   o dedo arrastando brigaria com a rolagem da página.
 *
 * Sem `setState` dentro de `useEffect` (o `react-hooks/set-state-in-effect`
 * recusa): "estou no cliente?" e "a tela é estreita?" vêm de
 * `useSyncExternalStore`, e a posição lembrada é lida durante o render, só
 * depois de hidratar, para o HTML do servidor e o primeiro render do cliente
 * baterem byte a byte.
 */

export type PosicaoDaCaixa = { x: number; y: number };

type PosicaoSalva = PosicaoDaCaixa & { largura: number; altura: number };

const LARGURA_MINIMA_PARA_ARRASTAR = 640;

export function chaveDePosicao(organizationKey: string | null, viewerKey: string | null): string {
  return `relatorio:caixa-periodo:posicao:${organizationKey ?? "org"}:${viewerKey ?? "viewer"}`;
}

function numeroFinito(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

export function lerPosicaoSalva(chave: string): PosicaoSalva | null {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return null;
    const dado = JSON.parse(bruto) as Partial<PosicaoSalva> | null;
    if (!dado || typeof dado !== "object") return null;
    if (!numeroFinito(dado.x) || !numeroFinito(dado.y)) return null;
    return {
      x: dado.x,
      y: dado.y,
      largura: numeroFinito(dado.largura) ? dado.largura : 0,
      altura: numeroFinito(dado.altura) ? dado.altura : 0,
    };
  } catch {
    return null;
  }
}

function salvarPosicao(chave: string, posicao: PosicaoSalva | null) {
  try {
    if (posicao) localStorage.setItem(chave, JSON.stringify(posicao));
    else localStorage.removeItem(chave);
  } catch {
    // Sem armazenamento (navegação privada, cota cheia): a caixa só não lembra.
  }
}

/** Mantém a caixa inteira dentro da janela. Exportada para o teste. */
export function limitarAJanela(
  posicao: PosicaoDaCaixa,
  tamanho: { largura: number; altura: number },
  janela: { largura: number; altura: number },
): PosicaoDaCaixa {
  const maxX = Math.max(0, janela.largura - tamanho.largura);
  const maxY = Math.max(0, janela.altura - tamanho.altura);
  return {
    x: Math.min(Math.max(0, posicao.x), maxX),
    y: Math.min(Math.max(0, posicao.y), maxY),
  };
}

function janelaAtual() {
  return { largura: window.innerWidth, altura: window.innerHeight };
}

function assinarRedimensionamento(ouvinte: () => void) {
  window.addEventListener("resize", ouvinte);
  return () => window.removeEventListener("resize", ouvinte);
}

function telaEstreitaAgora() {
  return window.innerWidth < LARGURA_MINIMA_PARA_ARRASTAR;
}

type Props = {
  /** Muda a chave quando a organização/pessoa muda; a posição é lembrada por chave. */
  chave: string;
  className?: string;
  children: ReactNode;
};

export function CaixaArrastavel({ chave, className, children }: Props) {
  const t = useT();
  const caixaRef = useRef<HTMLDivElement>(null);
  const arrasteRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  const hidratado = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const estreita = useSyncExternalStore(
    assinarRedimensionamento,
    telaEstreitaAgora,
    () => false,
  );

  // `undefined` = ainda não lida para esta chave; `null` = no fluxo normal.
  const [posicaoLocal, setPosicaoLocal] = useState<PosicaoDaCaixa | null | undefined>(undefined);
  const [chaveAnterior, setChaveAnterior] = useState(chave);
  if (chave !== chaveAnterior) {
    setChaveAnterior(chave);
    setPosicaoLocal(undefined);
  }

  let posicao: PosicaoDaCaixa | null = null;
  if (hidratado && !estreita) {
    if (posicaoLocal !== undefined) {
      posicao = posicaoLocal;
    } else {
      const salva = lerPosicaoSalva(chave);
      posicao = salva ? limitarAJanela(salva, salva, janelaAtual()) : null;
    }
  }

  const limitarAtual = useCallback((p: PosicaoDaCaixa): PosicaoDaCaixa => {
    const rect = caixaRef.current?.getBoundingClientRect();
    return limitarAJanela(
      p,
      { largura: rect?.width ?? 0, altura: rect?.height ?? 0 },
      janelaAtual(),
    );
  }, []);

  // Reposiciona quando a janela encolhe (setState em callback de evento
  // externo, que é o que o efeito deve fazer).
  useEffect(() => {
    return assinarRedimensionamento(() => {
      setPosicaoLocal((atual) => (atual ? limitarAtual(atual) : atual));
    });
  }, [limitarAtual]);

  function tamanhoAtual() {
    const rect = caixaRef.current?.getBoundingClientRect();
    return { largura: rect?.width ?? 0, altura: rect?.height ?? 0 };
  }

  function aoSegurar(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const rect = caixaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const inicio = posicao ?? { x: rect.left, y: rect.top };
    arrasteRef.current = {
      pointerId: event.pointerId,
      dx: event.clientX - inicio.x,
      dy: event.clientY - inicio.y,
    };
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setPosicaoLocal(limitarAtual(inicio));
    event.preventDefault();
  }

  function aoMover(event: PointerEvent<HTMLButtonElement>) {
    const arraste = arrasteRef.current;
    if (!arraste || arraste.pointerId !== event.pointerId) return;
    setPosicaoLocal(limitarAtual({ x: event.clientX - arraste.dx, y: event.clientY - arraste.dy }));
  }

  function aoSoltar(event: PointerEvent<HTMLButtonElement>) {
    const arraste = arrasteRef.current;
    if (!arraste || arraste.pointerId !== event.pointerId) return;
    arrasteRef.current = null;
    if (typeof event.currentTarget.releasePointerCapture === "function") {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Captura já liberada pelo navegador.
      }
    }
    const final = limitarAtual({ x: event.clientX - arraste.dx, y: event.clientY - arraste.dy });
    setPosicaoLocal(final);
    salvarPosicao(chave, { ...final, ...tamanhoAtual() });
  }

  function voltarAoLugar() {
    arrasteRef.current = null;
    setPosicaoLocal(null);
    salvarPosicao(chave, null);
  }

  const solta = posicao !== null;

  return (
    <div
      ref={caixaRef}
      data-solta={solta ? "true" : undefined}
      className={[className ?? "", solta ? "fixed z-40 shadow-lg" : ""].filter(Boolean).join(" ")}
      style={posicao ? { left: posicao.x, top: posicao.y } : undefined}
    >
      {hidratado && !estreita && (
        <button
          type="button"
          aria-label={t("Arrastar")}
          title={t("Arrastar")}
          onPointerDown={aoSegurar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoSoltar}
          onDoubleClick={voltarAoLugar}
          className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center self-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      )}
      {children}
      {solta && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("Voltar ao lugar")}
          title={t("Voltar ao lugar")}
          onClick={voltarAoLugar}
          className="self-center"
        >
          <Undo2 className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
