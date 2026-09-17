import { z } from "zod";

/** Fonte única do perfil em organizations.settings.business_profile. */
export const businessProfileSchema = z.object({
  description: z.string().trim().max(2000).default(""),
  website: z.string().trim().max(2048).url().refine((v) => /^https?:\/\//i.test(v), "Use um site HTTP ou HTTPS.").or(z.literal("")).default(""),
  phone: z.string().trim().max(60).default(""),
  address: z.string().trim().max(500).default(""),
  business_hours: z.string().trim().max(500).default(""),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;
