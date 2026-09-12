"use client";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { Breadcrumbs } from "@/components/shell/Breadcrumbs";
import { MobileDock } from "@/components/shell/MobileDock";
import { useInboundMessageAlerts } from "@/hooks/notifications/useInboundMessageAlerts";
import { useCrmAlerts } from "@/hooks/notifications/useCrmAlerts";
import { useT } from "@/hooks/i18n/useT";
import { useNotifyOpenFromServiceWorker } from "@/lib/notifications/notify_open";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  const t = useT();
  useInboundMessageAlerts();
  useCrmAlerts();
  useNotifyOpenFromServiceWorker();
  return (
    <div className="flex min-h-screen w-full bg-background">
      <a
        href="#conteudo-principal"
        className="fixed top-2 left-2 z-50 -translate-y-16 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition-transform focus:translate-y-0"
      >
        {t("Pular para o conteúdo")}
      </a>
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} />
      </div>
      {/*
        `min-w-0` é o que permite a coluna de conteúdo ENCOLHER. Um flex item
        nasce com `min-width: auto`, ou seja, nunca fica menor que o conteúdo —
        então qualquer bloco largo (uma fila de abas, uma tabela) empurrava a
        PÁGINA INTEIRA para o lado em vez de rolar dentro da própria caixa, e o
        conteúdo sumia sem nada indicando que existia.

        Medido em 390x844 no detalhe do agente, que tem seis abas: a página
        estourava 476px na horizontal; com esta classe, 212px — o que sobra é o
        cabeçalho, presente também em telas que não têm abas (a lista de agentes
        estoura 236px). Isolado ancestral por ancestral: é este o que decide.
      */}
      {/*
        Sem `md:ml-*`: a barra voltou a ocupar lugar na linha (ver o comentário
        em `Sidebar.tsx`), então o que sobra para esta coluna é exatamente o que
        ela não usou. A margem existia para compensar uma barra `fixed`, e era a
        SEGUNDA medida da mesma coisa — a que discordava e deixava a barra por
        cima da lista.
      */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar />
        <main
          id="conteudo-principal"
          tabIndex={-1}
          className="app-main flex min-h-0 flex-1 flex-col overflow-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0"
        >
          <div className="px-4 pt-4 sm:px-6 sm:pt-5">
            <Breadcrumbs />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </main>
        <MobileDock />
      </div>
    </div>
  );
}
