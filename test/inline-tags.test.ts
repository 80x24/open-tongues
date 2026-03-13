import { describe, test, expect } from "bun:test";
import { parseHTML } from "linkedom";

/**
 * Unit tests for tongues placeholder system.
 * Replicates the core functions from t.ts (which has no exports)
 * to verify mixed-content translation works correctly.
 */

// --- Replicate constants and functions from t.ts ---

const IL = new Set("STRONG,EM,B,I,U,S,CODE,A,SPAN,MARK,SUB,SUP,SMALL,ABBR,CITE,DFN,TIME,Q".split(","));
const VD = new Set("BR,IMG,WBR".split(","));
const SK = new Set("SCRIPT,STYLE,NOSCRIPT,SVG,TEMPLATE,CODE,PRE,KBD,SAMP,VAR,CANVAS,VIDEO,AUDIO,IFRAME,MATH".split(","));
const RX = "x-text,x-html,v-text,v-html,:textContent,:innerHTML".split(",");

type PM = [string, string]; // [open, close]

function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function toPh(el: Element) {
  const m = new Map<number, PM>(); let i = 0;
  function w(n: Node): string {
    if (n.nodeType === 3) return esc(n.nodeValue || "");
    if (n.nodeType !== 1) return "";
    const e = n as Element, tg = e.tagName;
    if (VD.has(tg)) { m.set(i, [e.outerHTML, ""]); return `<${i++}/>`; }
    if (IL.has(tg)) {
      const j = i++, mt = e.outerHTML.match(/^<[^>]+>/);
      m.set(j, [mt ? mt[0] : `<${tg.toLowerCase()}>`, `</${tg.toLowerCase()}>`]);
      let s = ""; for (const c of e.childNodes) s += w(c); return `<${j}>${s}</${j}>`;
    }
    let s = ""; for (const c of e.childNodes) s += w(c); return s;
  }
  let t = ""; for (const c of el.childNodes) t += w(c);
  return { t: t.trim(), m, h: m.size > 0 };
}

function fromPh(t: string, m: Map<number, PM>): string {
  let r = t.replace(/<(\d+)\/>/g, (_, i) => m.get(+i)?.[0] || ""), ok = true;
  while (ok) { ok = false; r = r.replace(/<(\d+)>(.*?)<\/\1>/gs, (_, i, c) => {
    ok = true; const e = m.get(+i); return e ? e[0] + c + e[1] : c; }); }
  r = r.replace(/<\/?(\d+)\s*\/?>/g, "");
  return r;
}

function inlineOnly(el: Element): boolean {
  for (const c of el.children) {
    if (!IL.has(c.tagName) && !VD.has(c.tagName)) return false;
    for (const a of RX) if (c.hasAttribute(a)) return false;
  }
  return true;
}

// --- Helper ---

function createElement(html: string): Element {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return document.body.firstElementChild!;
}

// --- toPh: extract placeholders ---

describe("toPh (htmlToPlaceholder)", () => {
  test("plain text — no inline tags", () => {
    const el = createElement("<p>Hello world</p>");
    const { t, m, h } = toPh(el);
    expect(t).toBe("Hello world");
    expect(h).toBe(false);
    expect(m.size).toBe(0);
  });

  test("single <strong> tag", () => {
    const el = createElement("<p>This is <strong>important</strong> text</p>");
    const { t, m, h } = toPh(el);
    expect(t).toBe("This is <0>important</0> text");
    expect(h).toBe(true);
    expect(m.get(0)![0]).toBe("<strong>");
    expect(m.get(0)![1]).toBe("</strong>");
  });

  test("single <code> tag", () => {
    const el = createElement("<p>Use <code>data-tongues-ignore</code> attribute</p>");
    const { t, m } = toPh(el);
    expect(t).toBe("Use <0>data-tongues-ignore</0> attribute");
    expect(m.get(0)![0]).toBe("<code>");
  });

  test("<a> tag with href preserved", () => {
    const el = createElement('<p>Visit <a href="https://example.com">our site</a> now</p>');
    const { t, m } = toPh(el);
    expect(t).toBe("Visit <0>our site</0> now");
    expect(m.get(0)![0]).toBe('<a href="https://example.com">');
    expect(m.get(0)![1]).toBe("</a>");
  });

  test("multiple sibling inline tags", () => {
    const el = createElement("<p><strong>Bold</strong> and <code>code</code> here</p>");
    const { t, m } = toPh(el);
    expect(t).toBe("<0>Bold</0> and <1>code</1> here");
    expect(m.get(0)![0]).toBe("<strong>");
    expect(m.get(1)![0]).toBe("<code>");
  });

  test("nested inline tags", () => {
    const el = createElement("<p><strong><code>nested</code></strong></p>");
    const { t, m } = toPh(el);
    expect(t).toBe("<0><1>nested</1></0>");
    expect(m.get(0)![0]).toBe("<strong>");
    expect(m.get(1)![0]).toBe("<code>");
  });

  test("<br> void tag", () => {
    const el = createElement("<p>Line one<br>Line two</p>");
    const { t, m } = toPh(el);
    expect(t).toBe("Line one<0/>Line two");
    expect(m.get(0)![1]).toBe(""); // void = no close tag
  });

  test("mixed void and paired tags", () => {
    const el = createElement("<p><strong>Bold</strong><br>Next line</p>");
    const { t, m } = toPh(el);
    expect(t).toBe("<0>Bold</0><1/>Next line");
    expect(m.get(0)![0]).toBe("<strong>");
    expect(m.get(1)![1]).toBe("");
  });

  test("terms page: text + strong mixed content", () => {
    const el = createElement(
      '<p>These Terms govern the <strong>tongues</strong> translation service by <strong>80x24</strong>.</p>'
    );
    const { t, m, h } = toPh(el);
    expect(t).toBe("These Terms govern the <0>tongues</0> translation service by <1>80x24</1>.");
    expect(h).toBe(true);
    expect(m.get(0)![0]).toBe("<strong>");
    expect(m.get(1)![0]).toBe("<strong>");
  });
});

// --- fromPh: restore HTML from placeholders ---

describe("fromPh (placeholderToHtml)", () => {
  test("single inline tag", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]]]);
    expect(fromPh("Click <0>here</0>", m)).toBe("Click <strong>here</strong>");
  });

  test("multiple sibling tags", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]], [1, ["<code>", "</code>"]]]);
    expect(fromPh("<0>Important</0>: use <1>tongues</1>", m))
      .toBe("<strong>Important</strong>: use <code>tongues</code>");
  });

  test("nested tags", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]], [1, ["<code>", "</code>"]]]);
    expect(fromPh("<0><1>text</1></0>", m)).toBe("<strong><code>text</code></strong>");
  });

  test("tag with attributes preserved", () => {
    const m = new Map<number, PM>([[0, ['<a href="https://example.com">', "</a>"]]]);
    expect(fromPh("Visit <0>our site</0>", m)).toBe('Visit <a href="https://example.com">our site</a>');
  });

  test("void tag (br)", () => {
    const m = new Map<number, PM>([[0, ["<br>", ""]]]);
    expect(fromPh("Line one<0/>Line two", m)).toBe("Line one<br>Line two");
  });

  test("LLM drops placeholder — graceful degradation", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]]]);
    expect(fromPh("Click here", m)).toBe("Click here");
  });

  test("translation reorders placeholders", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]], [1, ["<code>", "</code>"]], [2, ['<a href="/docs">', "</a>"]]]);
    expect(fromPh("Install <1>tongues</1> <2>here</2>: <0>important</0>", m))
      .toBe('Install <code>tongues</code> <a href="/docs">here</a>: <strong>important</strong>');
  });

  test("LLM drops closing tag — cleanup removes orphan opener", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]]]);
    expect(fromPh("<0>텍스트", m)).toBe("텍스트");
  });

  test("LLM adds space in tag — cleanup removes malformed tags", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]]]);
    expect(fromPh("<0 >텍스트</0>", m)).toBe("텍스트");
  });

  test("LLM outputs orphan closing tag — cleanup removes it", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]]]);
    expect(fromPh("텍스트</0>", m)).toBe("텍스트");
  });

  test("mixed: some placeholders resolve, others broken", () => {
    const m = new Map<number, PM>([[0, ["<strong>", "</strong>"]], [1, ['<a href="/privacy">', "</a>"]]]);
    expect(fromPh("<0>중요</0> 정보는 <1>여기에서 확인하세요", m))
      .toBe("<strong>중요</strong> 정보는 여기에서 확인하세요");
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

// --- Full roundtrip: toPh → translate → fromPh ---

describe("full roundtrip (toPh → translate → fromPh)", () => {
  test("code tag survives translation", () => {
    const el = createElement("<p>Use <code>data-tongues-ignore</code> attribute</p>");
    const { t, m } = toPh(el);
    const translated = t.replace("Use", "Use the").replace("attribute", "option");
    expect(fromPh(translated, m)).toBe("Use the <code>data-tongues-ignore</code> option");
  });

  test("terms page mixed-content survives translation", () => {
    const el = createElement(
      '<p>These Terms govern the <strong>tongues</strong> service by <strong>80x24</strong>.</p>'
    );
    const { t, m } = toPh(el);
    // Simulated Korean translation
    const translated = "이 약관은 <1>80x24</1>의 <0>tongues</0> 서비스를 규율합니다.";
    const html = fromPh(translated, m);
    expect(html).toBe("이 약관은 <strong>80x24</strong>의 <strong>tongues</strong> 서비스를 규율합니다.");
  });

  test("br tag preserved through translation", () => {
    const el = createElement("<p>첫 번째 줄<br>두 번째 줄</p>");
    const { t, m } = toPh(el);
    const translated = "First line<0/>Second line";
    const html = fromPh(translated, m);
    expect(html).toContain("First line");
    expect(html).toContain("Second line");
    expect(html).toMatch(/<br\s*\/?>/);
  });

  test("original innerHTML can be restored after translation", () => {
    const { document: doc } = parseHTML(
      '<!DOCTYPE html><html><body><p>Use <code>data-tongues-ignore</code> attribute</p></body></html>'
    );
    const el = doc.body.firstElementChild!;
    const originalHtml = el.innerHTML;

    // Collect
    const { t, m } = toPh(el);
    // Apply translation
    const translated = "Use the <0>data-tongues-ignore</0> option";
    el.innerHTML = fromPh(translated, m);
    expect(el.textContent).toBe("Use the data-tongues-ignore option");

    // Restore original
    el.innerHTML = originalHtml;
    expect(el.innerHTML).toBe(originalHtml);
    expect(el.textContent).toBe("Use data-tongues-ignore attribute");
  });
});

// --- Issue #92: toPh escapes literal < and > from decoded entities ---

describe("toPh entity escaping (#92)", () => {
  test("&lt; and &gt; in text nodes become &lt; and &gt; in placeholder text", () => {
    const el = createElement(
      '<p><a href="#" id="next">&lt; newer</a> · <span id="current-date">2026-03-12 (1/18)</span> · <a href="#" id="prev">older &gt;</a></p>'
    );
    const { t } = toPh(el);
    // < and > from decoded entities must be escaped so they don't collide with <0>...</0> tags
    expect(t).toContain("&lt; newer");
    expect(t).toContain("older &gt;");
    expect(t).not.toMatch(/(?<!&[lg]t);\s*newer/); // no raw < before newer
  });
});

// --- Issue #92 full scenario: p with multiple a/span children ---

describe("issue #92 fromPh with escaped entities", () => {
  test("restores all child elements from placeholder map with escaped < and >", () => {
    const m = new Map<number, PM>([
      [0, ['<a href="#" id="next" style="opacity: 0.3;">', "</a>"]],
      [1, ['<span id="current-date">', "</span>"]],
      [2, ['<a href="#" id="prev" style="opacity: 1;">', "</a>"]],
      [3, ['<a href="#" id="today">', "</a>"]],
      [4, ['<a href="#" id="random">', "</a>"]],
    ]);
    const translated = "<0>&lt; 新しい</0> · <1>2026-03-12 (1/18)</1> · <2>古い &gt;</2> · <3>今日</3> · <4>ランダム</4>";
    const html = fromPh(translated, m);
    // Must restore all child elements with attributes
    expect(html).toContain('<a href="#" id="next"');
    expect(html).toContain('<span id="current-date">');
    expect(html).toContain('<a href="#" id="prev"');
    expect(html).toContain('<a href="#" id="today">');
    expect(html).toContain('<a href="#" id="random">');
    // Must unescape &lt; and &gt; back to display correctly in innerHTML
    expect(html).toContain("&lt; 新しい");
    expect(html).toContain("古い &gt;");
  });
});

describe("full roundtrip issue #92 scenario", () => {
  test("p with multiple inline children: toPh → translate → fromPh preserves DOM structure", () => {
    const el = createElement(
      '<p><a href="#" id="next" style="opacity: 0.3;">&lt; newer</a> · <span id="current-date">2026-03-12 (1/18)</span> · <a href="#" id="prev" style="opacity: 1;">older &gt;</a> · <a href="#" id="today">today</a> · <a href="#" id="random">random</a></p>'
    );
    const { t, m } = toPh(el);
    // Simulated translation (Japanese)
    const translated = "<0>&lt; 新しい</0> · <1>2026-03-12 (1/18)</1> · <2>古い &gt;</2> · <3>今日</3> · <4>ランダム</4>";
    const html = fromPh(translated, m);
    // All 5 elements must be present with their attributes
    expect(html).toContain('<a href="#" id="next"');
    expect(html).toContain('<span id="current-date">');
    expect(html).toContain('<a href="#" id="prev"');
    expect(html).toContain('<a href="#" id="today">');
    expect(html).toContain('<a href="#" id="random">');
    // Content must be translated
    expect(html).toContain("新しい");
    expect(html).toContain("古い");
    expect(html).toContain("今日");
    expect(html).toContain("ランダム");
  });
});

// --- Fix #3: phs Map key collision when same text appears in multiple elements ---

describe("phs element-based keying (#92 fix 3)", () => {
  test("two elements with identical text structure get independent placeholder maps", () => {
    // Simulate two <p> elements with the same text but different attributes on children
    const el1 = createElement('<p><a href="/page1" class="link1">Click here</a> for info</p>');
    const el2 = createElement('<p><a href="/page2" class="link2">Click here</a> for info</p>');

    const r1 = toPh(el1);
    const r2 = toPh(el2);

    // Both produce the same placeholder text
    expect(r1.t).toBe(r2.t);
    expect(r1.t).toBe("<0>Click here</0> for info");

    // But the placeholder maps should contain different opening tags
    expect(r1.m.get(0)![0]).toContain('href="/page1"');
    expect(r1.m.get(0)![0]).toContain('class="link1"');
    expect(r2.m.get(0)![0]).toContain('href="/page2"');
    expect(r2.m.get(0)![0]).toContain('class="link2"');

    // With a text-keyed Map, phs.set(t, r2.m) would overwrite r1.m
    // With element-keyed WeakMap, each element keeps its own map
    const phs = new WeakMap<Element, Map<number, PM>>();
    phs.set(el1, r1.m);
    phs.set(el2, r2.m);

    // Both should be independently retrievable
    const pm1 = phs.get(el1)!;
    const pm2 = phs.get(el2)!;
    expect(pm1.get(0)![0]).toContain('href="/page1"');
    expect(pm2.get(0)![0]).toContain('href="/page2"');

    // Translating each should produce different HTML
    const translated = "<0>ここをクリック</0> 情報";
    const html1 = fromPh(translated, pm1);
    const html2 = fromPh(translated, pm2);
    expect(html1).toContain('href="/page1"');
    expect(html1).toContain('class="link1"');
    expect(html2).toContain('href="/page2"');
    expect(html2).toContain('class="link2"');
  });

  test("with old text-keyed Map, second element overwrites first (regression proof)", () => {
    const el1 = createElement('<p><a href="/page1">Click here</a> for info</p>');
    const el2 = createElement('<p><a href="/page2">Click here</a> for info</p>');

    const r1 = toPh(el1);
    const r2 = toPh(el2);

    // Demonstrate the old bug: text-keyed Map causes overwrite
    const oldPhs = new Map<string, Map<number, PM>>();
    oldPhs.set(r1.t, r1.m);
    oldPhs.set(r2.t, r2.m); // overwrites r1.m because r1.t === r2.t

    // Only one entry in the Map — el1's data is lost
    expect(oldPhs.size).toBe(1);
    const pm = oldPhs.get(r1.t)!;
    // pm is r2's map, not r1's
    expect(pm.get(0)![0]).toContain('href="/page2"');
    expect(pm.get(0)![0]).not.toContain('href="/page1"');
  });
});
