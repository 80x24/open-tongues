/**
 * createHandler — factory function for mounting tongues as middleware.
 *
 * Usage:
 *   import { createHandler } from 'open-tongues/server'
 *   const app = new Hono()
 *   app.route('/tongues', createHandler({ apiKey: process.env.ANTHROPIC_API_KEY! }))
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { translateBodySchema, langCodeSchema } from "../lib/validation";
import { createTranslator } from "../lib/translator";
import type { Translator } from "../lib/translator";

export interface TonguesConfig {
  /** Anthropic API key (required) */
  apiKey: string;
  /** Path to SQLite database file (default: "./tongues.db") */
  dbPath?: string;
  /** Claude model to use (default: "claude-haiku-4-5-20251001") */
  model?: string;
  /** Max in-memory cache entries (default: 10000) */
  cacheSize?: number;
  /** In-memory cache TTL in ms (default: 86400000 = 24h) */
  cacheTTL?: number;
  /** Rate limit per domain per minute (default: 100, 0 = disabled) */
  rateLimit?: number;
  /** CORS origin (default: "*") */
  corsOrigin?: string;
}

export function createHandler(config: TonguesConfig): Hono {
  if (!config.apiKey) {
    throw new Error("open-tongues: apiKey is required");
  }

  const app = new Hono();
  const maxRate = config.rateLimit ?? 100;

  app.use("/*", cors({ origin: config.corsOrigin ?? "*" }));

  // Rate limiter (per domain)
  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  if (maxRate > 0) {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of rateLimits) {
        if (now > v.resetAt) rateLimits.delete(k);
      }
    }, 60_000);
  }

  function checkRate(domain: string): boolean {
    if (maxRate <= 0) return true;
    const now = Date.now();
    const entry = rateLimits.get(domain);
    if (!entry || now > entry.resetAt) {
      rateLimits.set(domain, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (entry.count >= maxRate) return false;
    entry.count++;
    return true;
  }

  // Initialize translator with config
  const translator: Translator = createTranslator({
    apiKey: config.apiKey,
    dbPath: config.dbPath ?? "./tongues.db",
    model: config.model ?? "claude-haiku-4-5-20251001",
    cacheSize: config.cacheSize ?? 10_000,
    cacheTTL: config.cacheTTL ?? 24 * 60 * 60 * 1000,
  });

  // Translation API
  app.post("/api/translate", async (c) => {
    const raw = await c.req.json();
    const parsed = translateBodySchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(", ");
      return c.json({ error: msg }, 400);
    }

    const body = parsed.data;

    if (!checkRate(body.domain)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    try {
      const translations = await translator.translateTexts(body.texts, body.to, body.domain, {
        pageTitle: body.pageTitle,
        pageDescription: body.pageDescription,
        from: body.from,
        preprompt: body.preprompt,
      });
      return c.json({ translations });
    } catch (e) {
      console.error("[tongues] translation error:", e);
      return c.json({ error: "Translation failed" }, 500);
    }
  });

  // Cache purge
  app.post("/api/purge/:domain/:lang", async (c) => {
    const domain = c.req.param("domain");
    const lang = c.req.param("lang");
    const langCheck = langCodeSchema.safeParse(lang);
    if (!langCheck.success) return c.json({ error: "Invalid language code" }, 400);
    const result = await translator.purgeTranslations(domain, langCheck.data);
    return c.json({ ok: true, domain, lang, ...result });
  });

  app.post("/api/purge/:domain", async (c) => {
    const domain = c.req.param("domain");
    const result = await translator.purgeDomainTranslations(domain);
    return c.json({ ok: true, domain, ...result });
  });

  // Health check
  app.get("/health", (c) => c.json({ status: "ok", cache: translator.getCacheStats() }));

  return app;
}
