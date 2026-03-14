import { describe, test, expect, beforeEach, mock } from "bun:test";
import { parseHTML } from "linkedom";

/**
 * Unit tests for data-lang attribute feature.
 *
 * When <script src="…/t.js" data-lang="ko"> is set, tongues knows the
 * page source language. If the browser locale matches, auto-translate
 * is skipped (no API calls). Manual setLocale() still works.
 *
 * Replicates cfg() and init() logic from t.ts since it has no exports.
 */

// --- Replicate relevant logic from t.ts ---

const LR = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;

interface TonguesState {
  api: string;
  host: string;
  loc: string;
  iloc: string;
  busy: boolean;
  done: boolean;
  manual: boolean;
  pprompt: string;
  slang: string;
}

function createState(): TonguesState {
  return { api: "", host: "", loc: "", iloc: "", busy: false, done: false, manual: false, pprompt: "", slang: "" };
}

/** Replicate cfg() logic */
function cfg(state: TonguesState, scriptEl: Element | null, navigatorLang: string, hostname: string): boolean {
  if (!scriptEl) return false;
  const src = scriptEl.getAttribute("src") || "";
  state.api = src.replace(/\/t\.js.*$/, "");
  state.host = hostname;
  state.iloc = state.loc = (navigatorLang || "en").split("-")[0];
  state.slang = (scriptEl.getAttribute("data-lang") || "").split("-")[0];
  state.manual = scriptEl.hasAttribute("data-manual");
  state.pprompt = (scriptEl.getAttribute("data-preprompt") || "").trim().slice(0, 30);
  return true;
}

/** Replicate init() skip condition: !manual && !(slang && loc === slang) */
function shouldAutoTranslate(state: TonguesState): boolean {
  return !state.manual && !(state.slang && state.loc === state.slang);
}

/** Replicate sourceLocale getter */
function sourceLocale(state: TonguesState): string {
  return state.slang || state.iloc;
}

/** Replicate setLocale logic (returns whether translate should run) */
function setLocale(state: TonguesState, l: string): boolean {
  if (l === state.loc || !l || l.length > 35 || !LR.test(l)) return false;
  state.loc = l;
  return true; // translate() would be called
}

// --- Helpers ---

function makeDoc(bodyHtml: string, scriptAttrs: Record<string, string> = {}) {
  const attrStr = Object.entries(scriptAttrs).map(([k, v]) => `${k}="${v}"`).join(" ");
  const scriptTag = `<script src="https://tongues.80x24.ai/t.js" ${attrStr}></script>`;
  const { document } = parseHTML(
    `<!DOCTYPE html><html><head>${scriptTag}</head><body>${bodyHtml}</body></html>`
  );
  const script = document.querySelector("script[src*='t.js']");
  return { document, script };
}

// --- Tests ---

describe("data-lang: cfg() parsing", () => {
  test('data-lang="ko" sets slang to "ko"', () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(state.slang).toBe("ko");
  });

  test('data-lang="ko-KR" extracts base language "ko"', () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "ko-KR" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(state.slang).toBe("ko");
  });

  test('data-lang="en-US" extracts base language "en"', () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "en-US" });
    const state = createState();
    cfg(state, script, "ko", "example.com");
    expect(state.slang).toBe("en");
  });

  test("no data-lang attribute leaves slang empty", () => {
    const { script } = makeDoc("<p>Hello</p>");
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(state.slang).toBe("");
  });

  test('data-lang="" leaves slang empty', () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(state.slang).toBe("");
  });
});

describe("data-lang: auto-translate skip logic", () => {
  test('data-lang="ko" + browser locale "ko" → skip auto-translate', () => {
    const { script } = makeDoc("<p>안녕하세요</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "ko", "example.com");
    expect(shouldAutoTranslate(state)).toBe(false);
  });

  test('data-lang="ko" + browser locale "en" → auto-translate runs', () => {
    const { script } = makeDoc("<p>안녕하세요</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(shouldAutoTranslate(state)).toBe(true);
  });

  test('data-lang="ko-KR" + browser locale "ko" → match (base language comparison)', () => {
    const { script } = makeDoc("<p>안녕하세요</p>", { "data-lang": "ko-KR" });
    const state = createState();
    cfg(state, script, "ko", "example.com");
    // slang is "ko" (extracted from "ko-KR"), loc is "ko" (extracted from "ko")
    expect(state.slang).toBe("ko");
    expect(state.loc).toBe("ko");
    expect(shouldAutoTranslate(state)).toBe(false);
  });

  test('data-lang="ko-KR" + browser locale "ko-KR" → match (both extract to "ko")', () => {
    const { script } = makeDoc("<p>안녕하세요</p>", { "data-lang": "ko-KR" });
    const state = createState();
    cfg(state, script, "ko-KR", "example.com");
    expect(state.slang).toBe("ko");
    expect(state.loc).toBe("ko");
    expect(shouldAutoTranslate(state)).toBe(false);
  });

  test("no data-lang → always auto-translates (backward compat)", () => {
    const { script } = makeDoc("<p>Hello</p>");
    const state = createState();
    cfg(state, script, "en", "example.com");
    // slang is empty, so !(slang && ...) is true → !manual && true → true
    expect(shouldAutoTranslate(state)).toBe(true);
  });

  test("no data-lang + any locale → auto-translates", () => {
    const { script } = makeDoc("<p>Hello</p>");
    const state = createState();
    cfg(state, script, "ko", "example.com");
    expect(shouldAutoTranslate(state)).toBe(true);
  });
});

describe("data-lang: manual setLocale() still works when auto-translate skipped", () => {
  test('data-lang="ko" + locale "ko" + setLocale("en") → translate runs', () => {
    const { script } = makeDoc("<p>안녕하세요</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "ko", "example.com");
    // Auto-translate skipped
    expect(shouldAutoTranslate(state)).toBe(false);
    // Manual setLocale should still work
    const shouldTranslate = setLocale(state, "en");
    expect(shouldTranslate).toBe(true);
    expect(state.loc).toBe("en");
  });

  test('data-lang="ko" + locale "ko" + setLocale("ja") → translate runs', () => {
    const { script } = makeDoc("<p>안녕하세요</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "ko", "example.com");
    expect(shouldAutoTranslate(state)).toBe(false);
    const shouldTranslate = setLocale(state, "ja");
    expect(shouldTranslate).toBe(true);
    expect(state.loc).toBe("ja");
  });

  test("setLocale to same locale → no-op", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "ko", "example.com");
    const shouldTranslate = setLocale(state, "ko");
    expect(shouldTranslate).toBe(false);
  });

  test("setLocale with invalid locale → no-op", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(setLocale(state, "")).toBe(false);
    expect(setLocale(state, "a".repeat(36))).toBe(false);
    expect(setLocale(state, "not valid!")).toBe(false);
  });
});

describe("data-lang: sourceLocale getter", () => {
  test("returns data-lang value when set", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(sourceLocale(state)).toBe("ko");
  });

  test("falls back to browser locale when data-lang not set", () => {
    const { script } = makeDoc("<p>Hello</p>");
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(sourceLocale(state)).toBe("en");
  });

  test("falls back to browser locale when data-lang is empty", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "" });
    const state = createState();
    cfg(state, script, "ja", "example.com");
    expect(sourceLocale(state)).toBe("ja");
  });

  test("sourceLocale is independent of current loc (after setLocale)", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "ko" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    setLocale(state, "ja");
    // sourceLocale should still be "ko" (the page's source language)
    expect(sourceLocale(state)).toBe("ko");
    expect(state.loc).toBe("ja");
  });
});

describe("data-lang + data-manual interaction", () => {
  test("data-lang + data-manual → both respected, no auto-translate", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "en", "data-manual": "" });
    const state = createState();
    cfg(state, script, "ko", "example.com");
    expect(state.manual).toBe(true);
    expect(state.slang).toBe("en");
    // manual alone prevents auto-translate
    expect(shouldAutoTranslate(state)).toBe(false);
  });

  test("data-manual without data-lang → no auto-translate, slang empty", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-manual": "" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(state.manual).toBe(true);
    expect(state.slang).toBe("");
    expect(shouldAutoTranslate(state)).toBe(false);
  });

  test("data-lang matching locale + data-manual → no auto-translate (both reasons)", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "en", "data-manual": "" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(state.manual).toBe(true);
    expect(state.slang).toBe("en");
    expect(state.loc).toBe("en");
    expect(shouldAutoTranslate(state)).toBe(false);
  });

  test("data-lang + data-manual + manual setLocale → still works", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "en", "data-manual": "" });
    const state = createState();
    cfg(state, script, "en", "example.com");
    expect(shouldAutoTranslate(state)).toBe(false);
    // Manual setLocale should still accept the new locale
    expect(setLocale(state, "ko")).toBe(true);
    expect(state.loc).toBe("ko");
  });
});

describe("data-lang: edge cases", () => {
  test("data-lang with complex BCP47 tag extracts base correctly", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "zh-Hant-TW" });
    const state = createState();
    cfg(state, script, "zh", "example.com");
    // split("-")[0] gives "zh"
    expect(state.slang).toBe("zh");
    expect(shouldAutoTranslate(state)).toBe(false);
  });

  test("different base languages always trigger auto-translate", () => {
    const { script } = makeDoc("<p>Hello</p>", { "data-lang": "en" });
    const state = createState();
    cfg(state, script, "ja", "example.com");
    expect(state.slang).toBe("en");
    expect(state.loc).toBe("ja");
    expect(shouldAutoTranslate(state)).toBe(true);
  });

  test("cfg() returns false when no script element found", () => {
    const state = createState();
    const result = cfg(state, null, "en", "example.com");
    expect(result).toBe(false);
    expect(state.slang).toBe("");
  });
});
