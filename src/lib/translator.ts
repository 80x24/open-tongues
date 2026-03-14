import Anthropic from "@anthropic-ai/sdk";
import { createDB } from "./db";
import type { DB } from "./db";

// --- Types ---

export interface TranslatorConfig {
  apiKey: string;
  dbPath?: string;
  model?: string;
  cacheSize?: number;
  cacheTTL?: number;
}

export interface TranslateContext {
  pageTitle?: string;
  pageDescription?: string;
  from?: string;
  preprompt?: string;
}

export interface Translator {
  translateTexts(texts: string[], to: string, domain: string, context?: TranslateContext): Promise<Record<string, string>>;
  purgeTranslations(domain: string, lang: string): Promise<{ l1Purged: number; dbPurged: number }>;
  purgeDomainTranslations(domain: string): Promise<{ l1Purged: number; dbPurged: number }>;
  getCacheStats(): CacheStats;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  sqliteHits: number;
  misses: number;
  hitRate: number;
  apiCalls: number;
  textsTranslated: number;
  sqliteReady: boolean;
}

// --- Factory ---

export function createTranslator(config: TranslatorConfig): Translator {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model ?? "claude-haiku-4-5-20251001";
  const MAX_CACHE = config.cacheSize ?? 10_000;
  const TTL_MS = config.cacheTTL ?? 24 * 60 * 60 * 1000;

  // L1: In-memory LRU cache with TTL
  interface CacheEntry {
    value: string;
    expiresAt: number;
  }
  const cache = new Map<string, CacheEntry>();

  // L2: SQLite
  const db: DB = createDB(config.dbPath ?? "./tongues.db");

  // Stats
  let cacheHits = 0;
  let cacheMisses = 0;
  let sqliteHits = 0;
  let apiCalls = 0;
  let textsTranslated = 0;

  function getCacheStats(): CacheStats {
    return {
      size: cache.size,
      maxSize: MAX_CACHE,
      hits: cacheHits,
      sqliteHits,
      misses: cacheMisses,
      hitRate: cacheHits + sqliteHits + cacheMisses > 0
        ? Math.round(((cacheHits + sqliteHits) / (cacheHits + sqliteHits + cacheMisses)) * 100)
        : 0,
      apiCalls,
      textsTranslated,
      sqliteReady: db.isReady(),
    };
  }

  function cacheKey(domain: string, to: string, text: string) {
    return `${domain}:${to}:${text}`;
  }

  function storeCache(domain: string, to: string, original: string, translated: string) {
    const key = cacheKey(domain, to, original);
    cache.delete(key);
    if (cache.size >= MAX_CACHE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, { value: translated, expiresAt: Date.now() + TTL_MS });
  }

  function getCache(domain: string, to: string, text: string): string | null {
    const key = cacheKey(domain, to, text);
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  }

  async function claudeTranslate(
    texts: string[],
    to: string,
    context?: TranslateContext
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const prompt = texts.map((t, i) => `[${i}] ${t}`).join("\n");
    const targetLang = langName(to);

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Translate every numbered text below into ${targetLang}. The source texts may be in any language — detect each one individually and translate it to ${targetLang}. Keep the [N] numbering. Output only the translated lines, no explanations.

Some texts may contain HTML tags (e.g. <strong>, <a href="...">, <br>).
Preserve all HTML tags and their attributes exactly as written.
If a source text has NO HTML tags, your translation MUST also have NO HTML tags.

${prompt}`,
        },
      ],
      system: `You are a website translator. Target: ${targetLang} (${to}).${context?.from ? ` Likely source: ${langName(context.from)}.` : ""} Rules: 1) Every text MUST be translated to ${targetLang} — never return the source text unchanged unless it is already valid ${targetLang}. 2) Texts may come from different source languages in one batch. 3) Only preserve brand names, product names, and technical terms (URLs, code, variable names) in their original form. 4) Preserve all HTML tags and attributes exactly — but NEVER add HTML tags to text that has none. 5) Keep translations concise and natural for web UI.${context?.pageTitle ? ` Page: "${context.pageTitle}${context?.pageDescription ? ` — ${context.pageDescription}` : ""}".` : ""}${context?.preprompt ? ` Note: ${context.preprompt}` : ""}`,
    });

    const responseText = response.content[0].type === "text" ? response.content[0].text : "";

    // Split by [N] markers to handle multiline responses (#92).
    // LLM may wrap long translations across multiple lines, so line-by-line
    // parsing with (.+)$ would only capture the first line and drop the rest.
    const blocks = responseText.split(/(?=^\[\d+\])/m);
    for (const block of blocks) {
      const match = block.match(/^\[(\d+)\]\s*([\s\S]+)$/);
      if (match) {
        const idx = parseInt(match[1]);
        const translated = match[2].trim();
        if (idx < texts.length) {
          result[texts[idx]] = stripPhantomHtml(texts[idx], translated);
        }
      }
    }

    for (const text of texts) {
      if (!result[text]) result[text] = text;
    }

    return result;
  }

  async function translateTexts(
    texts: string[],
    to: string,
    domain: string,
    context?: TranslateContext
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const l1Missed: string[] = [];

    // L1: in-memory lookup
    for (const text of texts) {
      const cached = getCache(domain, to, text);
      if (cached) {
        cacheHits++;
        result[text] = cached;
      } else {
        l1Missed.push(text);
      }
    }

    if (l1Missed.length === 0) return result;

    // L2: SQLite lookup
    const sqliteResults = db.getTranslations(domain, to, l1Missed);
    const uncached: string[] = [];
    for (let i = 0; i < l1Missed.length; i++) {
      const text = l1Missed[i];
      const sqliteVal = sqliteResults[i];
      if (sqliteVal) {
        sqliteHits++;
        const clean = stripPhantomHtml(text, sqliteVal);
        result[text] = clean;
        storeCache(domain, to, text, clean);
      } else {
        cacheMisses++;
        uncached.push(text);
      }
    }

    if (uncached.length === 0) return result;

    // L3: Claude API
    apiCalls++;
    textsTranslated += uncached.length;
    const translations = await claudeTranslate(uncached, to, context);

    const dbEntries: { domain: string; lang: string; original: string; translated: string }[] = [];

    for (const [original, translated] of Object.entries(translations)) {
      result[original] = translated;
      storeCache(domain, to, original, translated);
      dbEntries.push({ domain, lang: to, original, translated });
    }

    db.setTranslations(dbEntries);

    return result;
  }

  async function purgeTranslations(domain: string, lang: string): Promise<{ l1Purged: number; dbPurged: number }> {
    let l1Purged = 0;
    const prefix = `${domain}:${lang}:`;
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
        l1Purged++;
      }
    }
    const dbPurged = db.deleteTranslationsByDomainLang(domain, lang);
    return { l1Purged, dbPurged };
  }

  async function purgeDomainTranslations(domain: string): Promise<{ l1Purged: number; dbPurged: number }> {
    let l1Purged = 0;
    const prefix = `${domain}:`;
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
        l1Purged++;
      }
    }
    const dbPurged = db.deleteTranslationsByDomain(domain);
    return { l1Purged, dbPurged };
  }

  return {
    translateTexts,
    purgeTranslations,
    purgeDomainTranslations,
    getCacheStats,
  };
}

// --- Shared utilities ---

const LANG_NAMES: Record<string, string> = {
  ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese",
  es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
  it: "Italian", ru: "Russian", ar: "Arabic", hi: "Hindi",
  th: "Thai", vi: "Vietnamese", id: "Indonesian", ms: "Malay",
  tr: "Turkish", nl: "Dutch", pl: "Polish", sv: "Swedish",
  da: "Danish", no: "Norwegian", fi: "Finnish", cs: "Czech",
  uk: "Ukrainian", ro: "Romanian", hu: "Hungarian", el: "Greek",
  he: "Hebrew", bn: "Bengali", ta: "Tamil", te: "Telugu",
};

function langName(code: string): string {
  return LANG_NAMES[code] || code;
}

/** If original has no `<`, strip any HTML tags the LLM hallucinated */
function stripPhantomHtml(original: string, translated: string): string {
  if (original.includes("<")) return translated;
  return translated.replace(/<[^>]+>/g, "");
}

// --- Legacy exports for standalone server (backward compat) ---

let _defaultTranslator: Translator | null = null;

function getDefaultTranslator(): Translator {
  if (!_defaultTranslator) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Return mock translator when no API key
      return createMockTranslator();
    }
    _defaultTranslator = createTranslator({
      apiKey,
      dbPath: process.env.DB_PATH || "./tongues.db",
    });
  }
  return _defaultTranslator;
}

function createMockTranslator(): Translator {
  return {
    async translateTexts(texts, to) {
      console.warn("[tongues] ANTHROPIC_API_KEY not set — using mock translations");
      const result: Record<string, string> = {};
      for (const text of texts) result[text] = `[${to}] ${text}`;
      return result;
    },
    async purgeTranslations() { return { l1Purged: 0, dbPurged: 0 }; },
    async purgeDomainTranslations() { return { l1Purged: 0, dbPurged: 0 }; },
    getCacheStats() {
      return { size: 0, maxSize: 0, hits: 0, sqliteHits: 0, misses: 0, hitRate: 0, apiCalls: 0, textsTranslated: 0, sqliteReady: false };
    },
  };
}

// Legacy named exports used by standalone server and seo module
export async function translateTexts(
  texts: string[],
  to: string,
  domain: string,
  context?: TranslateContext
): Promise<Record<string, string>> {
  return getDefaultTranslator().translateTexts(texts, to, domain, context);
}

export function getCacheStats() {
  return getDefaultTranslator().getCacheStats();
}

export async function purgeTranslations(domain: string, lang: string) {
  return getDefaultTranslator().purgeTranslations(domain, lang);
}

export async function purgeDomainTranslations(domain: string) {
  return getDefaultTranslator().purgeDomainTranslations(domain);
}

export function isDBReady(): boolean {
  return getDefaultTranslator().getCacheStats().sqliteReady;
}
