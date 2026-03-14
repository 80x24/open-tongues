import { describe, test, expect } from "bun:test";

/**
 * Unit tests for phantom HTML tag stripping.
 * Replicates stripPhantomHtml() from translator.ts:
 * if original has no `<`, strip any HTML the LLM hallucinated.
 */

function stripPhantomHtml(original: string, translated: string): string {
  if (original.includes("<")) return translated;
  return translated.replace(/<[^>]+>/g, "");
}

describe("stripPhantomHtml", () => {
  describe("plain text originals (no <) — phantom HTML MUST be stripped", () => {
    test("strips wrapping <strong>...</strong> phantom tag", () => {
      const original = 'Read-only. Current translation locale (e.g. "en", "ja").';
      const translated = '<strong>읽기 전용입니다.</strong> 현재 번역 언어입니다 (예: "en", "ja").';
      expect(stripPhantomHtml(original, translated))
        .toBe('읽기 전용입니다. 현재 번역 언어입니다 (예: "en", "ja").');
    });

    test("strips phantom <em> around full sentence", () => {
      const original = "Switch to a specific language. Returns a Promise.";
      const translated = "<em>특정 언어로 전환합니다. Promise를 반환합니다.</em>";
      expect(stripPhantomHtml(original, translated))
        .toBe("특정 언어로 전환합니다. Promise를 반환합니다.");
    });

    test("strips multiple phantom tags in same translation", () => {
      const original = "Revert to original text.";
      const translated = "<strong>원본 텍스트로</strong> <em>되돌립니다.</em>";
      expect(stripPhantomHtml(original, translated))
        .toBe("원본 텍스트로 되돌립니다.");
    });

    test("strips phantom <br> tag", () => {
      const original = "Hello world";
      const translated = "안녕하세요<br> 세계";
      expect(stripPhantomHtml(original, translated))
        .toBe("안녕하세요 세계");
    });

    test("strips phantom <a> with attributes", () => {
      const original = "Click here for help";
      const translated = '<a href="/help">도움말은 여기를 클릭하세요</a>';
      expect(stripPhantomHtml(original, translated))
        .toBe("도움말은 여기를 클릭하세요");
    });

    test("handles translation with no phantom tags (no-op)", () => {
      const original = "Hello world";
      const translated = "안녕하세요 세계";
      expect(stripPhantomHtml(original, translated))
        .toBe("안녕하세요 세계");
    });

    test("handles empty translation", () => {
      const original = "Hello";
      const translated = "";
      expect(stripPhantomHtml(original, translated)).toBe("");
    });
  });

  describe("text with real HTML tags — MUST preserve them", () => {
    test("preserves <strong> when original has it", () => {
      const original = "This is <strong>important</strong> text";
      const translated = "これは<strong>重要な</strong>テキストです";
      expect(stripPhantomHtml(original, translated))
        .toBe("これは<strong>重要な</strong>テキストです");
    });

    test("preserves <a> with href when original has it", () => {
      const original = 'Visit <a href="/docs">docs</a> page';
      const translated = '<a href="/docs">ドキュメント</a>ページを見る';
      expect(stripPhantomHtml(original, translated))
        .toBe('<a href="/docs">ドキュメント</a>ページを見る');
    });

    test("preserves <br> when original has it", () => {
      const original = "Line one<br>Line two";
      const translated = "1行目<br>2行目";
      expect(stripPhantomHtml(original, translated))
        .toBe("1行目<br>2行目");
    });

    test("preserves multiple tags when original has HTML", () => {
      const original = "<strong>Bold</strong> and <code>code</code> here";
      const translated = "<strong>太字</strong> と <code>コード</code> ここ";
      expect(stripPhantomHtml(original, translated))
        .toBe("<strong>太字</strong> と <code>コード</code> ここ");
    });
  });

  describe("edge cases", () => {
    test("text with angle brackets that look like HTML but aren't tags", () => {
      const original = "Use array[0] for the first element";
      const translated = "최초 요소에 array[0] 사용";
      expect(stripPhantomHtml(original, translated))
        .toBe("최초 요소에 array[0] 사용");
    });

    test("other locales: Japanese with phantom tags", () => {
      const original = "Read-only. Current translation locale.";
      const translated = "<strong>読み取り専用。現在の翻訳ロケール。</strong>";
      expect(stripPhantomHtml(original, translated))
        .toBe("読み取り専用。現在の翻訳ロケール。");
    });

    test("other locales: Chinese with phantom tags", () => {
      const original = "Switch to a specific language.";
      const translated = "<em>切换到指定语言。</em>";
      expect(stripPhantomHtml(original, translated))
        .toBe("切换到指定语言。");
    });

    test("self-closing tags stripped from plain text", () => {
      const original = "Plain text";
      const translated = "일반 텍스트<br/>";
      expect(stripPhantomHtml(original, translated))
        .toBe("일반 텍스트");
    });
  });
});
