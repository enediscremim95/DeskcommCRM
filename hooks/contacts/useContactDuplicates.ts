"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { MotivoDeDuplicidade } from "@/lib/contacts/duplicados";

export interface ContatoDuplicado {
  id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  phone_number: string | null;
  created_at: string;
  last_activity_at: string | null;
}

export interface GrupoDuplicado {
  chave: string;
  queue_id?: string;
  motivos: MotivoDeDuplicidade[];
  principal_sugerido: string;
  contatos: ContatoDuplicado[];
}

export interface MesclagemAutomaticaRecente {
  id: string;
  whatsapp_contact_id: string;
  form_contact_id: string;
  whatsapp_name: string | null;
  form_name: string | null;
  whatsapp_phone: string | null;
  original_form_phone: string | null;
  merged_at: string;
}

interface DuplicatesResponse {
  data: GrupoDuplicado[];
  meta?: {
    varreu_tudo?: boolean;
    contatos_varridos?: number;
    mesclagens_automaticas?: MesclagemAutomaticaRecente[];
  };
}

/**
 * A varredura só roda quando alguém abre a tela (`enabled`), e não fica
 * revalidando em foco: é uma leitura de toda a base de contatos vivos, cara o
 * bastante para não valer a pena repetir sozinha atrás de um diálogo fechado.
 */
export function useContactDuplicates(enabled: boolean) {
  return useQuery({
    queryKey: ["contacts", "duplicates"],
    enabled,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        return await apiClient.get<DuplicatesResponse>("/api/v1/contacts/duplicates");
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}
