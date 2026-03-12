import { z } from "zod";

// BCP 47 simplified locale pattern
// Accepts: "ko", "en", "zh-Hans", "tok", "pt-BR", "zh-Hant-TW"
// Primary subtag: 2-8 letters, subsequent subtags: 1-8 alphanumeric
const LOCALE_PATTERN = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;

export const langCodeSchema = z
  .string()
  .max(35, "Language code too long")
  .regex(LOCALE_PATTERN, "Invalid locale format");

export const translateBodySchema = z.object({
  texts: z.array(z.string().max(5000)).min(1).max(100),
  to: langCodeSchema,
  domain: z.string().max(253),
  from: langCodeSchema.optional(),
  pageTitle: z.string().max(200).optional(),
  pageDescription: z.string().max(1000).optional(),
  preprompt: z.string().trim().max(30).optional(),
});

export type TranslateBody = z.infer<typeof translateBodySchema>;

// Validate a single lang code — returns normalized lowercase or null
export function validateLangCode(code: string): string | null {
  const result = langCodeSchema.safeParse(code);
  return result.success ? result.data : null;
}
