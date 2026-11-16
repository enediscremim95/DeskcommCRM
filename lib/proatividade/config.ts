import { z } from "zod";

export const ATENCAO_CONTATO = "Atenção: contato não realizado";
export const WHATSAPP_PADRAO =
  "Olá! Recebemos seu contato pelo formulário. Como podemos ajudar? Se preferir não receber mensagens, é só avisar.";
export const ASSUNTO_PADRAO = "Seu contato pelo formulário";
export const EMAIL_PADRAO =
  "Olá! Recebemos seu contato pelo formulário e não conseguimos falar com você pelo WhatsApp. Como podemos ajudar? Você pode responder a este e-mail. Se preferir não receber mensagens, é só avisar.";
export const configProatividadeSchema = z
  .object({
    enabled: z.boolean().default(false),
    channel_session_id: z.string().uuid().nullable().default(null),
    max_attempts: z.number().int().min(1).max(3).default(3),
    start_hour: z.number().int().min(0).max(23).default(9),
    end_hour: z.number().int().min(1).max(24).default(18),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5]),
    whatsapp_text: z.string().trim().min(1).max(2000).default(WHATSAPP_PADRAO),
    email_subject: z.string().trim().min(1).max(150).default(ASSUNTO_PADRAO),
    email_text: z.string().trim().min(1).max(5000).default(EMAIL_PADRAO),
  })
  .refine((c) => c.start_hour < c.end_hour, {
    message: "O fim do expediente deve ser posterior ao início.",
  })
  .refine((c) => !c.enabled || !!c.channel_session_id, {
    message: "Escolha o canal antes de ligar.",
  });
export type ConfigProatividade = z.infer<typeof configProatividadeSchema>;
export function lerProatividade(
  settings: Record<string, unknown> | null | undefined,
): ConfigProatividade {
  const parsed = configProatividadeSchema.safeParse(settings?.form_proactivity ?? {});
  return parsed.success ? parsed.data : configProatividadeSchema.parse({});
}
export function emExpediente(now: Date, timezone: string, c: ConfigProatividade): boolean {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    p.find((x) => x.type === "weekday")!.value,
  );
  const hour = Number(p.find((x) => x.type === "hour")!.value);
  return c.weekdays.includes(day) && hour >= c.start_hour && hour < c.end_hour;
}
