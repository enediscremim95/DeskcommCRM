/** Duração de áudio/vídeo medida localmente com ffprobe, sem enviar bytes. */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extFromMime } from "@/lib/messaging/media/types";

const PROBE_TIMEOUT_MS = 10_000;

export interface DurationProbeDeps {
  runProbe?: (file: string, timeoutMs: number) => Promise<number>;
}

function runFfprobe(file: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("media_probe_timeout"));
    }, timeoutMs);
    proc.stdout.on("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-100);
    });
    proc.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-200);
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`media_probe_failed:${error.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const duration = Number(stdout.trim());
      if (code !== 0 || !Number.isFinite(duration) || duration < 0) {
        reject(new Error(`media_probe_failed:${code ?? "unknown"}:${stderr}`));
      } else {
        resolve(duration);
      }
    });
  });
}

export async function probeMediaDuration(
  buffer: Buffer,
  mime: string,
  deps: DurationProbeDeps = {},
): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "media-probe-"));
  const file = join(dir, `input.${extFromMime(mime)}`);
  try {
    await writeFile(file, buffer);
    return await (deps.runProbe ?? runFfprobe)(file, PROBE_TIMEOUT_MS);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

