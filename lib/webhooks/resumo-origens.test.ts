import { describe, expect, it } from "vitest";

import { resumirOrigens } from "@/lib/webhooks/resumo-origens";

describe("resumirOrigens", () => {
  it("agrega origem, campanha e página e conta leads sem marcação", () => {
    const resumo = resumirOrigens([
      {
        utm: {
          utm_source: "meta",
          utm_campaign: "professores-2026",
          pagina: "Dia dos Professores",
        },
        fields: {},
        origin: "https://site.example/dia-dos-professores",
      },
      {
        utm: {
          utm_source: "meta",
          utm_campaign: "professores-2026",
          pagina: "Dia dos Professores",
        },
        fields: {},
        origin: null,
      },
      {
        utm: { pagina: "Página institucional" },
        fields: {},
        origin: "https://site.example/",
      },
    ]);

    expect(resumo).toEqual({
      total: 3,
      sem_marcacao: 1,
      por_utm_source: [
        { valor: "meta", total: 2 },
        { valor: null, total: 1 },
      ],
      por_utm_campaign: [
        { valor: "professores-2026", total: 2 },
        { valor: null, total: 1 },
      ],
      por_pagina: [
        { valor: "Dia dos Professores", total: 2 },
        { valor: "Página institucional", total: 1 },
      ],
    });
  });
});
