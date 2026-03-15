import { Hono } from "hono";
import { cors } from "hono/cors";
import { initDB } from "../lib/db";
import { translateTexts, getCacheStats, purgeTranslations, purgeDomainTranslations } from "../lib/translator";
import { translateBodySchema, langCodeSchema } from "../lib/validation";
import { renderTranslatedPage } from "../lib/seo";

const app = new Hono();

app.use("/*", cors({ origin: "*" }));

// Simple in-memory rate limiter (per domain, 100 req/min)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) {
    if (now > v.resetAt) rateLimits.delete(k);
  }
}, 60_000);

function rateLimit(domain: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(domain);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(domain, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 100) return false;
  entry.count++;
  return true;
}

// Client bundle serving
const bundleCache = new Map<string, { content: string; etag: string }>();

app.get("/t.js", async (c) => {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const { version } = await Bun.file("package.json").json();
    const r = await Bun.build({ entrypoints: ["src/client/t.ts"], minify: false, define: { __VERSION__: JSON.stringify(version) } });
    if (!r.success) return c.text("// build error", 500);
    c.header("Content-Type", "application/javascript");
    c.header("Cache-Control", "no-cache, no-store");
    return c.body(await r.outputs[0].text());
  }
  const file = Bun.file("dist/t.js");
  if (!(await file.exists())) return c.text("// t.js not built", 500);
  if (!bundleCache.has("t.js")) {
    const content = await file.text();
    const hash = new Bun.CryptoHasher("md5").update(content).digest("hex").slice(0, 12);
    bundleCache.set("t.js", { content, etag: `"${hash}"` });
  }
  const cached = bundleCache.get("t.js")!;
  if (c.req.header("If-None-Match") === cached.etag) return c.body(null, 304);
  c.header("Content-Type", "application/javascript");
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  c.header("ETag", cached.etag);
  return c.body(cached.content);
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

  if (!rateLimit(body.domain)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  try {
    const translations = await translateTexts(body.texts, body.to, body.domain, {
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

// SEO: server-side rendered translation
app.get("/api/seo/render", async (c) => {
  const url = c.req.query("url");
  const lang = c.req.query("lang");

  if (!url) return c.json({ error: "url parameter is required" }, 400);
  if (!lang) return c.json({ error: "lang parameter is required" }, 400);

  const langCheck = langCodeSchema.safeParse(lang);
  if (!langCheck.success) {
    return c.json({ error: "Invalid language code" }, 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return c.json({ error: "URL must use http or https protocol" }, 400);
  }

  const hostname = parsedUrl.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname.startsWith("192.168.") || hostname.startsWith("10.") || hostname.startsWith("172.") || hostname === "::1") {
    return c.json({ error: "Cannot fetch internal URLs" }, 400);
  }

  if (!rateLimit(hostname)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  try {
    const result = await renderTranslatedPage({ url, lang: langCheck.data, domain: hostname });
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    c.header("X-Tongues-Texts-Translated", String(result.textsTranslated));
    return c.body(result.html);
  } catch (e: any) {
    console.error("[seo] render error:", e.message);
    if (e.message?.includes("Failed to fetch")) {
      return c.json({ error: "Failed to fetch the target URL" }, 502);
    }
    if (e.message?.includes("did not return HTML")) {
      return c.json({ error: e.message }, 400);
    }
    return c.json({ error: "Server-side rendering failed" }, 500);
  }
});

// Cache purge
app.post("/api/purge/:domain/:lang", async (c) => {
  const domain = c.req.param("domain");
  const lang = c.req.param("lang");
  const langCheck = langCodeSchema.safeParse(lang);
  if (!langCheck.success) return c.json({ error: "Invalid language code" }, 400);
  const result = await purgeTranslations(domain, langCheck.data);
  return c.json({ ok: true, domain, lang, ...result });
});

app.post("/api/purge/:domain", async (c) => {
  const domain = c.req.param("domain");
  const result = await purgeDomainTranslations(domain);
  return c.json({ ok: true, domain, ...result });
});

// Test page (dev only)
app.get("/test", async (c) => {
  const file = Bun.file("test/test.html");
  if (!(await file.exists())) return c.text("test/test.html not found", 404);
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  return c.body(await file.text());
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", cache: getCacheStats() }));

// Initialize
initDB();

const port = parseInt(process.env.PORT || "3000");
console.log(`tongues server listening on :${port}`);

export { app };

export default {
  port,
  fetch: app.fetch,
};
