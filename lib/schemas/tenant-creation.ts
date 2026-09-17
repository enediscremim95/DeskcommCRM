import { z } from "zod";
import { businessProfileSchema } from "@/lib/schemas/business-profile";
import { interfaceSettingsSchema, interfaceTemDestino } from "@/lib/navigation/interface";

/** Mesmo vocabulário no formulário e no limite HTTP. */
export const tenantCreationFields = {
  business_profile: businessProfileSchema.optional(),
  timezone: z.string().max(64).refine((value) => { try { new Intl.DateTimeFormat(undefined, { timeZone: value }); return true; } catch { return false; } }, "Fuso horário inválido").optional(),
  delivery_mode: z.enum(["credentials", "invite"]).default("invite"),
  display_name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Apenas letras minúsculas, números e hífens"),
  legal_name: z.string().max(255).optional(),
  cnpj: z.string().max(18).optional(),
  plan: z.enum(["standard", "pro", "enterprise"]),
  report_url: z.string().url().startsWith("https://").optional().or(z.literal("")),
  owner_interface_settings: interfaceSettingsSchema.optional(),
  owner_email: z.string().trim().email(),
};
export const createTenantSchema = z
  .object({ ...tenantCreationFields, plan: tenantCreationFields.plan.default("standard") })
  .refine(
    (v) => !v.owner_interface_settings || interfaceTemDestino(v.owner_interface_settings, "admin"),
    { message: "Selecione ao menos uma área de trabalho.", path: ["owner_interface_settings"] },
  );
