import { describe, expect, it } from "vitest";

import type { MarcaDeSaida } from "@/lib/branding/saida";

import { buildInviteEmail } from "./invite";

const MARCA: MarcaDeSaida = {
  nome: "Vendas Turbo",
  logoUrl: null,
  accent: "#2f6f4e",
  accentFg: "#ffffff",
  origens: { nome: "banco", cor: "banco" },
};

describe("e-mail de acesso por senha provisória", () => {
  it("mostra marca, credenciais, orientação e botão no cartão escuro", () => {
    const result = buildInviteEmail({
      orgName: "Clínica Bem Viver",
      recipientName: "Marina",
      email: "marina@example.test",
      password: "Abc234Def567",
      loginUrl: "https://crm.example.test/login",
      marca: MARCA,
    });

    expect(result.subject).toContain("Clínica Bem Viver");
    expect(result.html).toContain("Vendas Turbo");
    expect(result.html).toContain("Olá, Marina! Seu acesso foi liberado.");
    expect(result.html).toContain("marina@example.test");
    expect(result.html).toContain("Abc234Def567");
    expect(result.html).toContain("ui-monospace");
    expect(result.html).toContain("Troque a senha depois do primeiro acesso, no seu perfil.");
    expect(result.html).toContain('href="https://crm.example.test/login"');
    expect(result.html).toContain("Acessar a plataforma");
    expect(result.html).toContain("border-radius:18px");
    expect(result.html).not.toContain("accept-invite");
  });

  it("usa a mesma via de tradução no e-mail em espanhol", () => {
    const { html, text } = buildInviteEmail({
      orgName: "Acme",
      email: "ana@example.test",
      password: "Abc234Def567",
      loginUrl: "https://crm.example.test/login",
      marca: MARCA,
      idioma: "es",
    });

    expect(html).toContain('lang="es"');
    expect(`${html} ${text}`).toContain("Tus datos de acceso:");
    expect(`${html} ${text}`).toContain("Acceder a la plataforma");
    expect(`${html} ${text}`).toContain("Contraseña");
  });

  it("escapa dados dinâmicos", () => {
    const { html } = buildInviteEmail({
      orgName: "Acme",
      recipientName: '<img src=x onerror="alert(1)">',
      email: 'x@example.test"><script>',
      password: "Abc234Def567",
      loginUrl: 'https://crm.example.test/login" onclick="alert(1)',
      marca: MARCA,
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onclick="alert(1)"');
  });
});
