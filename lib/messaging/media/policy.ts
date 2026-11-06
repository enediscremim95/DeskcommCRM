/**
 * Política de leitura de mídia recebida.
 *
 * O fallback OpenRouter é opt-in por organização. Lista vazia preserva o
 * comportamento anterior para todas as organizações. Os demais knobs têm
 * defaults seguros, e uma variável operacional inválida não derruba o worker.
 */

import { z } from "zod";

import { logger } from "@/lib/logger";

export type DerivableMediaKind = "audio" | "image" | "video" | "document";

export interface MediaDerivationPolicy {
  openrouterEnabledForOrganization: boolean;
  openrouterAudioModel: string;
  openrouterVisionModel: string;
  timeoutMs: number;
  audioMaxBytes: number;
  audioMaxSeconds: number;
  imageMaxBytes: number;
  videoMaxBytes: number;
  videoMaxSeconds: number;
  videoMaxFrames: number;
  pdfMaxBytes: number;
  pdfMaxPages: number;
}

const DEFAULTS: MediaDerivationPolicy = {
  openrouterEnabledForOrganization: false,
  openrouterAudioModel: "google/gemini-2.5-flash",
  openrouterVisionModel: "google/gemini-2.5-flash",
  timeoutMs: 45_000,
  audioMaxBytes: 15 * 1024 * 1024,
  audioMaxSeconds: 180,
  imageMaxBytes: 10 * 1024 * 1024,
  videoMaxBytes: 50 * 1024 * 1024,
  videoMaxSeconds: 60,
  videoMaxFrames: 4,
  pdfMaxBytes: 20 * 1024 * 1024,
  pdfMaxPages: 50,
};

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) return fallback;
  return parsed;
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

const UUID = z.string().uuid();
let cachedOpenrouterOrgIdsRaw: string | undefined;
let cachedOpenrouterOrgIds = new Set<string>();

function openrouterOrgIds(raw: string | undefined): ReadonlySet<string> {
  const normalizedRaw = raw ?? "";
  if (normalizedRaw === cachedOpenrouterOrgIdsRaw) return cachedOpenrouterOrgIds;

  const valid = new Set<string>();
  let invalidCount = 0;
  for (const item of normalizedRaw.split(",")) {
    const candidate = item.trim().toLowerCase();
    if (!candidate) continue;
    if (UUID.safeParse(candidate).success) valid.add(candidate);
    else invalidCount += 1;
  }

  cachedOpenrouterOrgIdsRaw = normalizedRaw;
  cachedOpenrouterOrgIds = valid;
  if (invalidCount > 0) {
    logger.warn("[media-policy] UUID inválido ignorado em MEDIA_OPENROUTER_ORG_IDS", {
      invalid_count: invalidCount,
    });
  }
  return valid;
}

export function mediaDerivationPolicy(
  organizationId: string,
  source: Partial<NodeJS.ProcessEnv> = process.env,
): MediaDerivationPolicy {
  return {
    openrouterEnabledForOrganization: openrouterOrgIds(
      source.MEDIA_OPENROUTER_ORG_IDS,
    ).has(organizationId.toLowerCase()),
    openrouterAudioModel: nonEmpty(
      source.MEDIA_OPENROUTER_AUDIO_MODEL,
      DEFAULTS.openrouterAudioModel,
    ),
    openrouterVisionModel: nonEmpty(
      source.MEDIA_OPENROUTER_VISION_MODEL,
      DEFAULTS.openrouterVisionModel,
    ),
    timeoutMs: positiveInt(source.MEDIA_AI_TIMEOUT_MS, DEFAULTS.timeoutMs, 120_000),
    audioMaxBytes: positiveInt(
      source.MEDIA_AUDIO_MAX_BYTES,
      DEFAULTS.audioMaxBytes,
      50 * 1024 * 1024,
    ),
    audioMaxSeconds: positiveInt(
      source.MEDIA_AUDIO_MAX_SECONDS,
      DEFAULTS.audioMaxSeconds,
      3_600,
    ),
    imageMaxBytes: positiveInt(
      source.MEDIA_IMAGE_MAX_BYTES,
      DEFAULTS.imageMaxBytes,
      50 * 1024 * 1024,
    ),
    videoMaxBytes: positiveInt(
      source.MEDIA_VIDEO_MAX_BYTES,
      DEFAULTS.videoMaxBytes,
      50 * 1024 * 1024,
    ),
    videoMaxSeconds: positiveInt(
      source.MEDIA_VIDEO_MAX_SECONDS,
      DEFAULTS.videoMaxSeconds,
      3_600,
    ),
    videoMaxFrames: positiveInt(
      source.MEDIA_VIDEO_MAX_FRAMES,
      DEFAULTS.videoMaxFrames,
      8,
    ),
    pdfMaxBytes: positiveInt(
      source.MEDIA_PDF_MAX_BYTES,
      DEFAULTS.pdfMaxBytes,
      50 * 1024 * 1024,
    ),
    pdfMaxPages: positiveInt(source.MEDIA_PDF_MAX_PAGES, DEFAULTS.pdfMaxPages, 200),
  };
}

export type MediaLimitCode =
  | "audio_too_large"
  | "audio_too_long"
  | "image_too_large"
  | "video_too_large"
  | "video_too_long"
  | "pdf_too_large";

export class MediaDerivationLimitError extends Error {
  constructor(public readonly code: MediaLimitCode) {
    super(code);
    this.name = "MediaDerivationLimitError";
  }
}

export function assertMediaWithinLimits(input: {
  kind: string;
  bytes: number;
  durationSeconds?: number | null;
  policy: MediaDerivationPolicy;
}): void {
  const { kind, bytes, durationSeconds, policy } = input;
  if (kind === "audio") {
    if (bytes > policy.audioMaxBytes) throw new MediaDerivationLimitError("audio_too_large");
    if (durationSeconds !== undefined && durationSeconds !== null && durationSeconds > policy.audioMaxSeconds)
      throw new MediaDerivationLimitError("audio_too_long");
  } else if (kind === "image") {
    if (bytes > policy.imageMaxBytes) throw new MediaDerivationLimitError("image_too_large");
  } else if (kind === "video") {
    if (bytes > policy.videoMaxBytes) throw new MediaDerivationLimitError("video_too_large");
    if (durationSeconds !== undefined && durationSeconds !== null && durationSeconds > policy.videoMaxSeconds)
      throw new MediaDerivationLimitError("video_too_long");
  } else if (kind === "document" && bytes > policy.pdfMaxBytes) {
    throw new MediaDerivationLimitError("pdf_too_large");
  }
}
