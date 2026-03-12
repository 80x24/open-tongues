import { describe, test, expect } from "bun:test";

/**
 * Unit tests for phantom placeholder tag stripping.
 * Replicates stripPhantomTags() from translator.ts to verify
 * that LLM-hallucinated tags are removed from translations
 * when the original text had no placeholder tags.
 *
 * Bug: https://github.com/80x24/tongues/issues/75
 * When docs page is in Korean, Claude sometimes adds <0>...</0> tags
 * to translations of plain text (no inline HTML), causing literal
 * "<0>...</0>" to appear in the UI.
 */

// --- Replicate from translator.ts ---

const PH_TAG_RE = /<\/?(\d+)\s*\/?>/;

function stripPhantomTags(original: string, translated: string): string {
  if (PH_TAG_RE.test(original)) return translated;
  return translated.replace(/<\/?(\d+)\s*\/?>/g, "");
}

// --- Tests ---

describe("stripPhantomTags", () => {
  describe("plain text originals (no tags) — phantom tags MUST be stripped", () => {
    test("strips wrapping <0>...</0> phantom tag (exact bug from #75)", () => {
      const original = 'Read-only. Current translation locale (e.g. "en", "ja").';
      const translated = '<0>읽기 전용입니다. 현재 번역 언어입니다 (예: "en", "ja").</0>';
      expect(stripPhantomTags(original, translated))
        .toBe('읽기 전용입니다. 현재 번역 언어입니다 (예: "en", "ja").');
    });

    test("strips phantom <0>...</0> around full sentence", () => {
      const original = "Switch to a specific language. Returns a Promise.";
      const translated = "<0>특정 언어로 전환합니다. Promise를 반환합니다.</0>";
      expect(stripPhantomTags(original, translated))
        .toBe("특정 언어로 전환합니다. Promise를 반환합니다.");
    });

    test("strips multiple phantom tags in same translation", () => {
      const original = "Revert to original text.";
      const translated = "<0>원본 텍스트로</0> <1>되돌립니다.</1>";
      expect(stripPhantomTags(original, translated))
        .toBe("원본 텍스트로 되돌립니다.");
    });

    test("strips phantom self-closing tag <0/>", () => {
      const original = "Hello world";
      const translated = "안녕하세요<0/> 세계";
      expect(stripPhantomTags(original, translated))
        .toBe("안녕하세요 세계");
    });

    test("strips orphaned opening tag", () => {
      const original = "Simple text";
      const translated = "<0>간단한 텍스트";
      expect(stripPhantomTags(original, translated))
        .toBe("간단한 텍스트");
    });

    test("strips orphaned closing tag", () => {
      const original = "Simple text";
      const translated = "간단한 텍스트</0>";
      expect(stripPhantomTags(original, translated))
        .toBe("간단한 텍스트");
    });

    test("handles translation with no phantom tags (no-op)", () => {
      const original = "Hello world";
      const translated = "안녕하세요 세계";
      expect(stripPhantomTags(original, translated))
        .toBe("안녕하세요 세계");
    });

    test("handles empty translation", () => {
      const original = "Hello";
      const translated = "";
      expect(stripPhantomTags(original, translated)).toBe("");
    });

    test("strips higher-numbered phantom tags", () => {
      const original = "Client script version";
      const translated = "<5>클라이언트 스크립트 버전</5>";
      expect(stripPhantomTags(original, translated))
        .toBe("클라이언트 스크립트 버전");
    });

    test("strips phantom tags with spaces (malformed)", () => {
      const original = "Some text";
      const translated = "<0 >텍스트</0 >";
      // The regex handles optional whitespace before closing >
      expect(stripPhantomTags(original, translated))
        .toBe("텍스트");
    });
  });

  describe("text with real tags — MUST preserve them", () => {
    test("preserves <0>...</0> when original has it", () => {
      const original = "<0>Email address:</0> Provided during registration.";
      const translated = "<0>メールアドレス：</0> 登録時に提供されます。";
      expect(stripPhantomTags(original, translated))
        .toBe("<0>メールアドレス：</0> 登録時に提供されます。");
    });

    test("preserves multiple tags when original has them", () => {
      const original = "<0>Bold</0> and <1>code</1> here";
      const translated = "<0>太字</0> と <1>コード</1> ここ";
      expect(stripPhantomTags(original, translated))
        .toBe("<0>太字</0> と <1>コード</1> ここ");
    });

    test("preserves self-closing tag when original has it", () => {
      const original = "Line one<0/>Line two";
      const translated = "1行目<0/>2行目";
      expect(stripPhantomTags(original, translated))
        .toBe("1行目<0/>2行目");
    });

    test("preserves tags even when LLM reorders them", () => {
      const original = "<0>First</0> then <1>second</1>";
      const translated = "<1>두 번째</1> 그리고 <0>첫 번째</0>";
      expect(stripPhantomTags(original, translated))
        .toBe("<1>두 번째</1> 그리고 <0>첫 번째</0>");
    });
  });

  describe("edge cases", () => {
    test("text with angle brackets that are NOT placeholder tags", () => {
      const original = "Use array[0] for the first element";
      const translated = "최초 요소에 array[0] 사용";
      expect(stripPhantomTags(original, translated))
        .toBe("최초 요소에 array[0] 사용");
    });

    test("text with code examples mentioning tags", () => {
      // This text has NO actual placeholder tags (no <0>, </0> etc.)
      const original = 'Use translate="no" to exclude elements';
      const translated = '<0>요소를 제외하려면 translate="no"를 사용하세요</0>';
      expect(stripPhantomTags(original, translated))
        .toBe('요소를 제외하려면 translate="no"를 사용하세요');
    });

    test("other locales: Japanese with phantom tags", () => {
      const original = "Read-only. Current translation locale.";
      const translated = "<0>読み取り専用。現在の翻訳ロケール。</0>";
      expect(stripPhantomTags(original, translated))
        .toBe("読み取り専用。現在の翻訳ロケール。");
    });

    test("other locales: Chinese with phantom tags", () => {
      const original = "Switch to a specific language.";
      const translated = "<0>切换到指定语言。</0>";
      expect(stripPhantomTags(original, translated))
        .toBe("切换到指定语言。");
    });

    test("other locales: Spanish with phantom tags", () => {
      const original = "Read-only. Current translation locale.";
      const translated = "<0>Solo lectura. Configuración regional de traducción actual.</0>";
      expect(stripPhantomTags(original, translated))
        .toBe("Solo lectura. Configuración regional de traducción actual.");
    });

    test("double-digit phantom tags", () => {
      const original = "Plain text without tags";
      const translated = "<10>태그 없는 일반 텍스트</10>";
      expect(stripPhantomTags(original, translated))
        .toBe("태그 없는 일반 텍스트");
    });
  });
});
