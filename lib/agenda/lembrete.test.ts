import { describe, expect, it } from "vitest";

import { montarLembrete } from "@/app/api/v1/cron/agenda-reminder/route";

import { aplicarVariaveisDoLembrete, dataEHoraDoLembrete, linkDaSala, linkParaOModelo } from "./lembrete";

const quando = new Date("2026-12-03T17:00:00Z"); // quinta, 14h em São Paulo

describe("variáveis do modelo do lembrete", () => {
  const v = { nome: "Ana", ...dataEHoraDoLembrete(quando, "America/Sao_Paulo"), link: "https://meet.google.com/abc-defg-hij" };

  it("substitui {{nome}} {{data}} {{hora}} {{link}} no fuso da organização", () => {
    expect(v.hora).toBe("14:00");
    expect(aplicarVariaveisDoLembrete("Oi {{nome}}! {{ data }} às {{HORA}}. Sala: {{link}}", v)).toBe(
      `Oi Ana! ${v.data} às 14:00. Sala: https://meet.google.com/abc-defg-hij`,
    );
    expect(v.data).toMatch(/quinta-feira, 03\/12/);
  });

  it("modelo sem variável sai idêntico; variável desconhecida fica como está", () => {
    expect(aplicarVariaveisDoLembrete("Lembrete da sua reunião amanhã.", v)).toBe("Lembrete da sua reunião amanhã.");
    expect(aplicarVariaveisDoLembrete("{{cpf}} {{nome}}", v)).toBe("{{cpf}} Ana");
  });

  it("fuso da organização muda a hora", () => {
    expect(dataEHoraDoLembrete(quando, "America/Manaus").hora).toBe("13:00");
  });
});

describe("o link", () => {
  it("sala só quando pronta; o modelo cai no local do compromisso/tipo", () => {
    expect(linkDaSala({ meeting_state: "pending", meeting_url: "https://x" })).toBeNull();
    expect(linkDaSala({ meeting_state: "ready", meeting_url: " https://meet.google.com/a " })).toBe("https://meet.google.com/a");
    expect(linkParaOModelo({ meeting_state: "pending", meeting_url: "https://x", location_details: null, tipo_location_details: "Rua A, 10" })).toBe("Rua A, 10");
    expect(linkParaOModelo({})).toBe("");
  });
});

describe("texto padrão (sem modelo)", () => {
  const base = { nomeDoContato: "Ana", titulo: "Apresentação", quando, timezone: "America/Sao_Paulo", local: null };

  it("sem sala pronta: exatamente o texto de antes", () => {
    expect(montarLembrete(base)).toBe(montarLembrete({ ...base, link: null }));
    expect(montarLembrete(base)).not.toMatch(/Link da reunião/);
  });

  it("com sala pronta: ganha o link", () => {
    expect(montarLembrete({ ...base, link: "https://meet.google.com/abc" })).toMatch(
      /Link da reunião: https:\/\/meet\.google\.com\/abc$/,
    );
  });

  it("não repete o link quando ele já é o endereço impresso", () => {
    const t = montarLembrete({ ...base, local: "https://meet.google.com/abc", link: "https://meet.google.com/abc" });
    expect(t.match(/meet\.google\.com\/abc/g)).toHaveLength(1);
  });

  it("espanhol traduz o rótulo do link", () => {
    expect(montarLembrete({ ...base, link: "https://m/x", idioma: "es" })).toMatch(/Enlace de la reunión: https:\/\/m\/x/);
  });
});
