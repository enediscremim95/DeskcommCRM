"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UseRelatorioRecolhivelOptions {
  organizationKey: string;
  viewerKey: string;
  sectionKey: string;
  defaultOpen?: boolean;
}

interface SecaoRegistrada {
  open: boolean;
  definirOpen: (open: boolean) => void;
}

interface RelatorioRecolhivelContextValue {
  registrar: (instanceKey: string, definirOpen: (open: boolean) => void) => () => void;
  atualizar: (instanceKey: string, open: boolean) => void;
  quantidade: number;
  todasRecolhidas: boolean;
  definirTodas: (open: boolean) => void;
}

const RelatorioRecolhivelContext = createContext<RelatorioRecolhivelContextValue | null>(null);
const ModoApresentacaoContext = createContext(false);

export function ProvedorRelatorioRecolhivel({ children }: { children: ReactNode }) {
  const [secoes, setSecoes] = useState<Map<string, SecaoRegistrada>>(() => new Map());

  const registrar = useCallback(
    (instanceKey: string, definirOpen: (open: boolean) => void) => {
      setSecoes((atuais) => {
        const proximas = new Map(atuais);
        proximas.set(instanceKey, { open: true, definirOpen });
        return proximas;
      });
      return () => {
        setSecoes((atuais) => {
          if (!atuais.has(instanceKey)) return atuais;
          const proximas = new Map(atuais);
          proximas.delete(instanceKey);
          return proximas;
        });
      };
    },
    [],
  );

  const atualizar = useCallback((instanceKey: string, open: boolean) => {
    setSecoes((atuais) => {
      const secao = atuais.get(instanceKey);
      if (!secao || secao.open === open) return atuais;
      const proximas = new Map(atuais);
      proximas.set(instanceKey, { ...secao, open });
      return proximas;
    });
  }, []);

  const definirTodas = useCallback((open: boolean) => {
    for (const secao of secoes.values()) secao.definirOpen(open);
  }, [secoes]);

  const value = useMemo<RelatorioRecolhivelContextValue>(() => {
    const registradas = [...secoes.values()];
    return {
      registrar,
      atualizar,
      quantidade: registradas.length,
      todasRecolhidas: registradas.length > 0 && registradas.every((secao) => !secao.open),
      definirTodas,
    };
  }, [atualizar, definirTodas, registrar, secoes]);

  return (
    <RelatorioRecolhivelContext.Provider value={value}>
      {children}
    </RelatorioRecolhivelContext.Provider>
  );
}

export function ProvedorModoApresentacao({
  ativo,
  children,
}: {
  ativo: boolean;
  children: ReactNode;
}) {
  return (
    <ModoApresentacaoContext.Provider value={ativo}>{children}</ModoApresentacaoContext.Provider>
  );
}

export function useModoApresentacao(): boolean {
  return useContext(ModoApresentacaoContext);
}

export function ControleEdicaoRelatorio({ children }: { children: ReactNode }) {
  return useModoApresentacao() ? null : <>{children}</>;
}

export function ControleTodasAsSecoes({
  recolherLabel,
  expandirLabel,
}: {
  recolherLabel: string;
  expandirLabel: string;
}) {
  const contexto = useContext(RelatorioRecolhivelContext);
  if (!contexto || contexto.quantidade === 0) return null;

  const expandir = contexto.todasRecolhidas;
  const label = expandir ? expandirLabel : recolherLabel;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => contexto.definirTodas(expandir)}
      aria-label={label}
    >
      {label}
    </Button>
  );
}

export function reportSectionStorageKey({
  organizationKey,
  viewerKey,
  sectionKey,
}: Omit<UseRelatorioRecolhivelOptions, "defaultOpen">): string {
  return `traffic-report-section:${organizationKey}:${viewerKey}:${sectionKey}`;
}

export function useRelatorioRecolhivel({
  organizationKey,
  viewerKey,
  sectionKey,
  defaultOpen = true,
}: UseRelatorioRecolhivelOptions) {
  const contexto = useContext(RelatorioRecolhivelContext);
  const registrar = contexto?.registrar;
  const atualizar = contexto?.atualizar;
  const instanceKey = useId();
  const storageKey = reportSectionStorageKey({ organizationKey, viewerKey, sectionKey });
  const [open, setOpen] = useState(defaultOpen);
  const restoreVersion = useRef(0);

  useEffect(() => {
    const version = ++restoreVersion.current;
    const timeout = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (version !== restoreVersion.current) return;
        setOpen(stored == null ? defaultOpen : stored !== "closed");
      } catch {
        if (version === restoreVersion.current) setOpen(defaultOpen);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [defaultOpen, storageKey]);

  const definirOpen = useCallback((next: boolean) => {
    restoreVersion.current += 1;
    setOpen(next);
    try {
      if (next === defaultOpen) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      // A preferência é conforto, não requisito para o relatório funcionar.
    }
  }, [defaultOpen, storageKey]);

  const toggle = useCallback(() => definirOpen(!open), [definirOpen, open]);

  useEffect(
    () => registrar?.(instanceKey, definirOpen),
    [definirOpen, instanceKey, registrar],
  );

  useEffect(() => {
    atualizar?.(instanceKey, open);
  }, [atualizar, instanceKey, open]);

  return { open, toggle, storageKey };
}

export function SetaRecolhivel({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(
        "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
        open && "rotate-90",
      )}
    >
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BlocoRecolhivel({
  organizationKey,
  viewerKey,
  sectionKey,
  idioma,
  label,
  header,
  children,
  className,
  headerClassName,
  contentClassName,
}: UseRelatorioRecolhivelOptions & {
  idioma: string;
  label: string;
  header: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}) {
  const { open, toggle } = useRelatorioRecolhivel({
    organizationKey,
    viewerKey,
    sectionKey,
  });
  const reactId = useId().replace(/:/g, "");
  const contentId = `traffic-report-${reactId}`;
  const action = open
    ? idioma === "es"
      ? "Contraer"
      : "Recolher"
    : idioma === "es"
      ? "Expandir"
      : "Expandir";

  return (
    <section className={className} aria-label={label}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`${action} ${label}`}
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden",
          headerClassName,
        )}
      >
        <span className="min-w-0 flex-1">{header}</span>
        <SetaRecolhivel open={open} />
      </button>
      <div id={contentId} hidden={!open} className={contentClassName}>
        {children}
      </div>
    </section>
  );
}
