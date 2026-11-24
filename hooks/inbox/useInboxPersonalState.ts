"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import {
  conversationsSearchParams,
  type ConversationsFilters,
  type ListResponse,
} from "@/hooks/inbox/useConversationsRealtime";

export function usePinnedConversations(filters: ConversationsFilters, orgId: string | null) {
  return useInfiniteQuery({
    queryKey: ["conversations-pinned", orgId, filters],
    enabled: Boolean(orgId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = conversationsSearchParams({ ...filters, pinned: true }, pageParam);
      return apiClient.get<ListResponse>(`/api/v1/conversations?${qs.toString()}`);
    },
    getNextPageParam: (last) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
    refetchOnWindowFocus: true,
  });
}

function alterarEntidadeNoCache(
  valor: unknown,
  id: string,
  patch: Record<string, unknown>,
): unknown {
  if (Array.isArray(valor)) return valor.map((item) => alterarEntidadeNoCache(item, id, patch));
  if (!valor || typeof valor !== "object") return valor;
  const registro = valor as Record<string, unknown>;
  const base = registro.id === id ? { ...registro, ...patch } : registro;
  let mudou = base !== registro;
  const resultado: Record<string, unknown> = { ...base };
  for (const [chave, filho] of Object.entries(base)) {
    const novoFilho = alterarEntidadeNoCache(filho, id, patch);
    if (novoFilho !== filho) {
      resultado[chave] = novoFilho;
      mudou = true;
    }
  }
  return mudou ? resultado : valor;
}

type Snapshot = Array<[readonly unknown[], unknown]>;

function restaurar(qc: ReturnType<typeof useQueryClient>, snapshots: Snapshot) {
  for (const [queryKey, data] of snapshots) qc.setQueryData(queryKey, data);
}

export function useUpdateConversationPersonalState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { conversation_id: string; favorited?: boolean; pinned?: boolean }) =>
      apiClient.patch<{ data: { favorited_at: string | null; pinned_at: string | null } }>(
        `/api/v1/conversations/${args.conversation_id}/personal-state`,
        { favorited: args.favorited, pinned: args.pinned },
      ),
    onMutate: async (args) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["conversations"] }),
        qc.cancelQueries({ queryKey: ["conversations-pinned"] }),
      ]);
      const snapshots = [
        ...qc.getQueriesData({ queryKey: ["conversations"] }),
        ...qc.getQueriesData({ queryKey: ["conversations-pinned"] }),
      ] as Snapshot;
      const conversa = qc.getQueryData(["conversation", args.conversation_id]);
      snapshots.push([["conversation", args.conversation_id], conversa]);
      const agora = new Date().toISOString();
      const patch = {
        ...(args.favorited === undefined ? {} : { favorited_at: args.favorited ? agora : null }),
        ...(args.pinned === undefined ? {} : { pinned_at: args.pinned ? agora : null }),
      };
      qc.setQueriesData({ queryKey: ["conversations"] }, (data) =>
        alterarEntidadeNoCache(data, args.conversation_id, patch),
      );
      qc.setQueriesData({ queryKey: ["conversations-pinned"] }, (data) =>
        alterarEntidadeNoCache(data, args.conversation_id, patch),
      );
      qc.setQueryData(["conversation", args.conversation_id], (data: unknown) =>
        alterarEntidadeNoCache(data, args.conversation_id, patch),
      );
      return snapshots;
    },
    onError: (error, _args, snapshots) => {
      if (snapshots) restaurar(qc, snapshots);
      showApiError(error);
    },
    onSettled: (_data, _error, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversations-pinned"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}

export function useUpdateMessagePersonalState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { message_id: string; starred: boolean }) =>
      apiClient.patch<{ data: { starred_at: string | null } }>(
        `/api/v1/messages/${args.message_id}/personal-state`,
        { starred: args.starred },
      ),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["messages"] });
      const snapshots = qc.getQueriesData({ queryKey: ["messages"] }) as Snapshot;
      const patch = { starred_at: args.starred ? new Date().toISOString() : null };
      qc.setQueriesData({ queryKey: ["messages"] }, (data) =>
        alterarEntidadeNoCache(data, args.message_id, patch),
      );
      return snapshots;
    },
    onError: (error, _args, snapshots) => {
      if (snapshots) restaurar(qc, snapshots);
      showApiError(error);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["messages"] }),
  });
}
