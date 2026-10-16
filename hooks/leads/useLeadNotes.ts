"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { TimelineItemView } from "@/lib/types/contacts";

interface TimelineResponse {
  data: TimelineItemView[];
}

export function useLeadNotes(leadId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["lead-notes", leadId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.get<TimelineResponse>(`/api/v1/leads/${leadId}/timeline?type=note&limit=100`),
  });

  const createNote = useMutation({
    mutationFn: (text: string) =>
      apiClient.post<{ data: TimelineItemView }>(`/api/v1/leads/${leadId}/notes`, { text }),
    onSuccess: (response) => {
      queryClient.setQueryData<TimelineResponse>(queryKey, (current) => ({
        data: [
          response.data,
          ...(current?.data ?? []).filter((note) => note.id !== response.data.id),
        ],
      }));
      void queryClient.invalidateQueries({ queryKey: ["timeline", leadId] });
    },
    onError: showApiError,
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: string) =>
      apiClient.delete<void>(`/api/v1/leads/${leadId}/notes/${noteId}`),
    onSuccess: (_response, noteId) => {
      queryClient.setQueryData<TimelineResponse>(queryKey, (current) => ({
        data: (current?.data ?? []).filter((note) => note.id !== noteId),
      }));
      void queryClient.invalidateQueries({ queryKey: ["timeline", leadId] });
    },
    onError: showApiError,
  });

  return {
    notes: query.data?.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    createNote,
    deleteNote,
  };
}
