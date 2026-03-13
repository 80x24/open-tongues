/**
 * open-tongues — zero-config website translation
 *
 * Server:
 *   import { createHandler } from 'open-tongues'
 *   app.route('/tongues', createHandler({ apiKey: process.env.ANTHROPIC_API_KEY! }))
 */
export { createHandler } from "./server/handler";
export type { TonguesConfig } from "./server/handler";
export type { Translator, TranslatorConfig, TranslateContext, CacheStats } from "./lib/translator";
export { createTranslator } from "./lib/translator";

// Validation schemas (shared with commercial tongues)
export { translateBodySchema, langCodeSchema, validateLangCode } from "./lib/validation";
export type { TranslateBody } from "./lib/validation";
