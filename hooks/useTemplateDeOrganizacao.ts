"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface TemplateDoCatalogo {
  id: string;
  nome: string;
  para_quem: string;
  quantas_respostas: number;
  quantas_cadencias: number;
  quantos_campos: number;
}

export interface TemplateAplicado {
  id: string;
  aplicado_em: string;
  aplicado_por: string | null;
}

interface CatalogoResponse {
  data: {
    catalogo: TemplateDoCatalogo[];
    aplicado: TemplateAplicado | null;
  };
}

interface AplicacaoResponse {
  data: {
    template_id: string;
    etapas: number;
    respostas_criadas: number;
    cadencias_criadas: number;
    atendente_aplicado: boolean;
    respostas_preservadas: number;
    cadencias_preservadas: number;
    regras_da_casa_preservadas: boolean;
    atendente_preservado: boolean;
    estado_hibrido: boolean;
  };
}

export function useCatalogoDeTemplates(tenantId: string) {
  return useQuery({
    queryKey: ["admin", "tenant", tenantId, "template"] as const,
    queryFn: () =>
      apiClient.get<CatalogoResponse>(`/api/v1/admin/tenants/${tenantId}/template`),
    // O catálogo é código versionado; só muda quando a aplicação sobe. O que
    // muda de verdade é `aplicado`, e isso é invalidado pela mutação.
    staleTime: 5 * 60_000,
    enabled: !!tenantId,
  });
}

export function useAplicarTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tenantId, templateId }: { tenantId: string; templateId: string }) =>
      apiClient.post<AplicacaoResponse>(`/api/v1/admin/tenants/${tenantId}/template`, {
        template_id: templateId,
      }),
    onSuccess: (resposta, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "tenant", variables.tenantId],
      });
      const d = resposta?.data;
      // O número importa: "aplicado" sem contagem não distingue aplicar de
      // aplicar de novo, e aplicar de novo não recria o que já existe.
      toast.success("Template aplicado", {
        description: d
          ? `${d.etapas} etapas no funil · ${d.respostas_criadas} resposta(s) nova(s) · ${d.cadencias_criadas} cadência(s) nova(s), desligada(s)${d.respostas_preservadas || d.cadencias_preservadas || d.regras_da_casa_preservadas || d.atendente_preservado ? " · alguns itens anteriores foram preservados" : ""}`
          : undefined,
      });
    },
    onError: (err: Error) => {
      toast.error("Não foi possível aplicar o template", { description: err.message });
    },
  });
}
