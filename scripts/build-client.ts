// 클라이언트 번들(dist/t.js)은 **남의 사이트에 <script> 로 박히는 코드**다.
// 그래서 소비자 앱의 빌드 타깃과 무관하게 여기서 직접 구형 문법까지 내려야 한다.
//
// Bun.build 의 target 은 플랫폼(browser/bun/node)이지 ES 버전이 아니라 문법을 못 내린다
// → `?.` 가 그대로 남아 **Safari 12.1(iOS 12) 이 파싱 단계에서 스크립트를 통째로 버렸다**
// (2026-08-01 menupie 실사용 리포트: 구형 아이패드에서 번역 위젯 무동작).
// esbuild 로 바꿔 target=es2019 로 트랜스파일한다.
//
// 런타임 API 는 트랜스파일 대상이 아니다 — t.ts 에서 Safari 12.1 에 없는 API 를 쓰지 마라
// (현재 사용: MutationObserver/fetch/localStorage 전부 안전). 아래 검사는 문법만 막아준다.
import { build } from "esbuild";
import { Parser } from "acorn";
import { readFileSync } from "node:fs";
import pkg from "../package.json";

const OUTFILE = "dist/t.js";
const TARGET = "es2019";

await build({
  entryPoints: ["src/client/t.ts"],
  outfile: OUTFILE,
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: TARGET,
  define: { __VERSION__: JSON.stringify(pkg.version) },
});

// 산출물이 정말 그 문법인지 확인 (타깃이 조용히 풀리는 회귀 방지)
const code = readFileSync(OUTFILE, "utf-8");
const banned: string[] = [];
const walk = (n: any) => {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach(walk);
  if (n.type === "ChainExpression") banned.push("?.");
  if (
    (n.type === "LogicalExpression" || n.type === "AssignmentExpression") &&
    ["??", "??=", "||=", "&&="].includes(n.operator)
  )
    banned.push(n.operator);
  for (const k in n) if (k !== "type" && k !== "start" && k !== "end") walk(n[k]);
};
walk(Parser.parse(code, { ecmaVersion: "latest", sourceType: "script" }));
if (banned.length) {
  console.error(
    `Build failed: ${OUTFILE} 에 ${TARGET} 초과 문법 잔존 — ${[...new Set(banned)].join(", ")}`
  );
  process.exit(1);
}

console.log(`  ${OUTFILE}  ${(code.length / 1024).toFixed(2)} KB (v${pkg.version}, ${TARGET})`);
