"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface UseRelatorioRecolhivelOptions {
  organizationKey: string;
  viewerKey: string;
  sectionKey: string;
  defaultOpen?: boolean;
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

  const toggle = useCallback(() => {
    restoreVersion.current += 1;
    setOpen((current) => {
      const next = !current;
      try {
        if (next === defaultOpen) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, next ? "open" : "closed");
      } catch {
        // A preferência é conforto, não requisito para o relatório funcionar.
      }
      return next;
    });
  }, [defaultOpen, storageKey]);

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
