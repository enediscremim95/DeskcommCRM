/**
 * O TEXTO do lembrete do compromisso — puro, para o cron `agenda-reminder`.
 *
 * ─── Variáveis do modelo (`reminder_template_name`) ─────────────────────────
 *
 * `{{nome}}` (nome do contato), `{{data}}` (dia da semana e dia/mês) e
 * `{{hora}}` (HH:mm), no FUSO DA ORGANIZAÇÃO, e `{{link}}`. Espaços dentro das
 * chaves são tolerados (`{{ nome }}`); variável desconhecida fica como está.
 * Modelo sem variável nenhuma sai idêntico ao que saía antes.
 *
 * ─── O link ─────────────────────────────────────────────────────────────────
 *
 * `{{link}}` = o link da sala do compromisso quando ele está PRONTO
 * (`meeting_state='ready'` + `meeting_url`: Google Meet observado no evento
 * salvo, ou Jitsi); sem sala, o local do compromisso/tipo (`location_details`).
 * Sem nenhum dos dois, vira vazio — nunca um link inventado.
 *
 * Decisão documentada: o modelo do dono MANDA. Se ele não escreveu `{{link}}`,
 * nada é acrescentado ao texto dele (pode ter colado o link fixo à mão). Já o
 * texto PADRÃO (sem modelo) ganha "Link da reunião: …" quando há sala pronta e
 * ela não é o próprio endereço já impresso — sem sala, o padrão é o de antes,
 * palavra por palavra.
 */
import { tagDeIdioma } from "@/lib/i18n/datas";
import { IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";

export function linkDaSala(a: { meeting_state?: string | null; meeting_url?: string | null }): string | null {
  const url = a.meeting_url?.trim();
  return a.meeting_state === "ready" && url ? url : null;
}

export function linkParaOModelo(a: {
  meeting_state?: string | null;
  meeting_url?: string | null;
  location_details?: string | null;
  tipo_location_details?: string | null;
}): string {
  return linkDaSala(a) ?? (a.location_details?.trim() || a.tipo_location_details?.trim() || "");
}

export function dataEHoraDoLembrete(
  quando: Date,
  timezone: string,
  idioma: Idioma = IDIOMA_PADRAO,
): { data: string; hora: string } {
  const etiqueta = tagDeIdioma(idioma);
  const data = new Intl.DateTimeFormat(etiqueta, {
    timeZone: timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(quando);
  const hora = new Intl.DateTimeFormat(etiqueta, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(quando);
  return { data, hora };
}

export interface VariaveisDoLembrete {
  nome: string;
  data: string;
  hora: string;
  link: string;
}

export function aplicarVariaveisDoLembrete(modelo: string, v: VariaveisDoLembrete): string {
  return modelo.replace(/\{\{\s*(nome|data|hora|link)\s*\}\}/gi, (_m, chave: string) => {
    const k = chave.toLowerCase() as keyof VariaveisDoLembrete;
    return v[k];
  });
}
