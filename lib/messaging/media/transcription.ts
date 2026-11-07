/**
 * Transcrição de áudio plugável (Onda 3). Default: API speech-to-text
 * OpenAI-compatível (Whisper) via BYOK. O derivado é texto → alimenta QUALQUER
 * modelo de chat (camada universal). Um backend mlx-whisper local implementa a
 * mesma interface para self-host em Apple Silicon (fora deste MVP).
 */
export interface TranscriptionProvider {
  transcribe(audio: Buffer, mime: string): Promise<string>;
}

export interface TranscriptionCreds {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxNetworkRetries?: number;
}

const DEFAULT_BASE = "https://api.openai.com";
const DEFAULT_MODEL = "whisper-1";

function extFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  if (base.includes("webm")) return "webm";
  if (base.includes("wav")) return "wav";
  return "bin";
}

export function apiTranscriptionProvider(
  creds: TranscriptionCreds,
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider {
  const base = creds.baseUrl ?? DEFAULT_BASE;
  const model = creds.model ?? DEFAULT_MODEL;
  return {
    async transcribe(audio, mime) {
      const attempts = 1 + Math.max(0, Math.min(1, creds.maxNetworkRetries ?? 0));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const form = new FormData();
        form.append("model", model);
        form.append(
          "file",
          new Blob([new Uint8Array(audio)], { type: mime.split(";")[0]!.trim() }),
          `audio.${extFor(mime)}`,
        );
        try {
          const res = await fetchImpl(`${base}/v1/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${creds.apiKey}` },
            body: form,
            signal: AbortSignal.timeout(creds.timeoutMs ?? 45_000),
          });
          const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
          if (!res.ok && retryable && attempt + 1 < attempts) continue;
          if (!res.ok) throw new Error(`transcription_${res.status}`);
          const json = (await res.json()) as { text?: string };
          return json.text ?? "";
        } catch (error) {
          const networkFailure = error instanceof TypeError ||
            (error instanceof DOMException && error.name === "TimeoutError");
          if (networkFailure && attempt + 1 < attempts) continue;
          throw error;
        }
      }
      throw new Error("transcription_network_failed");
    },
  };
}
