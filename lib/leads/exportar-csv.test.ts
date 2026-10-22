import { describe, expect, it } from "vitest";

import {
  CABECALHO_EXPORTACAO_LEADS,
  dataDoArquivo,
  escaparCelulaCsv,
  montarCsvDeLeads,
  respostasECampos,
  slugSeguroParaArquivo,
} from "@/lib/leads/exportar-csv";

describe("CSV de leads", () => {
  it("gera BOM, cabeçalho em português, ponto e vírgula, datas de São Paulo e campos ordenados", () => {
    const csv = montarCsvDeLeads([
      {
        created_at: "2026-01-01T02:30:00.000Z",
        custom_fields: { z: "", b: "segundo", a: "primeiro", nulo: null, numero: 0 },
        last_activity_at: "2026-06-10T15:45:00.000Z",
        lost_reason: "Preço",
        lost_reason_detail: "Acima do orçamento",
        source: "site",
        status: "lost",
        tags: ["vip", "retorno"],
        contato: {
          display_name: "Maria",
          name: "Maria da Silva",
          phone_number: "+5511999999999",
          email: "maria@exemplo.com",
        },
        etapa: { name: "Perdido" },
      },
    ]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [cabecalho, linha] = csv.slice(1).trimEnd().split("\r\n");
    expect(cabecalho).toBe(CABECALHO_EXPORTACAO_LEADS.join(";"));
    expect(linha).toBe(
      "Maria;'+5511999999999;maria@exemplo.com;Perdido;lost;Preço;Acima do orçamento;site;31/12/2025 23:30;10/06/2026 12:45;vip | retorno;a: primeiro | b: segundo | numero: 0",
    );
  });

  it("usa name quando display_name está vazio e ignora campos personalizados vazios", () => {
    const csv = montarCsvDeLeads([
      {
        created_at: "2026-10-22T15:00:00.000Z",
        custom_fields: { vazio: " ", lista: [], objeto: {}, ativo: false },
        last_activity_at: null,
        lost_reason: null,
        source: null,
        status: "open",
        tags: [],
        contato: {
          display_name: " ",
          name: "Nome principal",
          phone_number: null,
          email: null,
        },
        etapa: null,
      },
    ]);

    expect(csv).toContain("Nome principal;;;;open;;;;22/10/2026 12:00;;;ativo: false");
    expect(respostasECampos({ vazio: "", lista: [], objeto: {}, zero: 0 })).toBe("zero: 0");
  });

  it.each(["=1+1", "+SOMA(A1:A2)", "-10", "@comando", "\tcomando", "\rcomando"])(
    "neutraliza valor iniciado por fórmula: %j",
    (valor) => {
      expect(escaparCelulaCsv(valor).replace(/^"|"$/g, "")).toBe(`'${valor}`);
    },
  );

  it("escapa aspas, ponto e vírgula e quebras de linha", () => {
    expect(escaparCelulaCsv('Ana; "Equipe"\nSul')).toBe('"Ana; ""Equipe""\nSul"');
  });

  it("forma nome seguro com a data civil de São Paulo", () => {
    expect(slugSeguroParaArquivo("Clínica Centro / Sul")).toBe("clinica-centro-sul");
    expect(dataDoArquivo(new Date("2026-01-01T02:30:00.000Z"))).toBe("2025-12-31");
  });
});
