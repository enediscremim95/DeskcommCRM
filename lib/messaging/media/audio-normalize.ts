/** Converte áudio recebido para MP3, formato aceito pelo adapter OpenAI-compatível. */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AudioNormalizeDeps {
  runFfmpeg?: (args: string[], cwd: string, timeoutMs: number) => Promise<void>;
}

function runFfmpeg(args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-nostdin", "-y", ...args], { cwd });
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("audio_transcode_timeout"));
    }, timeoutMs);
    proc.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-200);
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`audio_transcode_failed:${error.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`audio_transcode_failed:${code ?? "unknown"}:${stderr}`));
    });
  });
}

export async function normalizeAudioForModel(
  input: { buffer: Buffer; mime: string; timeoutMs: number },
  deps: AudioNormalizeDeps = {},
): Promise<{ buffer: Buffer; mime: "audio/mpeg" }> {
  const base = input.mime.split(";")[0]!.trim().toLowerCase();
  if (base === "audio/mpeg" || base === "audio/mp3") {
    return { buffer: input.buffer, mime: "audio/mpeg" };
  }
  const dir = await mkdtemp(join(tmpdir(), "media-audio-"));
  try {
    await writeFile(join(dir, "input"), input.buffer);
    await (deps.runFfmpeg ?? runFfmpeg)(
      ["-i", "input", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", "audio.mp3"],
      dir,
      input.timeoutMs,
    );
    const output = await readFile(join(dir, "audio.mp3"));
    if (output.byteLength === 0) throw new Error("audio_transcode_empty");
    return { buffer: output, mime: "audio/mpeg" };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
