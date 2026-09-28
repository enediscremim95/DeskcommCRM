import { midpoint } from "@/lib/kanban/fractional-indexing";
import type { BoardData } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

export function positionForPaginatedDrop(
  leads: Lead[],
  destinationIndex: number,
  draggableId: string,
  nextUnloadedPosition: number | null,
): number {
  const destination = leads.filter((lead) => lead.id !== draggableId);
  const before = destinationIndex > 0 ? destination[destinationIndex - 1] : null;
  const visibleAfter = destinationIndex < destination.length ? destination[destinationIndex] : null;
  const afterPosition =
    visibleAfter?.position_in_stage ??
    (destinationIndex >= destination.length ? nextUnloadedPosition : null);

  return midpoint(before?.position_in_stage ?? null, afterPosition);
}

export function applyPaginatedMove(
  board: BoardData,
  args: { leadId: string; stageId: string; positionInStage: number },
): BoardData {
  const moved = board.leads.find((lead) => lead.id === args.leadId);
  if (!moved) return board;

  const stagePages = board.stage_pages ? { ...board.stage_pages } : undefined;
  if (stagePages && moved.stage_id !== args.stageId) {
    const source = stagePages[moved.stage_id];
    const destination = stagePages[args.stageId];
    if (source) stagePages[moved.stage_id] = { ...source, total: Math.max(0, source.total - 1) };
    if (destination) stagePages[args.stageId] = { ...destination, total: destination.total + 1 };
  }

  return {
    ...board,
    stage_pages: stagePages,
    leads: board.leads.map((lead) =>
      lead.id === args.leadId
        ? { ...lead, stage_id: args.stageId, position_in_stage: args.positionInStage }
        : lead,
    ),
  };
}
