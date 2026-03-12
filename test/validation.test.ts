import { describe, test, expect, beforeAll } from "bun:test";
import { unlinkSync } from "node:fs";

process.env.DB_PATH = "/tmp/tongues-test-validation.db";
process.env.NODE_ENV = "test";

import { langCodeSchema, translateBodySchema, validateLangCode } from "../src/lib/validation";
import { initDB } from "../src/lib/db";
import { app } from "../src/server/index";

beforeAll(() => {
  try { unlinkSync("/tmp/tongues-test-validation.db"); } catch {}
  initDB();
});

describe("langCodeSchema", () => {
  test("accepts valid 2-letter codes", () => {
    expect(langCodeSchema.parse("ko")).toBe("ko");
    expect(langCodeSchema.parse("en")).toBe("en");
    expect(langCodeSchema.parse("ja")).toBe("ja");
    expect(langCodeSchema.parse("zh")).toBe("zh");
  });

  test("accepts 3-letter codes (tok, etc.)", () => {
    expect(langCodeSchema.parse("tok")).toBe("tok");
    expect(langCodeSchema.parse("yue")).toBe("yue");
  });

  test("accepts subtag formats (BCP 47)", () => {
    expect(langCodeSchema.parse("zh-Hans")).toBe("zh-Hans");
    expect(langCodeSchema.parse("zh-Hant")).toBe("zh-Hant");
    expect(langCodeSchema.parse("pt-BR")).toBe("pt-BR");
    expect(langCodeSchema.parse("zh-Hant-TW")).toBe("zh-Hant-TW");
  });

  test("rejects single character", () => {
    expect(langCodeSchema.safeParse("a").success).toBe(false);
  });

  test("rejects strings longer than 35 chars", () => {
    expect(langCodeSchema.safeParse("a".repeat(36)).success).toBe(false);
  });

  test("rejects non-alpha primary subtag", () => {
    expect(langCodeSchema.safeParse("123").success).toBe(false);
    expect(langCodeSchema.safeParse("k1").success).toBe(false);
  });

  test("rejects special characters", () => {
    expect(langCodeSchema.safeParse("ko;DROP TABLE").success).toBe(false);
    expect(langCodeSchema.safeParse("en<script>").success).toBe(false);
    expect(langCodeSchema.safeParse("../../../etc").success).toBe(false);
    expect(langCodeSchema.safeParse("ko ko").success).toBe(false);
  });

  test("rejects empty string", () => {
    expect(langCodeSchema.safeParse("").success).toBe(false);
  });
});

describe("translateBodySchema", () => {
  test("accepts valid translate request", () => {
    const result = translateBodySchema.safeParse({
      texts: ["hello", "world"],
      to: "ko",
      domain: "example.com",
    });
    expect(result.success).toBe(true);
  });

  test("accepts optional from field", () => {
    const result = translateBodySchema.safeParse({
      texts: ["hello"],
      to: "ko",
      domain: "example.com",
      from: "en",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid to language code", () => {
    const result = translateBodySchema.safeParse({
      texts: ["hello"],
      to: "invalid!!!",
      domain: "example.com",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty texts array", () => {
    const result = translateBodySchema.safeParse({
      texts: [],
      to: "ko",
      domain: "example.com",
    });
    expect(result.success).toBe(false);
  });

  test("rejects more than 100 texts", () => {
    const result = translateBodySchema.safeParse({
      texts: Array(101).fill("hello"),
      to: "ko",
      domain: "example.com",
    });
    expect(result.success).toBe(false);
  });
});

describe("translateBodySchema — preprompt", () => {
  test("accepts valid preprompt", () => {
    const result = translateBodySchema.safeParse({
      texts: ["hello"],
      to: "ko",
      domain: "example.com",
      preprompt: "이것은 음식 메뉴입니다",
    });
    expect(result.success).toBe(true);
  });

  test("rejects preprompt longer than 30 chars", () => {
    const result = translateBodySchema.safeParse({
      texts: ["hello"],
      to: "ko",
      domain: "example.com",
      preprompt: "a".repeat(31),
    });
    expect(result.success).toBe(false);
  });
});

describe("validateLangCode", () => {
  test("returns value for valid codes", () => {
    expect(validateLangCode("ko")).toBe("ko");
    expect(validateLangCode("zh-Hans")).toBe("zh-Hans");
  });

  test("returns null for invalid codes", () => {
    expect(validateLangCode("")).toBeNull();
    expect(validateLangCode("invalid!!!")).toBeNull();
  });
});

describe("POST /api/translate — validation", () => {
  test("400 for invalid language code", async () => {
    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: ["hello"],
        to: "'; DROP TABLE translations;--",
        domain: "example.com",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("400 for missing required fields", async () => {
    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: ["hello"] }),
    });
    expect(res.status).toBe(400);
  });
});
