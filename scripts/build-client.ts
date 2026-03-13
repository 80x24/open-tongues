import pkg from "../package.json";

const result = await Bun.build({
  entrypoints: ["src/client/t.ts"],
  outdir: "dist",
  minify: true,
  define: { __VERSION__: JSON.stringify(pkg.version) },
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}
console.log(`  dist/t.js  ${(result.outputs[0].size / 1024).toFixed(2)} KB (v${pkg.version})`);
