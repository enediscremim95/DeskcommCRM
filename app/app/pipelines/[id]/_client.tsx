"use client";
import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/hooks/i18n/useT";
import { useBoard } from "@/hooks/kanban/useBoard";

function formatError(err: unknown, t: (texto: string) => string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof obj.message === "string") {
      const code = typeof obj.code === "string" ? ` [${obj.code}]` : "";
      return `${obj.message}${code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return t("Erro desconhecido");
    }
  }
  return String(err);
}
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { FilterBar } from "@/components/kanban/FilterBar";
import { BulkActionBar } from "@/components/kanban/BulkActionBar";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { StagesSection } from "@/app/app/settings/tenant/pipelines/_stages";
import { ROLE_RANK } from "@/lib/auth/types";
import { PencilSimple, Plus } from "@/lib/ui/icons";
import type { LeadFilters } from "@/lib/kanban/filters";
import { applyFilters, filtersFromParams, filtersToParams } from "@/lib/kanban/filters";

export function PipelinePageClient({
  pipelineId,
  initialName,
}: {
  pipelineId: string;
  initialName: string;
}) {
  const t = useT();
  const { data, isLoading, error, pulses, realtimeStatus, seguranca } = useBoard(pipelineId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next: LeadFilters) => {
      const qs = filtersToParams(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const { activeOrg, user } = useAuth();
  // Mesmo piso da tela "Etapas do funil" (minRole manager no catálogo): quem não
  // pode editar não vê o botão, em vez de cair numa tela que recusa.
  const podeEditarEtapas = Boolean(
    activeOrg &&
      ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager &&
      user.support?.access_mode !== "support_readonly",
  );
  const [etapasOpen, setEtapasOpen] = useState(false);
  const queryClient = useQueryClient();
  // Ao fechar a janela, o quadro relê as colunas: etapa criada, renomeada ou
  // arquivada lá dentro aparece aqui sem recarregar a página.
  const mudarEtapasOpen = (aberto: boolean) => {
    setEtapasOpen(aberto);
    if (!aberto) void queryClient.invalidateQueries({ queryKey: ["board", pipelineId] });
  };

  const filteredLeads = data ? applyFilters(data.leads, filters) : [];
  // Exclusão individual e eventos remotos podem tirar um card que estava
  // selecionado. A seleção exposta acompanha os dados vivos para a barra não
  // ficar contando um id que já não existe no quadro.
  const selectedIdsVisiveis = useMemo(() => {
    if (!data) return [];
    const existentes = new Set(data.leads.map((lead) => lead.id));
    return selectedIds.filter((id) => existentes.has(id));
  }, [data, selectedIds]);

  return (
    <div
      className="flex min-h-[600px] flex-col gap-4"
      // OBSERVÁVEL de propósito, e é a razão de existir desta linha: "a
      // assinatura morreu" e "nada aconteceu" produzem o MESMO silêncio na
      // tela, e sem este valor nem o produto nem o teste conseguem separar as
      // duas famílias de causa. Com ele, quem investiga olha DURANTE a rodada
      // que falha: `subscribed` manda procurar a montante (entrega, filtro, ou
      // o evento nunca saiu); `channel_error`/`timed_out`/`closed` já é a
      // resposta.
      //
      // Ainda NÃO religa — religar é desenho e merece bloco próprio. Isto aqui
      // é só parar de descartar o que já era calculado.
      data-realtime-status={realtimeStatus.toLowerCase()}
      // A rede de segurança fica OBSERVÁVEL pelo mesmo motivo do status do
      // canal: "a entrega morreu" e "nada aconteceu" têm a mesma aparência, que
      // é silêncio. Aqui o número de divergências é a diferença entre os dois —
      // e é o sinal que faltava para uma verificação poder APROVAR, e não só
      // reprovar.
      data-refetch-divergencias={seguranca.divergencias}
      data-refetch-em={seguranca.ultimaVerificacao ?? ""}
    >
      {/* `flex-col` no mobile: nome de funil comprido (é texto livre, sem
          limite curto) + botão na mesma linha sem quebra empurrava o botão pra
          fora da viewport em telas estreitas. De `sm:` pra cima volta a ser
          uma linha só, como sempre foi. */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">
          {data?.pipeline.name ?? initialName}
        </h1>
        <Button onClick={() => setNewOpen(true)} disabled={!data} className="shrink-0">
          <Plus size={16} className="mr-2" /> {t("Novo Lead")}
        </Button>
      </header>
      {podeEditarEtapas && (
        <Sheet open={etapasOpen} onOpenChange={mudarEtapasOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>{t("Etapas do funil")}</SheetTitle>
              <SheetDescription>{data?.pipeline.name ?? initialName}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              {etapasOpen && (
                <StagesSection
                  pipelineId={pipelineId}
                  ancoraMapeamento="/app/settings/tenant/pipelines"
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
      {data && (
        <NewLeadDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          pipelineId={pipelineId}
          stages={data.stages}
        />
      )}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        leads={data?.leads ?? []}
        extra={
          podeEditarEtapas ? (
            <Button variant="outline" size="sm" onClick={() => mudarEtapasOpen(true)}>
              <PencilSimple size={14} className="mr-1.5" /> {t("Editar etapas")}
            </Button>
          ) : null
        }
      />
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {t("Não consegui carregar este funil:")} {formatError(error, t)}
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-1 animate-pulse items-center justify-center text-muted-foreground">
          {t("Carregando…")}
        </div>
      ) : (
        <KanbanBoard
          pipelineId={pipelineId}
          stages={data.stages}
          leads={filteredLeads}
          pulses={pulses}
          pipeline={data.pipeline}
          selectedIds={selectedIdsVisiveis}
          onSelectionChange={setSelectedIds}
          leadInicial={searchParams.get("lead")}
        />
      )}
      <BulkActionBar
        selectedIds={selectedIdsVisiveis}
        stages={data?.stages ?? []}
        pipelineId={pipelineId}
        vocabulary={data?.pipeline.vocabulary ?? null}
        onClear={() => setSelectedIds([])}
      />
    </div>
  );
}
