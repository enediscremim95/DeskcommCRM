import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";

export type LeadAlertKind = "new_lead" | "urgent_lead";

export interface LeadAlertEmailOptions {
  kind: LeadAlertKind;
  href: string;
  marca: MarcaDeSaida;
  organizationName: string;
  leadTitle: string;
  urgentReason?: "risk" | "task_overdue";
}

/**
 * O aviso de lead novo não leva dado individual. A urgência ainda usa o título
 * operacional; telefone, e-mail, mensagem e campos personalizados ficam na ficha.
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
  const subject = novo
    ? `Novo lead aguardando atendimento na ${opts.organizationName}`
    : `Ação urgente na ${opts.organizationName}: ${opts.leadTitle}`;
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
      Telefone, e-mail, mensagens e demais dados ficam somente no sistema.
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
    "Telefone, e-mail, mensagens e demais dados ficam somente no sistema.",
  ].join("\n");
  return { subject: `${subject} | ${opts.marca.nome}`, html, text };
}

export interface LeadBatchLink {
  count: number;
  href: string;
}

export interface UrgentLeadBatchItem {
  title: string;
  stage: string;
  reason: string;
  age: string;
}

export function buildLeadBatchEmail(opts: {
  total: number;
  links: LeadBatchLink[];
  marca: MarcaDeSaida;
  organizationName: string;
}): { subject: string; html: string; text: string } {
  const total = opts.total;
  const singular = total === 1;
  const titulo = `${total} ${singular ? "lead novo" : "leads novos"} aguardando atendimento na ${opts.organizationName}`;
  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(opts.marca.nome)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";
  const linksHtml = opts.links
    .map(
      (link) =>
        `<p style="margin:12px 0"><a href="${escapeHtml(link.href)}" style="display:inline-block;padding:12px 24px;background:${opts.marca.accent};color:${opts.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">${opts.links.length === 1 ? "Abrir lista filtrada" : `Abrir ${link.count} ${link.count === 1 ? "lead" : "leads"}`}</a></p>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">${escapeHtml(titulo)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${singular ? "Um novo lead entrou no funil." : "Novos leads entraram no funil e foram agrupados para não inundar sua caixa de entrada."}</p>
    ${linksHtml}
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">Telefone, e-mail, mensagens e demais dados ficam somente no sistema.</p>
  </div>
</body>
</html>`;
  const text = [
    titulo,
    "",
    ...opts.links.map((link) =>
      opts.links.length === 1
        ? `Abrir lista filtrada: ${link.href}`
        : `Abrir ${link.count} ${link.count === 1 ? "lead" : "leads"}: ${link.href}`,
    ),
    "",
    "Telefone, e-mail, mensagens e demais dados ficam somente no sistema.",
  ].join("\n");
  return { subject: `${titulo} | ${opts.marca.nome}`, html, text };
}

export function buildUrgentLeadBatchEmail(opts: {
  items: UrgentLeadBatchItem[];
  marca: MarcaDeSaida;
  organizationName: string;
  funnelHref: string;
  deferredCount?: number;
}): { subject: string; html: string; text: string } {
  const total = opts.items.length;
  const visiveis = opts.items.slice(0, 20);
  const restantes = Math.max(0, total - visiveis.length);
  const titulo = `${total} lead${total === 1 ? "" : "s"} pedindo ação na ${opts.organizationName}`;
  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(opts.marca.nome)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";
  const listaHtml = visiveis
    .map(
      (item) => `<li style="margin:0 0 14px">
        <strong>${escapeHtml(item.title)}</strong><br>
        <span style="font-size:14px;color:${NEUTROS_DE_SAIDA.suave}">${escapeHtml(item.stage)} · ${escapeHtml(item.reason)} · ${escapeHtml(item.age)}</span>
      </li>`,
    )
    .join("");
  const complemento =
    restantes > 0
      ? `<p style="margin:16px 0 0;font-size:14px">Mais ${restantes} lead${restantes === 1 ? "" : "s"} pedindo ação estão no funil.</p>`
      : "";
  const adiados =
    (opts.deferredCount ?? 0) > 0
      ? `<p style="margin:16px 0 0;font-size:14px">Este resumo inclui ${opts.deferredCount} lead${opts.deferredCount === 1 ? "" : "s"} que ficou${opts.deferredCount === 1 ? "" : "aram"} para hoje após o teto diário.</p>`
      : "";
  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">${escapeHtml(titulo)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">As ações urgentes foram agrupadas para preservar sua caixa de entrada.</p>
    <ul style="margin:20px 0;padding-left:20px">${listaHtml}</ul>
    ${complemento}
    ${adiados}
    <p style="margin:24px 0">
      <a href="${escapeHtml(opts.funnelHref)}" style="display:inline-block;padding:12px 24px;background:${opts.marca.accent};color:${opts.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">Abrir funil</a>
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">Telefone, e-mail, mensagens e demais dados ficam somente no sistema.</p>
  </div>
</body>
</html>`;
  const text = [
    titulo,
    "",
    ...visiveis.map((item) => `${item.title} | ${item.stage} | ${item.reason} | ${item.age}`),
    ...(restantes > 0
      ? ["", `Mais ${restantes} lead${restantes === 1 ? "" : "s"} pedindo ação estão no funil.`]
      : []),
    ...((opts.deferredCount ?? 0) > 0
      ? [
          "",
          `Este resumo inclui ${opts.deferredCount} lead${opts.deferredCount === 1 ? "" : "s"} adiado${opts.deferredCount === 1 ? "" : "s"} pelo teto diário.`,
        ]
      : []),
    "",
    `Abrir funil: ${opts.funnelHref}`,
    "",
    "Telefone, e-mail, mensagens e demais dados ficam somente no sistema.",
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
