import { describe, expect, it } from "vitest";

import { mediaFilenameOf, type WahaPayload } from "./ingest";

describe("nome textual da mídia WAHA", () => {
  it("lê o filename do envelope atual", () => {
    expect(mediaFilenameOf({ media: { filename: "contrato.pdf" } } as WahaPayload))
      .toBe("contrato.pdf");
  });

  it("lê documentMessage do NOWEB sem exigir a forma no contrato inteiro", () => {
    expect(mediaFilenameOf({
      _data: { message: { documentMessage: { fileName: "proposta.docx" } } },
    } as WahaPayload)).toBe("proposta.docx");
  });
});
