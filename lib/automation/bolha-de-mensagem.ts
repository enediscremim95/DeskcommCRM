import { z } from "zod";

export const MAX_BOLHAS_PRIMEIRA_MENSAGEM = 13;

export function caminhoDeAtivoDeImagemValido(arquivo: string): boolean {
  if (!arquivo || arquivo.startsWith("/") || arquivo.includes("\\")) return false;
  if (arquivo.includes("//") || arquivo.includes("..")) return false;
  if (!/^[A-Za-z0-9_\-./]+$/.test(arquivo)) return false;
  if (arquivo.split("/").some((segmento) => !segmento || segmento === ".")) return false;
  return /\.(?:jpe?g|png|webp)$/.test(arquivo);
}

export const bolhaDeTextoSchema = z
  .string()
  .max(1000)
  .refine((value) => value.trim().length > 0, "A bolha não pode ficar vazia.");

export const bolhaDeImagemSchema = z
  .object({
    tipo: z.literal("imagem"),
    arquivo: z
      .string()
      .max(500)
      .refine(
        caminhoDeAtivoDeImagemValido,
        "O caminho da imagem precisa ser relativo a ativos e terminar em jpg, jpeg, png ou webp.",
      ),
    legenda: z.string().max(1000).optional(),
  })
  .strict();

export const bolhaDeMensagemSchema = z.union([bolhaDeTextoSchema, bolhaDeImagemSchema]);

export const listaDeBolhasSchema = z
  .array(bolhaDeMensagemSchema)
  .min(2)
  .max(MAX_BOLHAS_PRIMEIRA_MENSAGEM);

export type BolhaDeImagem = z.infer<typeof bolhaDeImagemSchema>;
export type BolhaDeMensagem = z.infer<typeof bolhaDeMensagemSchema>;

export function ehBolhaDeImagem(bolha: BolhaDeMensagem): bolha is BolhaDeImagem {
  return typeof bolha === "object" && bolha.tipo === "imagem";
}

export function erroDaListaDeBolhas(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const parte of value) {
      if (
        parte &&
        typeof parte === "object" &&
        "tipo" in parte &&
        (parte as { tipo?: unknown }).tipo === "imagem"
      ) {
        const arquivo = (parte as { arquivo?: unknown }).arquivo;
        if (typeof arquivo !== "string" || !caminhoDeAtivoDeImagemValido(arquivo)) {
          return `first_message_queue_invalid_image_path:${String(arquivo ?? "")}`;
        }
      }
    }
  }
  const parsed = listaDeBolhasSchema.safeParse(value);
  if (parsed.success) return null;
  return `first_message_queue_invalid_parts:${parsed.error.issues[0]?.message ?? "invalid"}`;
}
