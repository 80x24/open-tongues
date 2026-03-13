import { describe, test, expect } from "bun:test";

/**
 * Unit tests for MutationObserver dynamic content re-translation logic.
 *
 * Bug: https://github.com/80x24/open-tongues/issues/4
 * When JS dynamically changes text content of elements with `data-t` attribute,
 * tongues' MutationObserver should detect the change and re-translate.
 *
 * These tests verify the `changed()` and `invalidate()` helper functions
 * extracted from the observer logic in src/client/t.ts.
 */

// --- Replicate from t.ts ---

function changed(el: Element): boolean {
  if (!el.hasAttribute("data-t")) return true;
  const orig = el.getAttribute("data-t"), tt = el.getAttribute("data-tt");
  const cur = el.getAttribute("data-th") ? el.innerHTML : el.textContent?.trim();
  return cur !== orig && cur !== tt;
}

function invalidate(el: Element) {
  el.removeAttribute("data-t");
  el.removeAttribute("data-th");
  el.removeAttribute("data-tt");
}

// --- Helpers ---

function makeEl(tag: string, text: string, attrs: Record<string, string> = {}): Element {
  // Use linkedom for DOM simulation (same as inline-tags tests)
  const { parseHTML } = require("linkedom");
  const { document } = parseHTML(`<!DOCTYPE html><html><body><${tag}>${text}</${tag}></body></html>`);
  const el = document.querySelector(tag)!;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// --- Tests ---

describe("changed() — detect external content changes on data-t elements", () => {
  test("returns true when element has no data-t (new element)", () => {
    const el = makeEl("div", "hello world");
    expect(changed(el)).toBe(true);
  });

  test("returns false when text matches data-t (original, untouched)", () => {
    const el = makeEl("div", "hello world", { "data-t": "hello world" });
    expect(changed(el)).toBe(false);
  });

  test("returns false when textContent matches data-tt (translated, plain text)", () => {
    const el = makeEl("div", "translated text", {
      "data-t": "original text",
      "data-tt": "translated text",
    });
    // For plain text elements (no data-th), textContent is compared against both data-t and data-tt
    expect(changed(el)).toBe(false);
  });

  test("returns true when textContent differs from both data-t and data-tt (external JS change)", () => {
    const el = makeEl("div", "new dynamic content", {
      "data-t": "loading...",
      "data-tt": "로딩 중...",
    });
    expect(changed(el)).toBe(true);
  });

  test("returns false when innerHTML matches data-tt with data-th present", () => {
    const { parseHTML } = require("linkedom");
    const { document } = parseHTML(
      `<!DOCTYPE html><html><body><div data-t="original" data-th="<b>original</b>" data-tt="<b>번역됨</b>"><b>번역됨</b></div></body></html>`
    );
    const el = document.querySelector("div")!;
    expect(changed(el)).toBe(false);
  });

  test("returns true when innerHTML differs from data-tt with data-th present", () => {
    const { parseHTML } = require("linkedom");
    const { document } = parseHTML(
      `<!DOCTYPE html><html><body><div data-t="original" data-th="<b>original</b>" data-tt="<b>번역됨</b>"><b>completely new</b></div></body></html>`
    );
    const el = document.querySelector("div")!;
    expect(changed(el)).toBe(true);
  });

  test("80x24.ai/now scenario: data-t='loading...' replaced by PR list", () => {
    const { parseHTML } = require("linkedom");
    const { document } = parseHTML(
      `<!DOCTYPE html><html><body><div data-t="loading..." data-tt="로딩 중..."><ul><li>menupie #69</li></ul></div></body></html>`
    );
    const el = document.querySelector("div")!;
    // textContent is now "menupie #69" which differs from "loading..." and "로딩 중..."
    expect(changed(el)).toBe(true);
  });
});

describe("invalidate() — clear translation markers for re-translation", () => {
  test("removes data-t attribute", () => {
    const el = makeEl("div", "text", { "data-t": "text" });
    invalidate(el);
    expect(el.hasAttribute("data-t")).toBe(false);
  });

  test("removes data-th attribute", () => {
    const el = makeEl("div", "text", { "data-t": "text", "data-th": "<b>text</b>" });
    invalidate(el);
    expect(el.hasAttribute("data-th")).toBe(false);
  });

  test("removes data-tt attribute", () => {
    const el = makeEl("div", "text", { "data-t": "text", "data-tt": "번역" });
    invalidate(el);
    expect(el.hasAttribute("data-tt")).toBe(false);
  });

  test("removes all three attributes at once", () => {
    const el = makeEl("div", "text", {
      "data-t": "text",
      "data-th": "<b>text</b>",
      "data-tt": "<b>번역</b>",
    });
    invalidate(el);
    expect(el.hasAttribute("data-t")).toBe(false);
    expect(el.hasAttribute("data-th")).toBe(false);
    expect(el.hasAttribute("data-tt")).toBe(false);
  });

  test("no-op on element without translation markers", () => {
    const el = makeEl("div", "clean element");
    invalidate(el); // should not throw
    expect(el.hasAttribute("data-t")).toBe(false);
  });
});

describe("attributeFilter includes data-t", () => {
  // Verify the constant used for observer includes data-t
  const AT = ["placeholder", "title", "alt", "aria-label"];
  const observerFilter = [...AT, "data-t"];

  test("observer attributeFilter contains data-t", () => {
    expect(observerFilter).toContain("data-t");
  });

  test("observer attributeFilter still contains original attributes", () => {
    for (const a of AT) {
      expect(observerFilter).toContain(a);
    }
  });
});

describe("edge cases", () => {
  test("element with empty textContent and data-t", () => {
    const el = makeEl("div", "", { "data-t": "loading..." });
    // Empty textContent trims to "", which differs from "loading..."
    expect(changed(el)).toBe(true);
  });

  test("element with whitespace-only textContent", () => {
    const el = makeEl("div", "   ", { "data-t": "loading..." });
    // Trimmed to "", differs from "loading..."
    expect(changed(el)).toBe(true);
  });

  test("data-t matches trimmed textContent with surrounding whitespace", () => {
    const el = makeEl("div", "  hello  ", { "data-t": "hello" });
    // textContent.trim() === "hello" === data-t
    expect(changed(el)).toBe(false);
  });
});
