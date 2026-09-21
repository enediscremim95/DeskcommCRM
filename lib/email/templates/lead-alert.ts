import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";

export type LeadAlertKind = "new_lead" | "urgent_lead";

export interface LeadAlertEmailOptions {
  kind: LeadAlertKind;
  href: string;
  marca: MarcaDeSaida;
  urgentReason?: "risk" | "task_overdue";
}

/**
 * O e-mail deliberadamente não leva nome, telefone, mensagem nem descrição do
 * lead. Clínicas usam o produto; a caixa postal só precisa dizer que há algo a
 * fazer e levar a pessoa autenticada à ficha protegida.
 */
export function buildLeadAlertEmail(opts: LeadAlertEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const novo = opts.kind === "new_lead";
  const titulo = novo ? "Novo lead aguardando atendimento" : "Ação urgente em um lead";
  const explicacao = novo
    ? "Um novo lead entrou no funil e aguarda atendimento."
    : opts.urgentReason === "task_overdue"
      ? "Há uma tarefa vencida que exige atenção no lead."
      : "O Radar identificou um lead que exige atenção agora.";
  const acao = novo ? "Abrir lead" : "Ver ação urgente";
  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(opts.marca.nome)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">${titulo}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${explicacao}</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(opts.href)}" style="display:inline-block;padding:12px 24px;background:${opts.marca.accent};color:${opts.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">${acao}</a>
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">
      Por privacidade, os dados do lead não aparecem neste e-mail. Entre no sistema para consultar os detalhes.
    </p>
  </div>
</body>
</html>`;

  const text = [
    titulo,
    "",
    explicacao,
    "",
    `${acao}: ${opts.href}`,
    "",
    "Os dados do lead ficam somente no sistema.",
  ].join("\n");
  return { subject: `${titulo} | ${opts.marca.nome}`, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
