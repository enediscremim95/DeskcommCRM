import { z } from "zod";
export const ATTENTION_CONTACT_TAG = "Atenção: contato não localizado";
export const WHATSAPP_CAPTURE_TEXT = "Olá! Recebemos seu formulário e estamos entrando em contato para entender como podemos ajudar. Podemos conversar por aqui?";
export const EMAIL_CAPTURE_SUBJECT = "Sobre o seu formulário";
export const EMAIL_CAPTURE_TEXT = "Olá! Recebemos seu formulário e não conseguimos falar com você pelo WhatsApp. Se quiser continuar, responda este e-mail ou informe o melhor número para contato.";
export const capturePolicySchema = z.object({
 enabled: z.boolean().default(false), channel_session_id: z.string().uuid().nullable().default(null),
 whatsapp_text: z.string().trim().min(1).max(2000).default(WHATSAPP_CAPTURE_TEXT),
 email_subject: z.string().trim().min(1).max(150).default(EMAIL_CAPTURE_SUBJECT),
 email_text: z.string().trim().min(1).max(4000).default(EMAIL_CAPTURE_TEXT),
 max_whatsapp_attempts: z.number().int().min(1).max(2).default(2),
 start_hour: z.number().int().min(0).max(23).default(9), end_hour: z.number().int().min(1).max(24).default(18),
 timezone: z.string().refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }).default("America/Sao_Paulo"),
}).refine((v) => v.start_hour < v.end_hour && (!v.enabled || v.channel_session_id !== null));
export type CapturePolicy = z.infer<typeof capturePolicySchema>;
export function capturePolicy(settings: unknown): CapturePolicy {
 const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).capture_proactivity : undefined;
 const parsed = capturePolicySchema.safeParse(raw ?? {});
 return parsed.success ? parsed.data : capturePolicySchema.parse({});
}
export function captureBusinessHours(p: CapturePolicy, now: Date): boolean {
 const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: p.timezone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now).map((v) => [v.type,v.value]));
 return !["Sun","Sat"].includes(parts.weekday!) && Number(parts.hour) >= p.start_hour && Number(parts.hour) < p.end_hour;
}
