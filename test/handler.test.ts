import { describe, test, expect, beforeAll } from "bun:test";
import { unlinkSync } from "node:fs";

const DB_PATH = "/tmp/tongues-test-handler.db";
process.env.DB_PATH = DB_PATH;

import { createHandler } from "../src/server/handler";
import type { TonguesConfig } from "../src/server/handler";

beforeAll(() => {
  try { unlinkSync(DB_PATH); } catch {}
});

describe("createHandler", () => {
  test("throws when apiKey is missing", () => {
    expect(() => createHandler({ apiKey: "" })).toThrow("apiKey is required");
  });

  test("returns a Hono instance", () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    expect(handler).toBeDefined();
    expect(typeof handler.fetch).toBe("function");
  });

  test("health endpoint returns ok", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.cache).toBeDefined();
    expect(body.cache.sqliteReady).toBe(true);
  });

  test("POST /api/translate returns 400 for invalid body", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/translate returns 400 for missing fields", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: ["hello"] }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/translate returns 400 for invalid language", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: ["hello"],
        to: "'; DROP TABLE",
        domain: "example.com",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/purge/:domain/:lang returns 400 for invalid lang", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/api/purge/example.com/invalid!!!", {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/purge/:domain/:lang returns ok for valid request", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/api/purge/example.com/ko", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.domain).toBe("example.com");
    expect(body.lang).toBe("ko");
  });

  test("POST /api/purge/:domain returns ok", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/api/purge/example.com", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("respects custom rate limit", async () => {
    const handler = createHandler({
      apiKey: "test-key",
      dbPath: DB_PATH,
      rateLimit: 2,
    });

    // First 2 requests should go through (will fail at API level but not rate limit)
    for (let i = 0; i < 2; i++) {
      const res = await handler.request("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texts: ["hello"],
          to: "ko",
          domain: "rate-test.com",
        }),
      });
      // Will be 500 (no real API key) but not 429
      expect(res.status).not.toBe(429);
    }

    // Third request should be rate limited
    const res = await handler.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: ["hello"],
        to: "ko",
        domain: "rate-test.com",
      }),
    });
    expect(res.status).toBe(429);
  });

  test("CORS headers are set", async () => {
    const handler = createHandler({ apiKey: "test-key", dbPath: DB_PATH });
    const res = await handler.request("/health", {
      method: "GET",
      headers: { Origin: "https://example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("respects custom CORS origin", async () => {
    const handler = createHandler({
      apiKey: "test-key",
      dbPath: DB_PATH,
      corsOrigin: "https://mysite.com",
    });
    const res = await handler.request("/health", {
      method: "GET",
      headers: { Origin: "https://mysite.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://mysite.com");
  });
});

describe("createHandler config defaults", () => {
  test("uses default dbPath when not specified", () => {
    // Just verify it doesn't throw
    const handler = createHandler({ apiKey: "test-key" });
    expect(handler).toBeDefined();
  });
});
