import { describe, expect, it } from "vitest";
import { sealOwnerPassword, openOwnerPassword } from "@/lib/auth/owner-access-secret";
import { buildOwnerAccessEmail } from "@/lib/email/templates/owner-access";
import { businessProfileSchema } from "@/lib/schemas/business-profile";
import { createTenantSchema } from "@/lib/schemas/tenant-creation";
const secret = "test-only-encryption-key-32chars";
describe("segredo temporário de acesso", () => {
  it("cifra com nonce único e recupera exatamente a senha", () => {
    const value = sealOwnerPassword("Senha<&é", secret, "org-a");
    expect(value).not.toContain("Senha");
    expect(sealOwnerPassword("Senha<&é", secret, "org-a")).not.toBe(value);
    expect(openOwnerPassword(value, secret, "org-a")).toBe("Senha<&é");
  });
  it("recusa troca de organização, chave, adulteração e truncamento", () => {
    const value = sealOwnerPassword("test-password", secret, "org-a");
    expect(() => openOwnerPassword(value, secret, "org-b")).toThrow();
    expect(() => openOwnerPassword(value, secret + "rotated", "org-a")).toThrow();
    const changed = Buffer.from(value, "base64");
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    expect(() => openOwnerPassword(changed.toString("base64"), secret, "org-a")).toThrow();
    expect(() => openOwnerPassword("invalid", secret, "org-a")).toThrow();
    expect(() => sealOwnerPassword("test", "short", "org-a")).toThrow();
  });
});
describe("email e perfil", () => {
  it("entrega login utilizável em texto e escapa valores no HTML", () => {
    const mail = buildOwnerAccessEmail({ orgName: "Empresa <script>", email: "owner@example.test", password: "a<&\"'", loginUrl: "https://crm.example.test/login", marca: { nome: "Marca <b>", logoUrl: null, accent: "#000000", accentFg: "#ffffff", origens: { nome: "padrão", cor: "padrão" } } });
    expect(mail.text).toContain("https://crm.example.test/login");
    expect(mail.text).toContain("owner@example.test");
    expect(mail.text).toContain("a<&\"'");
    expect(mail.html).toContain("Empresa &lt;script&gt;");
    expect(mail.html).toContain("a&lt;&amp;&quot;&#39;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("Marca &lt;b&gt;");
  });
  it("normaliza perfil vazio, limita campos e recusa URL executável", () => {
    expect(businessProfileSchema.parse({})).toEqual({ description: "", website: "", phone: "", address: "", business_hours: "" });
    expect(businessProfileSchema.parse({ description: " Texto " }).description).toBe("Texto");
    expect(businessProfileSchema.safeParse({ website: "javascript:alert(1)" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ website: "ftp://example.test" }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ website: "https://example.test" }).success).toBe(true);
    for (const [key, limit] of [["description", 2000], ["phone", 60], ["address", 500], ["business_hours", 500]] as const) {
      expect(businessProfileSchema.safeParse({ [key]: "x".repeat(limit + 1) }).success).toBe(false);
    }
  });
  it("mantém modo antigo por padrão, valida fuso e aceita entrega por credenciais", () => {
    const base = { display_name: "Empresa", slug: "empresa", owner_email: "owner@example.test" };
    expect(createTenantSchema.parse(base).delivery_mode).toBe("invite");
    expect(createTenantSchema.parse({ ...base, delivery_mode: "credentials", timezone: "America/Sao_Paulo" }).delivery_mode).toBe("credentials");
    expect(createTenantSchema.safeParse({ ...base, timezone: "Invalid/Zone" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, delivery_mode: "reset" }).success).toBe(false);
  });
});
