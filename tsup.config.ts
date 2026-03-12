import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  outDir: "dist",
  clean: true,
  external: [
    "bun:sqlite",
    "@anthropic-ai/sdk",
    "hono",
    "hono/cors",
    "zod",
  ],
  platform: "node",
  target: "es2022",
});
