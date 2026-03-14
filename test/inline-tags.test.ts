import { describe, test, expect } from "bun:test";
import { parseHTML } from "linkedom";

/**
 * Unit tests for tongues inline HTML approach (Approach C).
 * Mixed-content elements send innerHTML directly to the LLM.
 * No placeholder numbering — HTML tags are preserved as-is.
 */

const IL = new Set("STRONG,EM,B,I,U,S,CODE,A,SPAN,MARK,SUB,SUP,SMALL,ABBR,CITE,DFN,TIME,Q".split(","));
const VD = new Set("BR,IMG,WBR".split(","));
const RX = "x-text,x-html,v-text,v-html,:textContent,:innerHTML".split(",");

function inlineOnly(el: Element): boolean {
  for (const c of el.children) {
    if (!IL.has(c.tagName) && !VD.has(c.tagName)) return false;
    for (const a of RX) if (c.hasAttribute(a)) return false;
  }
  return true;
}

function createElement(html: string): Element {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return document.body.firstElementChild!;
}

function makeDoc(html: string) {
  return parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

// --- collect: innerHTML extraction for mixed-content ---

describe("collect: innerHTML for mixed-content", () => {
  test("plain text — uses textContent", () => {
    const el = createElement("<p>Hello world</p>");
    expect(el.children.length).toBe(0);
    expect(el.textContent!.trim()).toBe("Hello world");
  });

  test("single <strong> — uses innerHTML", () => {
    const el = createElement("<p>This is <strong>important</strong> text</p>");
    expect(el.children.length).toBeGreaterThan(0);
    expect(inlineOnly(el)).toBe(true);
    expect(el.innerHTML.trim()).toBe("This is <strong>important</strong> text");
  });

  test("<a> with href — innerHTML preserves attributes", () => {
    const el = createElement('<p>Visit <a href="https://example.com">our site</a> now</p>');
    expect(inlineOnly(el)).toBe(true);
    const html = el.innerHTML.trim();
    expect(html).toContain('<a href="https://example.com">');
    expect(html).toContain("our site</a>");
  });

  test("multiple inline tags — all preserved in innerHTML", () => {
    const el = createElement("<p><strong>Bold</strong> and <code>code</code> here</p>");
    expect(inlineOnly(el)).toBe(true);
    const html = el.innerHTML.trim();
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  test("nested inline tags", () => {
    const el = createElement("<p><strong><code>nested</code></strong></p>");
    expect(inlineOnly(el)).toBe(true);
    expect(el.innerHTML.trim()).toBe("<strong><code>nested</code></strong>");
  });

  test("<br> void tag in innerHTML", () => {
    const el = createElement("<p>Line one<br>Line two</p>");
    expect(inlineOnly(el)).toBe(true);
    const html = el.innerHTML.trim();
    expect(html).toMatch(/Line one<br\s*\/?>Line two/);
  });

  test("mixed void and paired tags", () => {
    const el = createElement("<p><strong>Bold</strong><br>Next line</p>");
    expect(inlineOnly(el)).toBe(true);
    const html = el.innerHTML.trim();
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toMatch(/<br\s*\/?>/);
  });

  test("terms page: text + strong mixed content", () => {
    const el = createElement(
      '<p>These Terms govern the <strong>tongues</strong> translation service by <strong>80x24</strong>.</p>'
    );
    expect(inlineOnly(el)).toBe(true);
    const html = el.innerHTML.trim();
    expect(html).toContain("<strong>tongues</strong>");
    expect(html).toContain("<strong>80x24</strong>");
  });
});

// --- apply: innerHTML set for mixed-content ---

describe("apply: innerHTML for translated mixed-content", () => {
  test("translated HTML applied via innerHTML", () => {
    const { document } = makeDoc('<p>Visit <a href="/foo">our site</a></p>');
    const el = document.querySelector("p")!;
    const originalHtml = el.innerHTML;

    // Simulate: collect → send innerHTML → receive translated innerHTML
    el.setAttribute("data-t", el.innerHTML.trim());
    el.setAttribute("data-th", originalHtml);
    const translated = 'サイトを<a href="/foo">訪問</a>';
    el.innerHTML = translated;
    el.setAttribute("data-tt", translated);

    expect(el.innerHTML).toBe(translated);
    expect(el.querySelector("a")!.getAttribute("href")).toBe("/foo");
  });

  test("plain text applied via font wrapper", () => {
    const { document } = makeDoc("<p>Hello world</p>");
    const el = document.querySelector("p")!;
    el.setAttribute("data-t", "Hello world");
    // No data-th → textContent path
    const f = document.createElement("font");
    f.setAttribute("data-tf", "1");
    f.textContent = "안녕하세요 세계";
    el.replaceChildren(f);

    expect(el.textContent).toBe("안녕하세요 세계");
  });
});

// --- undo: restore original ---

describe("undo: restore original innerHTML/textContent", () => {
  test("mixed-content restore via data-th", () => {
    const { document } = makeDoc('<p>Visit <a href="/foo">our site</a></p>');
    const el = document.querySelector("p")!;
    const originalHtml = el.innerHTML;

    // Apply translation
    el.setAttribute("data-t", el.innerHTML.trim());
    el.setAttribute("data-th", originalHtml);
    el.innerHTML = '<a href="/foo">サイト</a>を訪問';
    el.setAttribute("data-tt", el.innerHTML);

    // Undo
    el.innerHTML = el.getAttribute("data-th")!;
    el.removeAttribute("data-th");
    el.removeAttribute("data-tt");
    el.removeAttribute("data-t");

    expect(el.innerHTML).toBe(originalHtml);
  });

  test("plain text restore via data-t", () => {
    const { document } = makeDoc("<p>Hello world</p>");
    const el = document.querySelector("p")!;
    el.setAttribute("data-t", "Hello world");
    el.textContent = "안녕하세요 세계";

    // Undo
    el.textContent = el.getAttribute("data-t");
    el.removeAttribute("data-t");

    expect(el.textContent).toBe("Hello world");
  });
});

// --- o === t: data-th saved even when translation matches original ---

describe("o === t: data-th saved for mixed-content", () => {
  test("data-th set when o === t and element has children", () => {
    const { document } = makeDoc('<p>Click <a href="/help">here</a></p>');
    const el = document.querySelector("p")!;
    const originalHtml = el.innerHTML;

    // Simulate o === t path with children
    if (!el.hasAttribute("data-t")) {
      el.setAttribute("data-t", el.innerHTML.trim());
      if (el.children.length > 0) el.setAttribute("data-th", el.innerHTML);
    }

    expect(el.hasAttribute("data-t")).toBe(true);
    expect(el.hasAttribute("data-th")).toBe(true);
    expect(el.getAttribute("data-th")).toBe(originalHtml);
  });

  test("data-th NOT set when o === t and element has no children", () => {
    const { document } = makeDoc("<p>plain text</p>");
    const el = document.querySelector("p")!;

    if (!el.hasAttribute("data-t")) {
      el.setAttribute("data-t", "plain text");
      if (el.children.length > 0) el.setAttribute("data-th", el.innerHTML);
    }

    expect(el.hasAttribute("data-t")).toBe(true);
    expect(el.hasAttribute("data-th")).toBe(false);
  });
});

// --- inlineOnly check ---

describe("inlineOnly", () => {
  test("returns true for element with only inline children", () => {
    const el = createElement("<p>text <strong>bold</strong> <code>code</code></p>");
    expect(inlineOnly(el)).toBe(true);
  });

  test("returns false for element with block children", () => {
    const el = createElement("<div><p>paragraph</p></div>");
    expect(inlineOnly(el)).toBe(false);
  });

  test("returns true for element with no children", () => {
    const el = createElement("<p>plain text</p>");
    expect(inlineOnly(el)).toBe(true);
  });

  test("returns false for mixed block and inline children", () => {
    const el = createElement("<div><strong>bold</strong><div>block</div></div>");
    expect(inlineOnly(el)).toBe(false);
  });

  test("returns true for void inline tags", () => {
    const el = createElement("<p>text<br>more</p>");
    expect(inlineOnly(el)).toBe(true);
  });

  test("returns false for element with x-text binding", () => {
    const el = createElement('<div><span x-text="val">text</span></div>');
    expect(inlineOnly(el)).toBe(false);
  });

  test("returns false for element with v-text binding", () => {
    const el = createElement('<div><span v-text="val">text</span></div>');
    expect(inlineOnly(el)).toBe(false);
  });
});

// --- Full roundtrip: collect innerHTML → translate → apply innerHTML ---

describe("full roundtrip (innerHTML → translate → apply)", () => {
  test("strong tag preserved through translation", () => {
    const { document } = makeDoc("<p>This is <strong>important</strong> text</p>");
    const el = document.querySelector("p")!;
    const originalHtml = el.innerHTML;

    // Collect
    const collected = el.innerHTML.trim();
    expect(collected).toContain("<strong>important</strong>");

    // Apply translated
    el.setAttribute("data-t", collected);
    el.setAttribute("data-th", originalHtml);
    el.innerHTML = "これは<strong>重要な</strong>テキストです";

    expect(el.textContent).toBe("これは重要なテキストです");
    expect(el.querySelector("strong")!.textContent).toBe("重要な");

    // Restore
    el.innerHTML = el.getAttribute("data-th")!;
    expect(el.innerHTML).toBe(originalHtml);
  });

  test("a tag with href preserved through translation", () => {
    const { document } = makeDoc('<p>Visit <a href="https://example.com">our site</a> now</p>');
    const el = document.querySelector("p")!;
    const originalHtml = el.innerHTML;

    el.setAttribute("data-t", el.innerHTML.trim());
    el.setAttribute("data-th", originalHtml);
    el.innerHTML = '今すぐ<a href="https://example.com">サイト</a>を訪問';

    expect(el.querySelector("a")!.getAttribute("href")).toBe("https://example.com");
    expect(el.querySelector("a")!.textContent).toBe("サイト");
  });

  test("br tag preserved through translation", () => {
    const { document } = makeDoc("<p>First line<br>Second line</p>");
    const el = document.querySelector("p")!;
    el.setAttribute("data-t", el.innerHTML.trim());
    el.setAttribute("data-th", el.innerHTML);
    el.innerHTML = "1行目<br>2行目";

    expect(el.innerHTML).toMatch(/<br\s*\/?>/);
    expect(el.textContent).toContain("1行目");
    expect(el.textContent).toContain("2行目");
  });

  test("multiple inline children with different attributes", () => {
    const { document } = makeDoc(
      '<p><a href="/page1" class="link1">Click here</a> for <strong>info</strong></p>'
    );
    const el = document.querySelector("p")!;
    const originalHtml = el.innerHTML;
    const collected = el.innerHTML.trim();

    expect(collected).toContain('href="/page1"');
    expect(collected).toContain('class="link1"');
    expect(collected).toContain("<strong>info</strong>");

    el.setAttribute("data-t", collected);
    el.setAttribute("data-th", originalHtml);
    el.innerHTML = '<a href="/page1" class="link1">ここをクリック</a>して<strong>情報</strong>を見る';

    expect(el.querySelector("a")!.getAttribute("href")).toBe("/page1");
    expect(el.querySelector("strong")!.textContent).toBe("情報");
  });

  test("issue #92 scenario: p with multiple a/span children", () => {
    const { document } = makeDoc(
      '<p><a href="#" id="next">&lt; newer</a> · <span id="current-date">2026-03-12</span> · <a href="#" id="prev">older &gt;</a></p>'
    );
    const el = document.querySelector("p")!;
    const originalHtml = el.innerHTML;
    const collected = el.innerHTML.trim();

    expect(collected).toContain('id="next"');
    expect(collected).toContain('id="current-date"');
    expect(collected).toContain('id="prev"');

    el.setAttribute("data-t", collected);
    el.setAttribute("data-th", originalHtml);
    el.innerHTML = '<a href="#" id="next">&lt; 新しい</a> · <span id="current-date">2026-03-12</span> · <a href="#" id="prev">古い &gt;</a>';

    expect(el.querySelector("#next")!.textContent).toBe("< 新しい");
    expect(el.querySelector("#prev")!.textContent).toBe("古い >");

    // Restore
    el.innerHTML = el.getAttribute("data-th")!;
    expect(el.innerHTML).toBe(originalHtml);
  });
});

// --- Two elements with same text but different attributes ---

describe("independent elements with same text structure", () => {
  test("each element sends its own innerHTML with unique attributes", () => {
    const el1 = createElement('<p><a href="/page1" class="link1">Click here</a> for info</p>');
    const el2 = createElement('<p><a href="/page2" class="link2">Click here</a> for info</p>');

    const html1 = el1.innerHTML.trim();
    const html2 = el2.innerHTML.trim();

    // innerHTML is different because attributes differ
    expect(html1).toContain('href="/page1"');
    expect(html2).toContain('href="/page2"');
    expect(html1).not.toBe(html2);
  });
});
