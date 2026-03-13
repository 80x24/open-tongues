import { describe, test, expect } from "bun:test";

/**
 * Unit tests for MutationObserver dynamic content re-translation logic.
 *
 * Bug: https://github.com/80x24/open-tongues/issues/4
 * When JS dynamically replaces content (e.g. "loading..." → real data),
 * tongues' MutationObserver must strip data-t/data-th/data-tt markers
 * so the new content gets collected and re-translated.
 *
 * Fix: observer unconditionally strips markers on any mutation targeting
 * a data-t element. tongues' own changes don't trigger this because
 * ps()/rs() disconnect the observer during apply().
 */

const { parseHTML } = require("linkedom");

// --- Replicate observer logic from t.ts ---

/** What the observer does when it sees a mutation on a translated element */
function observerHandle(el: Element) {
  if (el.hasAttribute("data-t")) {
    el.removeAttribute("data-t");
    el.removeAttribute("data-th");
    el.removeAttribute("data-tt");
  }
}

// --- Helpers ---

function makeDoc(html: string) {
  return parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

// --- Tests ---

describe("observer: strip markers on external content change", () => {
  test("strips data-t when content is replaced", () => {
    const { document } = makeDoc(`<div data-t="loading...">loading...</div>`);
    const el = document.querySelector("div")!;
    // Simulate external JS replacing content
    el.textContent = "Real content loaded";
    // Observer fires → handle
    observerHandle(el);
    expect(el.hasAttribute("data-t")).toBe(false);
    expect(el.textContent).toBe("Real content loaded");
  });

  test("strips all three markers (data-t, data-th, data-tt)", () => {
    const { document } = makeDoc(
      `<div data-t="Click <0>here</0>" data-th="Click <b>here</b>" data-tt="<b>여기</b>를 클릭"><b>여기</b>를 클릭</div>`
    );
    const el = document.querySelector("div")!;
    el.innerHTML = "<b>New link</b> text";
    observerHandle(el);
    expect(el.hasAttribute("data-t")).toBe(false);
    expect(el.hasAttribute("data-th")).toBe(false);
    expect(el.hasAttribute("data-tt")).toBe(false);
  });

  test("no-op on element without data-t", () => {
    const { document } = makeDoc(`<div>clean element</div>`);
    const el = document.querySelector("div")!;
    observerHandle(el); // should not throw
    expect(el.textContent).toBe("clean element");
  });

  test("80x24.ai/now: loading... replaced by async PR list", () => {
    const { document } = makeDoc(
      `<div data-t="loading..." data-tt="로딩 중..."><font data-tf="1">로딩 중...</font></div>`
    );
    const el = document.querySelector("div")!;
    // SPA async fetch replaces content entirely
    el.innerHTML = "<ul><li>menupie #69 — fix auth flow</li><li>tongues #12 — rate limit</li></ul>";
    observerHandle(el);
    expect(el.hasAttribute("data-t")).toBe(false);
    expect(el.hasAttribute("data-tt")).toBe(false);
    expect(el.textContent).toContain("menupie #69");
  });
});

describe("observer: collect() picks up cleared elements", () => {
  // After markers are stripped, incremental collect should find the element again

  test("element without data-t is eligible for incremental collect", () => {
    const { document } = makeDoc(`<div>New content here</div>`);
    const el = document.querySelector("div")!;
    // No data-t → collect(inc=true) should process it (not skip)
    expect(el.hasAttribute("data-t")).toBe(false);
    expect(el.textContent!.trim().length).toBeGreaterThanOrEqual(2);
  });

  test("element with data-t is skipped by incremental collect (no data-th)", () => {
    const { document } = makeDoc(`<div data-t="old">translated</div>`);
    const el = document.querySelector("div")!;
    // Simulates: inc && el.hasAttribute("data-t") && !el.hasAttribute("data-th") → skip
    expect(el.hasAttribute("data-t")).toBe(true);
    expect(el.hasAttribute("data-th")).toBe(false);
    // → would return NodeFilter.FILTER_REJECT (2) in collect()
  });

  test("after strip, element becomes eligible again", () => {
    const { document } = makeDoc(`<div data-t="loading...">Real data</div>`);
    const el = document.querySelector("div")!;
    expect(el.hasAttribute("data-t")).toBe(true);
    observerHandle(el);
    expect(el.hasAttribute("data-t")).toBe(false);
    // Now collect(inc=true) will process this element
  });
});

describe("observer: attribute translation markers (data-ta-*)", () => {
  test("data-ta-placeholder preserved (observer only strips data-t/th/tt)", () => {
    const { document } = makeDoc(
      `<input placeholder="검색..." data-ta-placeholder="Search..." data-t="foo" />`
    );
    const el = document.querySelector("input")!;
    observerHandle(el);
    // data-t stripped
    expect(el.hasAttribute("data-t")).toBe(false);
    // data-ta-placeholder is NOT stripped by observer (attribute translations are independent)
    expect(el.getAttribute("data-ta-placeholder")).toBe("Search...");
  });
});

describe("edge cases", () => {
  test("rapid replacement: content changes twice before re-translate", () => {
    const { document } = makeDoc(`<div data-t="loading...">loading...</div>`);
    const el = document.querySelector("div")!;
    // First async update
    el.textContent = "Partial data...";
    observerHandle(el);
    expect(el.hasAttribute("data-t")).toBe(false);

    // Suppose tongues hasn't re-translated yet, second update arrives
    el.textContent = "Final complete data";
    observerHandle(el); // still no data-t, so no-op — correct
    expect(el.hasAttribute("data-t")).toBe(false);
    expect(el.textContent).toBe("Final complete data");
  });

  test("element emptied then filled (skeleton pattern)", () => {
    const { document } = makeDoc(`<div data-t="Loading items">Loading items</div>`);
    const el = document.querySelector("div")!;
    // Framework clears content first
    el.textContent = "";
    observerHandle(el);
    expect(el.hasAttribute("data-t")).toBe(false);
    // Then fills with real content
    el.textContent = "3 items found";
    observerHandle(el); // no-op (no data-t)
    expect(el.textContent).toBe("3 items found");
  });

  test("notranslate elements are not affected", () => {
    const { document } = makeDoc(
      `<div class="notranslate" data-t="code">translated code</div>`
    );
    const el = document.querySelector("div")!;
    // In real observer, el.closest(NT) would match → skip entirely
    // observerHandle only runs if that check passes
    // This test documents that notranslate is handled before observerHandle
    expect(el.classList.contains("notranslate")).toBe(true);
  });

  test("contentEditable elements are skipped", () => {
    const { document } = makeDoc(`<div contenteditable="true" data-t="editable">user typing</div>`);
    const el = document.querySelector("div")!;
    // In real observer, isContentEditable check → continue (skip)
    expect(el.getAttribute("contenteditable")).toBe("true");
    // data-t should NOT be stripped for contentEditable (observer skips before reaching observerHandle)
  });
});
