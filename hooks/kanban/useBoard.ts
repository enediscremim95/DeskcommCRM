"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ehEcoLocal } from "@/lib/kanban/local-echo";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { useRefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";
import { apiClient } from "@/lib/api/client";
import type { BoardData, BoardStageChunk } from "@/lib/kanban/types";

/**
 * Fetch board via API route (NOT direct supabase-js).
 *
 * Why: the auth cookie `sb-deskcomm-auth` is httpOnly so the browser Supabase
 * client cannot read it — auth.uid() ends up null, RLS hides the pipeline,
 * and PostgREST returns PGRST116. Routing through /api/v1/pipelines/[id]/board
 * uses the server-side cookie reader, identical to every other authed query.
 */
async function fetchBoard(pipelineId: string): Promise<BoardData> {
  const res = await apiClient.get<{ data: BoardData }>(`/api/v1/pipelines/${pipelineId}/board`);
  // apiClient unwraps { data, meta } envelope already in some helpers;
  // ours returns the parsed JSON literally. Handle both shapes safely.
  if (res && typeof res === "object" && "data" in res) {
    return (res as { data: BoardData }).data;
  }
  return res as unknown as BoardData;
}

async function fetchStagePage(
  pipelineId: string,
  stageId: string,
  cursor: string,
): Promise<BoardStageChunk> {
  const query = new URLSearchParams({ stage_id: stageId, cursor });
  const res = await apiClient.get<{ data: BoardStageChunk }>(
    `/api/v1/pipelines/${pipelineId}/board?${query.toString()}`,
  );
  if (res && typeof res === "object" && "data" in res) {
    return (res as { data: BoardStageChunk }).data;
  }
  return res as unknown as BoardStageChunk;
}

/**
 * Quanto tempo o card fica marcado como "acabou de chegar".
 *
 * NÃO é para bater com `--duration-slow` (320ms) do CSS, e a diferença é
 * DELIBERADA: com movimento normal a animação dura os 320ms e o resto da
 * janela é invisível; com `prefers-reduced-motion` o fundo estático fica os
 * 1200ms inteiros, que é o que torna a alternativa perceptível — 320ms de
 * fundo estático ninguém vê. Alinhar os dois números "para consertar a
 * divergência" apaga a pista de acessibilidade.
 */
const PULSE_MS = 1_200;
const REFETCH_AGRUPADO_MS = 3_000;

/** O id do lead dentro do payload do postgres_changes (new, ou old no delete). */
function idDoEvento(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { new?: { id?: unknown }; old?: { id?: unknown } };
  const id = p.new?.id ?? p.old?.id;
  return typeof id === "string" ? id : null;
}

function registroDoEvento(payload: unknown): Partial<Lead> | null {
  if (!payload || typeof payload !== "object") return null;
  const registro = (payload as { new?: unknown }).new;
  if (!registro || typeof registro !== "object") return null;
  return registro as Partial<Lead>;
}

function tipoDoEvento(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const tipo = (payload as { eventType?: unknown }).eventType;
  return typeof tipo === "string" ? tipo : null;
}

/**
 * Aplica a linha entregue pelo Realtime antes da reconciliação com o servidor.
 * Campos enriquecidos que não vivem em crm_leads são preservados no UPDATE.
 */
function aplicarEventoNoBoard(
  board: BoardData | undefined,
  payload: unknown,
  pipelineId: string,
): BoardData | undefined {
  if (!board) return board;
  const leadId = idDoEvento(payload);
  if (!leadId) return board;

  const existente = board.leads.find((lead) => lead.id === leadId);
  const registro = registroDoEvento(payload);
  const remove =
    tipoDoEvento(payload) === "DELETE" ||
    (registro !== null &&
      (registro.pipeline_id !== pipelineId ||
        (registro as { status?: string }).status === "archived"));

  const stagePages = board.stage_pages ? { ...board.stage_pages } : undefined;
  const ajustarTotal = (stageId: string, delta: number) => {
    if (!stagePages) return;
    const page = stagePages[stageId];
    if (!page) return;
    stagePages[stageId] = { ...page, total: Math.max(0, page.total + delta) };
  };

  if (remove) {
    if (!existente) return board;
    ajustarTotal(existente.stage_id, -1);
    return {
      ...board,
      leads: board.leads.filter((lead) => lead.id !== leadId),
      stage_pages: stagePages,
    };
  }

  if (!registro || registro.pipeline_id !== pipelineId || typeof registro.stage_id !== "string") {
    return board;
  }

  // UPDATE de card que ainda não foi paginado não pode virar INSERT local:
  // isso inflaria o total e furaria a janela carregada. O refetch agrupado faz
  // a reconciliação porque o payload antigo não traz a etapa anterior.
  if (!existente && tipoDoEvento(payload) !== "INSERT") return board;

  const atualizado = existente
    ? ({ ...existente, ...registro } as Lead)
    : ({ ...registro, id: leadId } as Lead);
  if (existente) {
    if (existente.stage_id !== atualizado.stage_id) {
      ajustarTotal(existente.stage_id, -1);
      ajustarTotal(atualizado.stage_id, 1);
    }
  } else {
    ajustarTotal(atualizado.stage_id, 1);
  }

  let leads = existente
    ? board.leads.map((lead) => (lead.id === leadId ? atualizado : lead))
    : [...board.leads, atualizado];

  // Se a primeira página já estava cheia, um INSERT no topo desloca o último
  // card para a página seguinte. Mantemos a mesma janela visível até o refetch.
  const entrouNaEtapa = !existente || existente.stage_id !== atualizado.stage_id;
  if (entrouNaEtapa && stagePages?.[atualizado.stage_id]?.has_more) {
    const quantidadeCarregada = board.leads.filter(
      (lead) => lead.stage_id === atualizado.stage_id,
    ).length;
    const destaEtapa = leads
      .filter((lead) => lead.stage_id === atualizado.stage_id)
      .sort(
        (a, b) =>
          a.position_in_stage - b.position_in_stage || a.id.localeCompare(b.id),
      )
      .slice(0, Math.max(quantidadeCarregada, 1));
    const idsMantidos = new Set(destaEtapa.map((lead) => lead.id));
    leads = leads.filter(
      (lead) => lead.stage_id !== atualizado.stage_id || idsMantidos.has(lead.id),
    );
  }

  return { ...board, leads, stage_pages: stagePages };
}

export function useBoard(pipelineId: string | null) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["board", pipelineId] as const, [pipelineId]);

  /**
   * Cards que acabaram de mudar POR EVENTO REMOTO — o pulso da Wave 3.
   *
   * Só entra aqui o que veio de fora: a própria ação já tem feedback (o card se
   * move sob o cursor) e pulsar nela seria ruído com cara de novidade. Cada id
   * sai sozinho depois de PULSE_MS: o pulso acontece UMA vez e cessa, em vez de
   * virar destaque persistente.
   */
  const [pulses, setPulses] = useState<Map<string, number>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingStages = useRef<Set<string>>(new Set());
  const [loadingStageIds, setLoadingStageIds] = useState<Set<string>>(new Set());
  const [stageLoadErrors, setStageLoadErrors] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey,
    queryFn: () => fetchBoard(pipelineId as string),
    enabled: !!pipelineId,
  });

  const loadMoreStage = useCallback(
    async (stageId: string) => {
      if (!pipelineId || loadingStages.current.has(stageId)) return;
      const current = qc.getQueryData<BoardData>(queryKey);
      const page = current?.stage_pages?.[stageId];
      if (!page?.has_more || !page.cursor) return;

      loadingStages.current.add(stageId);
      setLoadingStageIds((ids) => new Set(ids).add(stageId));
      setStageLoadErrors((ids) => {
        const next = new Set(ids);
        next.delete(stageId);
        return next;
      });

      try {
        const chunk = await fetchStagePage(pipelineId, stageId, page.cursor);
        qc.setQueryData<BoardData>(queryKey, (board) => {
          if (!board) return board;
          const byId = new Map(board.leads.map((lead) => [lead.id, lead]));
          for (const lead of chunk.leads) byId.set(lead.id, lead);
          return {
            ...board,
            leads: [...byId.values()],
            stage_pages: {
              ...board.stage_pages,
              [stageId]: chunk.page,
            },
          };
        });
      } catch {
        setStageLoadErrors((ids) => new Set(ids).add(stageId));
      } finally {
        loadingStages.current.delete(stageId);
        setLoadingStageIds((ids) => {
          const next = new Set(ids);
          next.delete(stageId);
          return next;
        });
      }
    },
    [pipelineId, qc, queryKey],
  );

  const agendarRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void qc.invalidateQueries({ queryKey });
    }, REFETCH_AGRUPADO_MS);
  }, [qc, queryKey]);

  const onChange = useCallback(
    (payload: unknown) => {
      // O evento já traz a linha alterada: atualiza a tela agora e agrupa a
      // reconciliação completa. Rajadas deixam de recarregar N páginas a cada
      // escrita sem esconder a mudança do operador.
      if (pipelineId) {
        qc.setQueryData<BoardData>(queryKey, (board) =>
          aplicarEventoNoBoard(board, payload, pipelineId),
        );
      }
      agendarRefetch();

      const leadId = idDoEvento(payload);
      // Janela, não marca gasta por evento: uma ação minha chega aqui em DUAS
      // parcelas (o movimento e o carimbo de `last_activity_at` da atividade).
      if (!leadId || ehEcoLocal(leadId)) return;

      // CONTADOR, não booleano. Com um Set, o segundo evento remoto no mesmo
      // card dentro da janela não mudava nada: o id já estava lá, a classe
      // nunca saía do elemento e a animação CSS não reinicia sem a classe
      // sair — pior, o timeout do primeiro evento apagava tudo no meio do
      // segundo. Chegava coisa de fora e a tela não dizia nada, que é o pecado
      // que esta peça existe para matar.
      setPulses((atual) => {
        const proximo = new Map(atual);
        proximo.set(leadId, (proximo.get(leadId) ?? 0) + 1);
        return proximo;
      });

      // Cada evento reinicia a contagem: a janela é do ÚLTIMO evento.
      const anterior = timers.current.get(leadId);
      if (anterior) clearTimeout(anterior);
      timers.current.set(
        leadId,
        setTimeout(() => {
          timers.current.delete(leadId);
          setPulses((atual) => {
            if (!atual.has(leadId)) return atual;
            const proximo = new Map(atual);
            proximo.delete(leadId);
            return proximo;
          });
        }, PULSE_MS),
      );
    },
    [agendarRefetch, pipelineId, qc, queryKey],
  );

  // O STATUS DO CANAL NÃO PODE SER DESCARTADO. `useRealtimeChannel` calcula
  // SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED e, sem atribuir o retorno,
  // esse valor morria na linha seguinte — enquanto ele é o único que separa
  // DUAS FAMÍLIAS INTEIRAS de causa: "a assinatura morreu" e "nada aconteceu"
  // têm exatamente a mesma aparência na tela, que é silêncio.
  //
  // Assinatura que morre calada é peça sem sinal de vida: o "log morto" do
  // checklist do sistema vivo, na versão cara, porque a tela continua parecendo
  // certa enquanto o board já não escuta mais nada.
  const { status: realtimeStatus, ultimaEntrega } = useRealtimeChannel({
    name: pipelineId ? `kanban-${pipelineId}` : "kanban-disabled",
    postgresChanges: pipelineId
      ? {
          event: "*",
          schema: "public",
          table: "crm_leads",
          filter: `pipeline_id=eq.${pipelineId}`,
        }
      : undefined,
    onChange,
    enabled: !!pipelineId,
  });

  // Timers pendentes morrem com o componente — senão um setState chega depois
  // do unmount e o React reclama (e o Map de timers vaza).
  useEffect(() => {
    const pendentes = timers.current;
    return () => {
      for (const t of pendentes.values()) clearTimeout(t);
      pendentes.clear();
      if (refetchTimer.current) {
        clearTimeout(refetchTimer.current);
        refetchTimer.current = null;
      }
    };
  }, []);

  // A REDE DE SEGURANÇA. Sem ela, um canal que para de entregar deixa o board
  // congelado num passado que parece presente — e nem voltar para a aba
  // conserta. A assinatura é a contagem de leads mais o maior `updated_at`: é
  // sensível a exatamente o que o canal deveria ter trazido (lead novo, lead
  // movido, lead editado) e barata de calcular a cada verificação.
  const seguranca = useRefetchDeSeguranca<BoardData>({
    queryKey,
    assinatura: (d) => {
      const leads = d?.leads ?? [];
      let maior = "";
      for (const l of leads) {
        const u = (l as { updated_at?: string }).updated_at ?? "";
        if (u > maior) maior = u;
      }
      return `${leads.length}:${maior}`;
    },
    ultimaEntrega,
    enabled: !!pipelineId,
  });

  return {
    ...query,
    pulses,
    realtimeStatus,
    seguranca,
    loadMoreStage,
    loadingStageIds,
    stageLoadErrors,
  };
}
