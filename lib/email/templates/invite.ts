import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

interface BaseInviteEmailOptions {
  orgName: string;
  marca: MarcaDeSaida;
  idioma?: Idioma;
}

export interface InviteEmailOptions extends BaseInviteEmailOptions {
  email: string;
  password: string;
  loginUrl: string;
  recipientName?: string | null;
}

export interface InviteLinkEmailOptions extends BaseInviteEmailOptions {
  inviterName: string;
  acceptUrl: string;
  role: string;
  expiresAt: Date;
}

/** Convite novo: a conta nasce pronta e a credencial existe somente neste e-mail. */
export function buildInviteEmail(opts: InviteEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const idioma = opts.idioma ?? "pt-BR";
  const t = (texto: string) => traduzir(texto, idioma);
  const nome = opts.recipientName?.trim();
  const saudacao = nome ? `${t("Olá")}, ${nome}!` : `${t("Olá")}!`;
  const subject = `${t("Seu acesso foi liberado")} | ${opts.orgName}`;
  const loginUrl = escapeHtml(opts.loginUrl);

  const html = `<!doctype html>
<html lang="${idioma}">
<body style="margin:0;padding:32px 16px;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px;border-radius:18px;background:${NEUTROS_DE_SAIDA.texto};color:${NEUTROS_DE_SAIDA.fundo}">
    <p style="margin:0 0 28px;font-size:18px;font-weight:700">${escapeHtml(opts.marca.nome)}</p>
    <p style="margin:0 0 24px;font-size:17px;line-height:1.55">${escapeHtml(saudacao)} ${escapeHtml(t("Seu acesso foi liberado."))}</p>
    <p style="margin:0 0 10px;font-size:14px;font-weight:700">${escapeHtml(t("Seus dados de acesso:"))}</p>
    <div style="margin:0 0 18px;padding:18px;border-radius:12px;background:${NEUTROS_DE_SAIDA.linha};color:${NEUTROS_DE_SAIDA.texto}">
      <p style="margin:0 0 10px;font-size:14px"><strong>${escapeHtml(t("E-mail"))}:</strong> ${escapeHtml(opts.email)}</p>
      <p style="margin:0;font-size:14px"><strong>${escapeHtml(t("Senha"))}:</strong> <code style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:16px;letter-spacing:.04em">${escapeHtml(opts.password)}</code></p>
    </div>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:${NEUTROS_DE_SAIDA.linha}">${escapeHtml(t("Troque a senha depois do primeiro acesso, no seu perfil."))}</p>
    <p style="margin:0 0 28px">
      <a href="${loginUrl}" style="display:block;padding:14px 22px;border-radius:10px;background:${opts.marca.accent};color:${opts.marca.accentFg};text-align:center;text-decoration:none;font-weight:700">${escapeHtml(t("Acessar a plataforma"))}</a>
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:${NEUTROS_DE_SAIDA.linha}">${escapeHtml(t("Se você não reconhece este e-mail, é só ignorar."))}</p>
  </div>
</body>
</html>`;

  const text = [
    opts.marca.nome,
    "",
    `${saudacao} ${t("Seu acesso foi liberado.")}`,
    "",
    t("Seus dados de acesso:"),
    `${t("E-mail")}: ${opts.email}`,
    `${t("Senha")}: ${opts.password}`,
    "",
    t("Troque a senha depois do primeiro acesso, no seu perfil."),
    `${t("Acessar a plataforma")}: ${opts.loginUrl}`,
    "",
    t("Se você não reconhece este e-mail, é só ignorar."),
  ].join("\n");

  return { subject, html, text };
}

/** Compatibilidade para convites emitidos a contas que já existiam. */
export function buildInviteLinkEmail(opts: InviteLinkEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const expiresStr = opts.expiresAt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const marca = opts.marca.nome;
  const subject = `${opts.inviterName} convidou você para a ${opts.orgName} no ${marca}`;
  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(marca)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";
  const acceptUrl = escapeHtml(opts.acceptUrl);

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">Você foi convidado para a ${escapeHtml(opts.orgName)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(opts.inviterName)} convidou você como <strong>${escapeHtml(opts.role)}</strong> no ${escapeHtml(marca)}.</p>
    <p style="margin:24px 0"><a href="${acceptUrl}" style="display:inline-block;padding:12px 24px;background:${opts.marca.accent};color:${opts.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">Aceitar convite</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">Ou copie e cole este link no navegador:<br><span style="word-break:break-all;color:${opts.marca.accent}">${acceptUrl}</span></p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">Este link expira em <strong>${expiresStr}</strong>. Se você não esperava este convite, pode ignorá-lo.</p>
  </div>
</body>
</html>`;
  const text = [
    `Você foi convidado para a ${opts.orgName} como ${opts.role} no ${marca}.`,
    "",
    `Aceitar: ${opts.acceptUrl}`,
    "",
    `Expira em ${expiresStr}.`,
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
