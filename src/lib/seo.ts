/**
 * SEO server-side rendering — fetches a page, translates text nodes, returns translated HTML.
 * Uses linkedom for lightweight HTML parsing (no browser needed).
 */
import { parseHTML } from "linkedom";
import { translateTexts } from "./translator";
import type { TranslateContext } from "./translator";

// Tags to skip (same as client t.ts)
const SKIP_TAGS = new Set(
  "SCRIPT,STYLE,NOSCRIPT,SVG,TEMPLATE,CODE,PRE,KBD,SAMP,VAR,CANVAS,VIDEO,AUDIO,IFRAME,MATH".split(",")
);

// Attributes that contain translatable text
const TRANSLATABLE_ATTRS = ["placeholder", "title", "alt", "aria-label"];

// Minimum text length to consider for translation
const MIN_TEXT_LENGTH = 2;

// Max texts per batch (same limit as client)
const MAX_TEXTS_PER_BATCH = 100;

// Max total texts to translate per page (safety limit)
const MAX_TOTAL_TEXTS = 500;

// Fetch timeout
const FETCH_TIMEOUT_MS = 10_000;

export interface SeoRenderOptions {
  url: string;
  lang: string;
  domain?: string; // override domain for cache key (defaults to URL hostname)
}

export interface SeoRenderResult {
  html: string;
  textsTranslated: number;
  fromCache: boolean;
}

/**
 * Extract translatable text nodes from a parsed document.
 * Returns a Map of unique text -> list of text nodes containing that text.
 */
export function extractTexts(document: any): { textNodes: Map<string, any[]>; attrNodes: Map<string, { el: any; attr: string }[]> } {
  const textNodes = new Map<string, any[]>();
  const attrNodes = new Map<string, { el: any; attr: string }[]>();

  function walk(node: any) {
    if (!node) return;
    if (node.nodeType === 1) { // Element
      const tagName = node.tagName?.toUpperCase();
      if (SKIP_TAGS.has(tagName)) return;
      if (node.getAttribute?.("translate") === "no" || node.classList?.contains("notranslate")) return;

      // Check translatable attributes
      for (const attr of TRANSLATABLE_ATTRS) {
        const val = node.getAttribute?.(attr)?.trim();
        if (val && val.length >= MIN_TEXT_LENGTH) {
          const list = attrNodes.get(val) || [];
          list.push({ el: node, attr });
          attrNodes.set(val, list);
        }
      }

      // Walk children
      for (const child of node.childNodes || []) {
        walk(child);
      }
    } else if (node.nodeType === 3) { // Text node
      const text = node.textContent?.trim();
      if (text && text.length >= MIN_TEXT_LENGTH) {
        const list = textNodes.get(text) || [];
        list.push(node);
        textNodes.set(text, list);
      }
    }
  }

  walk(document.body || document.documentElement);
  return { textNodes, attrNodes };
}

/**
 * Fetch a URL and return its HTML content.
 */
export async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Tongues-SEO-Renderer/1.0",
        "Accept": "text/html",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/xhtml")) {
      throw new Error(`URL did not return HTML (got ${contentType})`);
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Render a translated version of a page for SEO.
 * Fetches the URL, parses HTML, extracts texts, translates, and returns the modified HTML.
 */
export async function renderTranslatedPage(options: SeoRenderOptions): Promise<SeoRenderResult> {
  const { url, lang } = options;
  const parsedUrl = new URL(url);
  const domain = options.domain || parsedUrl.hostname;

  // Fetch the page
  const html = await fetchPage(url);

  // Parse HTML
  const { document } = parseHTML(html);

  // Extract translatable texts
  const { textNodes, attrNodes } = extractTexts(document);

  // Collect unique texts (capped)
  const allTexts = [...new Set([...textNodes.keys(), ...attrNodes.keys()])];
  const textsToTranslate = allTexts.slice(0, MAX_TOTAL_TEXTS);

  if (textsToTranslate.length === 0) {
    return { html: document.toString(), textsTranslated: 0, fromCache: false };
  }

  // Get page context for better translations
  const titleEl = document.querySelector("title");
  const descEl = document.querySelector('meta[name="description"]');
  const context: TranslateContext = {
    pageTitle: titleEl?.textContent || undefined,
    pageDescription: descEl?.getAttribute("content") || undefined,
  };

  // Translate in batches
  const allTranslations: Record<string, string> = {};

  for (let i = 0; i < textsToTranslate.length; i += MAX_TEXTS_PER_BATCH) {
    const batch = textsToTranslate.slice(i, i + MAX_TEXTS_PER_BATCH);
    const translations = await translateTexts(batch, lang, domain, context);
    Object.assign(allTranslations, translations);
  }

  // Apply translations to text nodes
  for (const [original, nodes] of textNodes) {
    const translated = allTranslations[original];
    if (translated && translated !== original) {
      for (const node of nodes) {
        // Preserve leading/trailing whitespace from the original node
        const raw = node.textContent || "";
        const leadingSpace = raw.match(/^\s*/)?.[0] || "";
        const trailingSpace = raw.match(/\s*$/)?.[0] || "";
        node.textContent = leadingSpace + translated + trailingSpace;
      }
    }
  }

  // Apply translations to attributes
  for (const [original, entries] of attrNodes) {
    const translated = allTranslations[original];
    if (translated && translated !== original) {
      for (const { el, attr } of entries) {
        el.setAttribute(attr, translated);
      }
    }
  }

  // Set lang attribute on html element
  const htmlEl = document.querySelector("html");
  if (htmlEl) {
    htmlEl.setAttribute("lang", lang);
  }

  return {
    html: document.toString(),
    textsTranslated: textsToTranslate.length,
    fromCache: false,
  };
}
