export interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  /** Nome de exibição do remetente, resolvido pela marca da instalação. */
  fromName?: string;
  /** Chave estável para retry quando o provedor oferece idempotência. */
  idempotencyKey?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: "not_configured" | "send_failed" | "rate_limited" | "dominio_nao_verificado";
  details?: string;
}

export interface EmailAdapter {
  isConfigured(): boolean;
  send(args: SendArgs, from: string): Promise<SendResult>;
}

export function classificarErroEmail(
  nome: string,
  mensagem: string,
): NonNullable<SendResult["error"]> {
  if (/rate|quota|too many|throttl|429/i.test(`${nome} ${mensagem}`)) {
    return "rate_limited";
  }
  if (/not verified|is not verified|identity.*verified|não verificad/i.test(mensagem)) {
    return "dominio_nao_verificado";
  }
  return "send_failed";
}
