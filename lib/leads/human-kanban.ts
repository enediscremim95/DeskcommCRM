import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";

/** Decisão de etapa/desfecho exige uma ação humana nesta requisição. */
export function requireHumanKanban(ctx: HandlerCtx): void {
  if (ctx.actor.type !== "user") {
    throw new ApiError(403, "forbidden", undefined, ctx.requestId,
      "Somente uma pessoa pode mudar a etapa ou o desfecho do negócio.");
  }
}
