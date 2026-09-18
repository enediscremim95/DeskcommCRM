"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { LeadComContexto } from "@/lib/types/leads";

export function useContactLeads(contactId: string) {
  return useQuery({
    queryKey: ["contact-leads", contactId],
    enabled: Boolean(contactId),
    queryFn: async () => {
      const response = await apiClient.get<{ data: LeadComContexto[] }>(
        `/api/v1/contacts/${contactId}/leads`,
      );
      return response.data;
    },
  });
}
