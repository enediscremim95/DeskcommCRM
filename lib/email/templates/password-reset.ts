import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

interface PasswordResetEmailOptions {
  resetUrl: string;
  marca: MarcaDeSaida;
  idioma?: Idioma;
}

/** E-mail pronto para envio próprio. O token existe apenas dentro do href/texto. */
export function buildPasswordResetEmail(opts: PasswordResetEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const idioma = opts.idioma ?? "pt-BR";
  const t = (texto: string) => traduzir(texto, idioma);
  const marca = escapeHtml(opts.marca.nome);
  const resetUrl = escapeHtml(opts.resetUrl);
  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${marca}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";
  const subject = `${t("Crie uma nova senha")} | ${opts.marca.nome}`;

  const html = `<!doctype html>
<html lang="${idioma}">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <p style="margin:0 0 24px;font-size:18px;font-weight:700">${marca}</p>
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">${escapeHtml(t("Crie uma nova senha"))}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(t("Recebemos um pedido para redefinir a senha da sua conta."))}</p>
    <p style="margin:24px 0"><a href="${resetUrl}" style="display:block;padding:14px 22px;border-radius:10px;background:${opts.marca.accent};color:${opts.marca.accentFg};text-align:center;text-decoration:none;font-weight:700">${escapeHtml(t("Criar nova senha"))}</a></p>
    <p style="margin:0 0 16px;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">${escapeHtml(t("Por segurança, este link é temporário e só pode ser usado uma vez."))}</p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:${NEUTROS_DE_SAIDA.suave}">${escapeHtml(t("Se você não reconhece este e-mail, é só ignorar."))}</p>
  </div>
</body>
</html>`;

  const text = [
    opts.marca.nome,
    "",
    t("Crie uma nova senha"),
    t("Recebemos um pedido para redefinir a senha da sua conta."),
    "",
    `${t("Criar nova senha")}: ${opts.resetUrl}`,
    "",
    t("Por segurança, este link é temporário e só pode ser usado uma vez."),
    t("Se você não reconhece este e-mail, é só ignorar."),
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
