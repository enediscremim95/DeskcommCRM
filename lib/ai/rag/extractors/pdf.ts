/**
 * Extração de texto de PDF fora do processo principal.
 *
 * `pdfjs-dist` interpreta estruturas controladas pelo arquivo. Um PDF corrompido
 * já levou o heap do worker principal ao limite e derrubou a fila inteira. A
 * engine roda, por isso, num Worker com heap próprio, timeout e transferência de
 * posse do ArrayBuffer. Se o isolado morrer, só aquela extração falha.
 */
import { Worker } from "node:worker_threads";

/** Mesmo teto aceito pela tela de materiais de conhecimento. */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
/** A spec de RAG promete ingestão de documentos de até 50 páginas. */
export const PDF_MAX_PAGES = 50;
/** Teto defensivo do texto completo usado pelo RAG. */
export const PDF_MAX_TEXT_CHARS = 1_000_000;
/** O derivado de mensagem nunca usa mais que isto. */
export const PDF_MEDIA_MAX_TEXT_CHARS = 8_000;
export const PDF_EXTRACTION_TIMEOUT_MS = 30_000;
export const PDF_ISOLATE_MAX_OLD_GENERATION_MB = 96;

export type PdfExtractErrorCode =
  | "pdf_too_large"
  | "pdf_too_many_pages"
  | "pdf_isolate_timeout"
  | "pdf_isolate_memory"
  | "pdf_missing_canvas"
  | "pdf_image_only"
  | "pdf_extract_failed";

export class PdfExtractError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly code: PdfExtractErrorCode = "pdf_extract_failed",
  ) {
    super(message);
    this.name = "PdfExtractError";
  }
}

/** Limite deliberado: o evento deve terminar como pulado, não ser retentado. */
export class PdfExtractLimitError extends PdfExtractError {
  constructor(message: string, code: "pdf_too_large" | "pdf_too_many_pages") {
    super(message, undefined, code);
    this.name = "PdfExtractLimitError";
  }
}

export class PdfExtractIsolationError extends PdfExtractError {
  constructor(
    message: string,
    code: Exclude<PdfExtractErrorCode, "pdf_too_large" | "pdf_too_many_pages">,
    cause?: unknown,
  ) {
    super(message, cause, code);
    this.name = "PdfExtractIsolationError";
  }
}

interface PdfWorkerResult {
  kind: "ok" | "limit" | "error";
  text?: string;
  code?: PdfExtractErrorCode;
  detail?: string;
}

export type PdfIsolatedRunner = (buffer: Buffer, maxTextChars: number) => Promise<string>;

export interface PdfExtractDependencies {
  runIsolated?: PdfIsolatedRunner;
  maxTextChars?: number;
}

/*
 * JavaScript puro e autocontido para funcionar tanto no worker TSX quanto no
 * Next standalone. Um arquivo auxiliar relativo sumiria do caminho ao ser
 * empacotado em `.next/standalone`; `eval` mantém a fronteira dentro do módulo.
 */
const PDF_WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");

parentPort.once("message", async ({ bytes, maxPages, maxChars }) => {
  let document = null;
  let loadingTask = null;
  let result;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    document = await loadingTask.promise;

    if (document.numPages > maxPages) {
      result = {
        kind: "limit",
        code: "pdf_too_many_pages",
        detail: "PDF tem páginas demais para extrair texto",
      };
    } else {
      let combined = "";
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
            .join("")
            .trim();
          if (pageText.length > 0) {
            combined += (combined.length > 0 ? "\n\n" : "") + pageText;
            if (combined.length >= maxChars) break;
          }
        } finally {
          page.cleanup();
        }
      }

      combined = combined.slice(0, maxChars).trim();
      result = combined.length > 0
        ? { kind: "ok", text: combined }
        : {
            kind: "error",
            code: "pdf_image_only",
            detail: "pdfjs-dist extracted no text (possibly image-only PDF)",
          };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    result = /DOMMatrix|@napi-rs\/canvas/.test(detail)
      ? { kind: "error", code: "pdf_missing_canvas", detail }
      : { kind: "error", code: "pdf_extract_failed", detail };
  } finally {
    try {
      if (document) await document.destroy();
      else if (loadingTask) await loadingTask.destroy();
    } catch {}
  }
  parentPort.postMessage(result);
});
`;

function transferableBytes(buffer: Buffer): ArrayBuffer {
  const source = buffer.buffer;
  if (
    source instanceof ArrayBuffer &&
    buffer.byteOffset === 0 &&
    buffer.byteLength === source.byteLength
  ) {
    return source;
  }

  // Buffers pequenos podem compartilhar o slab do Node, que não deve ser
  // transferido inteiro. A cópia fica com o isolado; nenhuma referência global
  // a ela permanece no processo principal.
  return Uint8Array.from(buffer).buffer;
}

function isolatedErrorFromWorker(result: PdfWorkerResult): PdfExtractError {
  const code = result.code ?? "pdf_extract_failed";
  if (code === "pdf_too_many_pages") {
    return new PdfExtractLimitError(
      result.detail ?? "PDF tem páginas demais para extrair texto",
      code,
    );
  }
  if (code === "pdf_missing_canvas") {
    return new PdfExtractIsolationError(
      "Extração de PDF indisponível: o binário nativo @napi-rs/canvas não foi instalado nesta plataforma. " +
        "Reinstale as dependências sem podar as opcionais.",
      code,
    );
  }
  return new PdfExtractIsolationError(
    result.detail ?? "pdfjs-dist failed to extract text from the PDF",
    code === "pdf_image_only" ? code : "pdf_extract_failed",
  );
}

export function runPdfExtractionIsolated(
  buffer: Buffer,
  maxTextChars = PDF_MAX_TEXT_CHARS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(PDF_WORKER_SOURCE, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: PDF_ISOLATE_MAX_OLD_GENERATION_MB,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    let settled = false;

    const finish = (outcome: { text: string } | { error: PdfExtractError }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate();
      if ("text" in outcome) resolve(outcome.text);
      else reject(outcome.error);
    };

    const timer = setTimeout(() => {
      finish({
        error: new PdfExtractIsolationError(
          "Extração isolada de PDF excedeu o tempo limite",
          "pdf_isolate_timeout",
        ),
      });
    }, PDF_EXTRACTION_TIMEOUT_MS);

    worker.once("message", (result: PdfWorkerResult) => {
      if (result.kind === "ok" && typeof result.text === "string") {
        finish({ text: result.text });
      } else {
        finish({ error: isolatedErrorFromWorker(result) });
      }
    });
    worker.once("error", (error: Error & { code?: string }) => {
      const outOfMemory = error.code === "ERR_WORKER_OUT_OF_MEMORY" || /heap|memory/i.test(error.message);
      finish({
        error: new PdfExtractIsolationError(
          outOfMemory
            ? "Extração isolada de PDF excedeu o limite de memória"
            : "Extração isolada de PDF falhou",
          outOfMemory ? "pdf_isolate_memory" : "pdf_extract_failed",
          error,
        ),
      });
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish({
          error: new PdfExtractIsolationError(
            `Extração isolada de PDF terminou inesperadamente (código ${code})`,
            "pdf_extract_failed",
          ),
        });
      }
    });

    const bytes = transferableBytes(buffer);
    worker.postMessage(
      { bytes, maxPages: PDF_MAX_PAGES, maxChars: maxTextChars },
      [bytes],
    );
  });
}

/** Extrai texto puro sem executar `pdfjs-dist` no processo chamador. */
export async function extractPdfText(
  buffer: Buffer,
  dependencies: PdfExtractDependencies = {},
): Promise<string> {
  if (buffer.byteLength > PDF_MAX_BYTES) {
    throw new PdfExtractLimitError("PDF grande demais para extrair texto", "pdf_too_large");
  }

  const runIsolated = dependencies.runIsolated ?? runPdfExtractionIsolated;
  try {
    return await runIsolated(buffer, dependencies.maxTextChars ?? PDF_MAX_TEXT_CHARS);
  } catch (error) {
    if (error instanceof PdfExtractError) throw error;
    if (error instanceof Error && /DOMMatrix|@napi-rs\/canvas/.test(error.message)) {
      throw new PdfExtractIsolationError(
        "Extração de PDF indisponível: o binário nativo @napi-rs/canvas não foi instalado nesta plataforma. " +
          "Reinstale as dependências sem podar as opcionais.",
        "pdf_missing_canvas",
        error,
      );
    }
    throw new PdfExtractIsolationError(
      "pdfjs-dist failed to extract text from the PDF",
      "pdf_extract_failed",
      error,
    );
  }
}
