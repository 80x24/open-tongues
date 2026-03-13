import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = join(import.meta.dir, "..", "dist");

describe("build outputs", () => {
  test("ESM bundle exists", () => {
    expect(existsSync(join(DIST, "index.js"))).toBe(true);
  });

  test("CJS bundle exists", () => {
    expect(existsSync(join(DIST, "index.cjs"))).toBe(true);
  });

  test("TypeScript declarations exist", () => {
    expect(existsSync(join(DIST, "index.d.ts"))).toBe(true);
    expect(existsSync(join(DIST, "index.d.cts"))).toBe(true);
  });

  test("Client bundle (t.js) exists", () => {
    expect(existsSync(join(DIST, "t.js"))).toBe(true);
  });

  test("ESM bundle exports createHandler", () => {
    const content = readFileSync(join(DIST, "index.js"), "utf-8");
    expect(content).toContain("createHandler");
  });

  test("CJS bundle exports createHandler", () => {
    const content = readFileSync(join(DIST, "index.cjs"), "utf-8");
    expect(content).toContain("createHandler");
  });

  test("ESM bundle exports createTranslator", () => {
    const content = readFileSync(join(DIST, "index.js"), "utf-8");
    expect(content).toContain("createTranslator");
  });

  test("TypeScript declaration exports createHandler", () => {
    const content = readFileSync(join(DIST, "index.d.ts"), "utf-8");
    expect(content).toContain("createHandler");
    expect(content).toContain("TonguesConfig");
  });

  test("TypeScript declaration exports Translator type", () => {
    const content = readFileSync(join(DIST, "index.d.ts"), "utf-8");
    expect(content).toContain("Translator");
    expect(content).toContain("TranslatorConfig");
    expect(content).toContain("TranslateContext");
    expect(content).toContain("CacheStats");
  });

  test("Client bundle is minified", () => {
    const content = readFileSync(join(DIST, "t.js"), "utf-8");
    // Minified code should not have multi-line function declarations
    const lines = content.split("\n").filter((l) => l.trim());
    // Should be significantly compressed (< 20 lines for ~210 lines of source)
    expect(lines.length).toBeLessThan(30);
  });

  test("Client bundle contains core functionality", () => {
    const content = readFileSync(join(DIST, "t.js"), "utf-8");
    // Should contain key strings that indicate t.js functionality
    expect(content).toContain("__tongues");
    expect(content).toContain("api/translate");
  });

  test("No secrets or API keys in bundles", () => {
    for (const file of ["index.js", "index.cjs", "t.js"]) {
      const content = readFileSync(join(DIST, file), "utf-8");
      expect(content).not.toContain("sk-ant-");
      expect(content).not.toContain("ANTHROPIC_API_KEY");
    }
  });
});

describe("package.json exports", () => {
  test("exports map is correctly configured", () => {
    const pkg = JSON.parse(readFileSync(join(DIST, "..", "package.json"), "utf-8"));
    expect(pkg.exports["."]).toBeDefined();
    expect(pkg.exports["./server"]).toBeDefined();
    expect(pkg.exports["./client"]).toBe("./dist/t.js");

    // Types should come first for proper resolution
    const mainExport = pkg.exports["."];
    const keys = Object.keys(mainExport);
    expect(keys[0]).toBe("types");
  });

  test("package name and version are set", () => {
    const pkg = JSON.parse(readFileSync(join(DIST, "..", "package.json"), "utf-8"));
    expect(pkg.name).toBe("open-tongues");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("files field limits published content", () => {
    const pkg = JSON.parse(readFileSync(join(DIST, "..", "package.json"), "utf-8"));
    expect(pkg.files).toContain("dist");
    expect(pkg.files).not.toContain("src");
    expect(pkg.files).not.toContain("test");
  });

  test("peer dependencies include hono", () => {
    const pkg = JSON.parse(readFileSync(join(DIST, "..", "package.json"), "utf-8"));
    expect(pkg.peerDependencies.hono).toBeDefined();
  });
});
