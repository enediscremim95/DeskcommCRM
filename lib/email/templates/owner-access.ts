import type { MarcaDeSaida } from "@/lib/branding/saida";

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function buildOwnerAccessEmail(input: {
  orgName: string; email: string; password: string; loginUrl: string; marca: MarcaDeSaida;
}) {
  const text = [
    `O CRM de ${input.orgName} está pronto no ${input.marca.nome}.`,
    `Endereço: ${input.loginUrl}`, `Usuário: ${input.email}`, `Senha: ${input.password}`,
    "Entre com estes dados. Não é necessário configurar a empresa.",
    `Recomendamos trocar esta senha pelo link de recuperação: ${input.loginUrl}/forgot`,
    "Não compartilhe este e-mail. Se você não esperava este acesso, fale com quem administra o CRM.",
  ].join("\n\n");
  return {
    subject: `Seu acesso ao CRM de ${input.orgName}`,
    text,
    html: `<!doctype html><html lang="pt-BR"><body><h1>${escape(input.marca.nome)}</h1><p>${escape(text).replace(/\n\n/g, "</p><p>")}</p></body></html>`,
  };
}
