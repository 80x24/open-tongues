import Anthropic from "@anthropic-ai/sdk";
import { dbGetTranslations, dbSetTranslations, dbDeleteTranslationsByDomainLang, dbDeleteTranslationsByDomain, isDBReady } from "./db";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

// L1: In-memory LRU cache with TTL
interface CacheEntry {
  value: string;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 10_000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Stats
let cacheHits = 0;
let cacheMisses = 0;
let sqliteHits = 0;
let apiCalls = 0;
let textsTranslated = 0;

export function getCacheStats() {
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
    sqliteReady: isDBReady(),
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

async function mockTranslate(texts: string[], to: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const text of texts) {
    result[text] = `[${to}] ${text}`;
  }
  return result;
}

export interface TranslateContext {
  pageTitle?: string;
  pageDescription?: string;
  from?: string;
  preprompt?: string;
}

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

const PH_TAG_RE = /<\/?(\d+)\s*\/?>/;

function stripPhantomTags(original: string, translated: string): string {
  if (PH_TAG_RE.test(original)) return translated;
  return translated.replace(/<\/?(\d+)\s*\/?>/g, "");
}

const WORD_TO_DIGIT: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15",
};
const TAG_FIX_RE = new RegExp(
  `<(/?)(${Object.keys(WORD_TO_DIGIT).join("|")})(/)?>`,
  "gi"
);

function fixPlaceholderTags(text: string): string {
  return text.replace(TAG_FIX_RE, (_, slash1, word, slash2) => {
    const digit = WORD_TO_DIGIT[word.toLowerCase()];
    if (!digit) return _;
    return `<${slash1 || ""}${digit}${slash2 || ""}>`;
  });
}

async function claudeTranslate(
  texts: string[],
  to: string,
  context?: TranslateContext
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const prompt = texts.map((t, i) => `[${i}] ${t}`).join("\n");
  const targetLang = langName(to);

  const response = await client!.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Translate every numbered text below into ${targetLang}. The source texts may be in any language — detect each one individually and translate it to ${targetLang}. Keep the [N] numbering. Output only the translated lines, no explanations.

IMPORTANT — Placeholder tags like <0>, </0>, <1>, </1>, <2>, </2> are NOT HTML. They are opaque tokens that MUST appear in your output exactly as written. Never rename, rewrite, or spell out the numbers (e.g. do NOT change <0> to <zero>).
CRITICAL — If a source text contains NO placeholder tags, your translation MUST also contain NO placeholder tags. Never invent or add tags that do not exist in the input.
  Example with tags:
    Input:  [0] <0>Email address:</0> Provided during registration.
    Output: [0] <0>メールアドレス：</0> 登録時に提供されます。
  Example without tags:
    Input:  [1] Read-only. Current translation locale (e.g. "en", "ja").
    Output: [1] 읽기 전용입니다. 현재 번역 언어입니다 (예: "en", "ja").

${prompt}`,
      },
    ],
    system: `You are a website translator. Target: ${targetLang} (${to}).${context?.from ? ` Likely source: ${langName(context.from)}.` : ""} Rules: 1) Every text MUST be translated to ${targetLang} — never return the source text unchanged unless it is already valid ${targetLang}. 2) Texts may come from different source languages in one batch. 3) Only preserve brand names, product names, and technical terms (URLs, code, variable names) in their original form. 4) Preserve numbered placeholder tags (<0>...</0>, <1/>, etc.) exactly — but NEVER add placeholder tags to text that has none. 5) Keep translations concise and natural for web UI.${context?.pageTitle ? ` Page: "${context.pageTitle}${context?.pageDescription ? ` — ${context.pageDescription}` : ""}".` : ""}${context?.preprompt ? ` Note: ${context.preprompt}` : ""}`,
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
      const fixed = fixPlaceholderTags(match[2].trim());
      if (idx < texts.length) {
        result[texts[idx]] = stripPhantomTags(texts[idx], fixed);
      }
    }
  }

  for (const text of texts) {
    if (!result[text]) result[text] = text;
  }

  return result;
}

export async function translateTexts(
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
  const sqliteResults = dbGetTranslations(domain, to, l1Missed);
  const uncached: string[] = [];
  for (let i = 0; i < l1Missed.length; i++) {
    const text = l1Missed[i];
    const sqliteVal = sqliteResults[i];
    if (sqliteVal) {
      sqliteHits++;
      result[text] = sqliteVal;
      storeCache(domain, to, text, sqliteVal);
    } else {
      cacheMisses++;
      uncached.push(text);
    }
  }

  if (uncached.length === 0) return result;

  // L3: Claude API
  apiCalls++;
  textsTranslated += uncached.length;
  const translations = client
    ? await claudeTranslate(uncached, to, context)
    : await mockTranslate(uncached, to);

  const dbEntries: { domain: string; lang: string; original: string; translated: string }[] = [];

  for (const [original, translated] of Object.entries(translations)) {
    result[original] = translated;
    storeCache(domain, to, original, translated);
    dbEntries.push({ domain, lang: to, original, translated });
  }

  dbSetTranslations(dbEntries);

  if (!client) {
    console.warn("[tongues] ANTHROPIC_API_KEY not set — using mock translations");
  }

  return result;
}

export async function purgeTranslations(domain: string, lang: string): Promise<{ l1Purged: number; dbPurged: number }> {
  let l1Purged = 0;
  const prefix = `${domain}:${lang}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      l1Purged++;
    }
  }
  const dbPurged = dbDeleteTranslationsByDomainLang(domain, lang);
  return { l1Purged, dbPurged };
}

export async function purgeDomainTranslations(domain: string): Promise<{ l1Purged: number; dbPurged: number }> {
  let l1Purged = 0;
  const prefix = `${domain}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      l1Purged++;
    }
  }
  const dbPurged = dbDeleteTranslationsByDomain(domain);
  return { l1Purged, dbPurged };
}
