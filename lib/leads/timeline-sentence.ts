import type { TimelineItemView } from "@/lib/types/contacts";

type Translate = (value: string) => string;

function lossReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const match = reason.match(/^Perdido\s*(?:—|-)\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function timelineSentence(
  item: TimelineItemView,
  actor: string,
  t: Translate,
): { sentence: string; showReason: boolean } {
  if (item.type === "lead_created") return { sentence: t("Lead criado"), showReason: false };
  if (item.type === "stage_changed") {
    const destination =
      typeof item.payload.to_stage_name === "string" ? item.payload.to_stage_name : null;
    return {
      sentence: destination
        ? `${actor} ${t("alterou a etapa para")} ${destination}`
        : `${actor} ${t("alterou a etapa")}`,
      showReason: !destination,
    };
  }
  if (item.type === "demand_closed") {
    const outcome = item.payload.desfecho;
    if (outcome === "won")
      return { sentence: `${actor} ${t("marcou como ganho")}`, showReason: false };
    const reason = lossReason(item.reason);
    return {
      sentence: reason
        ? `${actor} ${t("marcou como perdido, motivo:")} ${reason}`
        : `${actor} ${t("marcou como perdido")}`,
      showReason: false,
    };
  }
  if (
    item.type === "lead_edited" &&
    (item.payload.field === "owner_user_id" ||
      item.payload.field === "owner_agent_id" ||
      (Array.isArray(item.payload.fields) &&
        item.payload.fields.some(
          (field) => field === "owner_user_id" || field === "owner_agent_id",
        )))
  ) {
    return { sentence: `${actor} ${t("alterou o responsável")}`, showReason: false };
  }
  return { sentence: t(item.type), showReason: true };
}
