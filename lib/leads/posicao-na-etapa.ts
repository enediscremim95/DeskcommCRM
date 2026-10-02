import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";

export type LadoDaEtapa = "topo" | "fim";

/**
 * Reserva uma posição sem check-then-act no processo da aplicação.
 *
 * A função do banco serializa as reservas por etapa numa linha durável. Assim,
 * duas entradas concorrentes recebem números distintos mesmo que nenhuma das
 * duas ainda tenha gravado o lead. Uma reserva cujo INSERT/UPDATE posterior
 * falhe deixa apenas um intervalo vazio, o que é válido no fractional indexing.
 */
export async function reservarPosicaoNaEtapa(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    stageId: string;
    lado: LadoDaEtapa;
    requestId: string;
  },
): Promise<number> {
  const { data, error } = await supabase.rpc("fn_reservar_posicao_lead_na_etapa", {
    p_organization_id: params.organizationId,
    p_stage_id: params.stageId,
    p_lado: params.lado,
  });

  if (error) {
    throw new ApiError(500, "internal_error", undefined, params.requestId, error.message);
  }

  const position = Number(data);
  if (data === null || data === undefined || data === "" || !Number.isFinite(position)) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      params.requestId,
      "A reserva de posição do lead devolveu um valor inválido.",
    );
  }

  return position;
}
