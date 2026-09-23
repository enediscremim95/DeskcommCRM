import { describe, expect, it } from "vitest";

import type { MarcaDeSaida } from "@/lib/branding/saida";
import { buildPasswordResetEmail } from "@/lib/email/templates/password-reset";

const MARCA: MarcaDeSaida = {
  nome: 'Acme "Teste" & Cia',
  logoUrl: null,
  accent: "#234567",
  accentFg: "#ffffff",
  origens: { nome: "instalacao", cor: "instalacao" },
};

describe("e-mail de redefinição de senha", () => {
  it("leva marca, CTA, validade e o link token_hash em português", () => {
    const resetUrl = "https://crm.test/auth/confirm?type=recovery&token_hash=segredo";
    const email = buildPasswordResetEmail({ resetUrl, marca: MARCA });

    expect(email.subject).toContain(MARCA.nome);
    expect(email.html).toContain("Criar nova senha");
    expect(email.html).toContain("link é temporário");
    expect(email.text).toContain(resetUrl);
    expect(email.text).not.toContain("code=");
    expect(email.html).toContain("Acme &quot;Teste&quot; &amp; Cia");
  });

  it("traduz assunto e corpo para espanhol", () => {
    const email = buildPasswordResetEmail({
      resetUrl: "https://crm.test/auth/confirm?type=recovery&token_hash=segredo",
      marca: MARCA,
      idioma: "es",
    });

    expect(email.subject).toContain("Crea una nueva contraseña");
    expect(email.html).toContain("Crear nueva contraseña");
    expect(email.text).toContain("Por seguridad");
    expect(email.html).toContain('lang="es"');
  });
});
