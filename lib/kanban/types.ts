import type { Lead } from "@/lib/types/leads";

export interface PipelineVocabulary {
  lead?: string;
  deal?: string;
  won?: string;
  lost?: string;
}

export interface Pipeline {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  is_archived: boolean;
  position: number;
  vocabulary: PipelineVocabulary;
  settings: Record<string, unknown>;
}

export interface Stage {
  id: string;
  organization_id: string;
  pipeline_id: string;
  name: string;
  slug: string;
  position: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  is_archived: boolean;
  expected_duration_hours: number | null;
}

export interface BoardStagePage {
  total: number;
  cursor: string | null;
  has_more: boolean;
  /** Posição do primeiro card ainda não carregado, usada como limite no arrasto. */
  next_position_in_stage: number | null;
}

export interface BoardData {
  pipeline: Pipeline;
  stages: Stage[];
  leads: Lead[];
  /** Metadados independentes por coluna. Opcional para consumidores legados. */
  stage_pages?: Record<string, BoardStagePage>;
}

export interface BoardStageChunk {
  stage_id: string;
  leads: Lead[];
  page: BoardStagePage;
}
