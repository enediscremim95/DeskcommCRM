import { z } from "zod";

export const createNoteSchema = z.object({ body: z.string().trim().min(1).max(4096) });
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

const contemTagHtml = /<\/?[a-z][^>]*>/i;

export const createLeadNoteSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((text) => !contemTagHtml.test(text), "HTML não é permitido."),
});
export type CreateLeadNoteInput = z.infer<typeof createLeadNoteSchema>;
