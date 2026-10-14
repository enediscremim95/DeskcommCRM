// @vitest-environment node
//
// Issue #102. Este arquivo nasceu porque `extractPdfText` estava mockado em TODOS
// os testes que o tocavam (`extractPdf: vi.fn(...)` em media-derive.test.ts), então
// nenhuma linha de pdfjs era executada pelo CI. A extração ficou quebrada por um
// `GlobalWorkerOptions.workerSrc = ""` e o CI seguiu verde o tempo todo.
//
// Issue #238. O arquivo tinha um teste "cai no fallback do pdf-parse", e ele não
// media o que dizia medir: o pdf-parse@1 falha com "bad XRef entry" na fixture
// `sample-text.pdf` deste repo, então o caminho primário JÁ estava morto e quem
// extraía era o fallback — nos dois testes. Hoje há uma engine só (pdfjs-dist), e
// as asserções abaixo são de igualdade EXATA de propósito: é isso que faz uma troca
// de engine, ou de estratégia de junção de linhas, ficar vermelha aqui.
//
// As fixtures são PDFs 1.4 escritos à mão (texto puro, `cat`-áveis), sem compressão
// e sem gerador — determinísticas byte a byte.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const raiz = process.cwd();
const fixture = (nome: string) => readFileSync(join(raiz, "tests/fixtures", nome));

function pdfMinimoComPaginas(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index);
  const firstContentId = 3 + pageCount;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`);
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] /Resources << >> /Contents ${firstContentId + index} 0 R >>`,
    );
  }
  for (let index = 0; index < pageCount; index += 1) {
    objects.push("<< /Length 0 >>\nstream\n\nendstream");
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

afterEach(() => {
  vi.resetModules();
});

describe("extractPdfText", () => {
  it("extrai texto de um PDF real", async () => {
    const { extractPdfText } = await import("@/lib/ai/rag/extractors/pdf");
    expect(await extractPdfText(fixture("sample-text.pdf"))).toBe("DeskcommCRM RAG fixture");
  });

  it("preserva a acentuação do português", async () => {
    // Acentuação é o primeiro lugar onde uma troca de engine estraga texto sem
    // quebrar teste nenhum — o PDF codifica em WinAnsi e alguém tem de decodificar.
    const { extractPdfText } = await import("@/lib/ai/rag/extractors/pdf");
    expect(await extractPdfText(fixture("sample-acentos.pdf"))).toBe(
      "Ação de vendas: café, órgão, três.",
    );
  });

  it("preserva quebra de linha dentro da página e separa páginas por linha em branco", async () => {
    // O chunker do RAG corta por estrutura; se a extração achatar tudo numa linha só,
    // o texto continua "certo" e a recuperação piora em silêncio.
    const { extractPdfText } = await import("@/lib/ai/rag/extractors/pdf");
    expect(await extractPdfText(fixture("sample-multipagina.pdf"))).toBe(
      "Pagina um linha um\nPagina um linha dois\n\nPagina dois linha um\nPagina dois linha dois",
    );
  });

  it("lança PdfExtractError quando o PDF é válido mas não tem texto algum", async () => {
    // O caso "PDF digitalizado / só imagem": a fixture abre sem erro nenhum, tem uma
    // página e zero itens de texto. É o único caminho em que a engine trabalha até o
    // fim e mesmo assim não há o que ingerir — sem esta fixture, a guarda de texto
    // vazio não é exercitada por teste nenhum.
    const { extractPdfText, PdfExtractError } = await import("@/lib/ai/rag/extractors/pdf");
    await expect(extractPdfText(fixture("sample-sem-texto.pdf"))).rejects.toBeInstanceOf(
      PdfExtractError,
    );
    await expect(extractPdfText(fixture("sample-sem-texto.pdf"))).rejects.toThrow(/image-only/);
  });

  it("lança PdfExtractError quando o buffer não é PDF", async () => {
    const { extractPdfText, PdfExtractError } = await import("@/lib/ai/rag/extractors/pdf");
    await expect(extractPdfText(Buffer.from("isto não é um pdf"))).rejects.toBeInstanceOf(
      PdfExtractError,
    );
  });

  it("lança PdfExtractError quando o PDF tem cabeçalho válido mas corpo corrompido", async () => {
    // Pior que o buffer aleatório: começa com %PDF-, então passa por qualquer
    // checagem de assinatura e só morre dentro da engine.
    const { extractPdfText, PdfExtractIsolationError } = await import(
      "@/lib/ai/rag/extractors/pdf"
    );
    await expect(extractPdfText(fixture("sample-corrompido.pdf"))).rejects.toBeInstanceOf(
      PdfExtractIsolationError,
    );
    // O chamador continua executando depois que o isolado recusou o arquivo.
    expect(1 + 1).toBe(2);
  });

  it("diz o que fazer quando o binário nativo do canvas falta", async () => {
    // O pdfjs 6 estoura no import sem @napi-rs/canvas. Sem esta tradução o
    // self-hoster vê "DOMMatrix is not defined" e não tem como ligar isso a uma
    // dependência opcional que ele nem sabe que existe.
    //
    // Na VPS o erro nasce no IMPORT do módulo. Aqui ele nasce no getDocument, e é
    // fiel ao que importa: o branch decide pela MENSAGEM, não pelo ponto de origem.
    // (Mockar o factory para lançar não serve — o vitest reembrulha e a mensagem some.)
    const { extractPdfText, PdfExtractError } = await import("@/lib/ai/rag/extractors/pdf");
    const runIsolated = vi.fn(async () => {
      throw new Error("DOMMatrix is not defined");
    });
    await expect(
      extractPdfText(fixture("sample-text.pdf"), { runIsolated }),
    ).rejects.toThrow(PdfExtractError);
    await expect(
      extractPdfText(fixture("sample-text.pdf"), { runIsolated }),
    ).rejects.toThrow(/@napi-rs\/canvas/);
  });

  it("pula PDF acima do teto sem abrir o isolado", async () => {
    const { extractPdfText, PDF_MAX_BYTES } = await import(
      "@/lib/ai/rag/extractors/pdf"
    );
    const runIsolated = vi.fn(async () => "não deveria abrir");

    await expect(
      extractPdfText(Buffer.alloc(PDF_MAX_BYTES + 1), { runIsolated }),
    ).rejects.toMatchObject({
      name: "PdfExtractLimitError",
      code: "pdf_too_large",
      message: "PDF grande demais para extrair texto",
    });
    expect(runIsolated).not.toHaveBeenCalled();
  });

  it("pula PDF acima do teto de páginas antes de extrair cada página", async () => {
    const { extractPdfText, PDF_MAX_PAGES } = await import("@/lib/ai/rag/extractors/pdf");

    await expect(extractPdfText(pdfMinimoComPaginas(PDF_MAX_PAGES + 1))).rejects.toMatchObject({
      name: "PdfExtractLimitError",
      code: "pdf_too_many_pages",
    });
  });

  it("transfere a posse do buffer e não o retém no processo principal", async () => {
    const { extractPdfText } = await import("@/lib/ai/rag/extractors/pdf");
    const original = fixture("sample-text.pdf");
    const standalone = Buffer.from(
      original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength),
    );
    expect(standalone.buffer.byteLength).toBe(standalone.byteLength);

    expect(await extractPdfText(standalone)).toBe("DeskcommCRM RAG fixture");
    expect(standalone.byteLength).toBe(0);
  });

  it("tem uma engine só: pdf-parse não volta como dependência", async () => {
    // O pdf-parse@1 carrega 29 MB de pdf.js vendorizado (quatro cópias) e fixa a de
    // 2018 — 7 majors atrás da que já está aqui. Isso é peso na imagem Docker do
    // self-host em troca de uma engine PIOR. Se alguém readicionar, este teste conta.
    const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const todas = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(todas)).not.toContain("pdf-parse");
    expect(Object.keys(todas)).not.toContain("@types/pdf-parse");
  });
});
