#!/usr/bin/env node
/**
 * 发版前全量门禁（pre-release-full）
 * ─────────────────────────────────────────────
 * 四层门禁，一键跑完。任何一层红 = 不允许发版。
 * 设计目标：把"能不能发"变成可重复的机器检查，Windows 真机只留最后一层。
 *
 * L1 静态与单测   : tsc / jest / vitest / circular（~6min）
 * L2 构建+守卫    : 前端生产构建 / 后端 bundle / desktop 10+ check（~10min）
 * L3 真实功能     : 防复发守卫 R1-R4 / 18 项全功能 / 9 项发版核心 / 带登录态路由扫描（~10min）
 * L4 安装包内容   : 解包 asar 对照 main.js require + 原生依赖/引擎/chromium/无本地数据（~2min，新增）
 *
 * 用法：
 *   node scripts/pre-release-full.mjs [--skip-build] [--only L1|L2|L3|L4] [--frontend-url http://127.0.0.1:3010]
 *
 * 前置：3010/3011 已起（launchd），/tmp/electron-test-token.txt 为有效登录 token。
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const skipBuild = argv.includes("--skip-build");
const only = argv.find((a) => a.startsWith("--only"))?.split("=")[1] || "all";

const envClean = {
  HTTP_PROXY: "", HTTPS_PROXY: "", http_proxy: "", https_proxy: "", NODE_OPTIONS: "",
};

const steps = [];
const results = [];
let startMs = Date.now();

function step(name, fn) {
  steps.push({ name, fn });
}

function run(cmd, opts = {}) {
  const base = { stdio: "pipe", shell: "/bin/zsh", encoding: "utf8", env: { ...process.env, ...envClean } };
  // P1（P5 门禁 2026-08-22）：启用 pipefail——不加的话 `cmd | tail` 管道里
  // 上游测试/构建失败会被 tail 的成功退出码掩盖，导致门禁误报通过。
  // 显式 `|| true` 的步骤（有意容忍失败）不受影响。
  const child = execSync(`set -o pipefail; ${cmd}`, { ...base, ...opts });
  return child;
}

const q = (p) => `'${p}'`;

async function main() {
  const tok = "/tmp/electron-test-token.txt";
  if (!existsSync(tok)) {
    console.log("⚠️  缺少登录 token：/tmp/electron-test-token.txt（先登录 3011 生成）");
  }

  const back = path.join(repoRoot, "backend");
  const front = path.join(repoRoot, "frontend");
  const desk = path.join(repoRoot, "desktop");
  const frontendUrl = argv.find((a) => a.startsWith("--frontend-url"))?.split("=")[1] || "http://127.0.0.1:3010";
  const distDir = path.join(desk, "dist");

  /* ── L1 静态与单测 ─────────────────────────────── */
  step("L1 tsc 后端类型检查", () => {
    run(`cd ${q(back)} && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`);
  });
  step("L1 tsc 前端类型检查", () => {
    run(`cd ${q(front)} && ./node_modules/.bin/tsc --noEmit`);
  });
  step("L1 jest 后端单测（207+ 例）", () => {
    run(`cd ${q(back)} && npm test -- --runInBand --silent 2>&1 | tail -8`);
  });
  step("L1 vitest 前端单测（26 例）", () => {
    run(`cd ${q(front)} && npx vitest run --silent 2>&1 | tail -8`);
  });
  step("L1 循环依赖检查", () => {
    run(`cd ${q(back)} && npm run circular:check`);
  });

  /* ── L2 构建 + 守卫 ─────────────────────────────── */
  step("L2 前端生产构建（NEXT_PUBLIC_API_BASE=/api）", () => {
    if (skipBuild) return;
    run(`cd ${q(front)} && echo 'NEXT_PUBLIC_API_BASE=/api' > .env.local && ./node_modules/.bin/next build 2>&1 | tail -4`);
  });
  step("L2 后端 bundle（sqlite）", () => {
    if (skipBuild) return;
    run(`cd ${q(back)} && npm run build:bundle:sqlite 2>&1 | tail -2`);
  });
  step("L2 前端产物无 _next/image 残留（桌面端图标 404 坑）", () => {
    const out = run(`grep -rc "_next/image" ${front}/out/ 2>/dev/null | grep -v ":0" | head -3 || true`).trim();
    if (out) throw new Error(`产物仍含 _next/image 引用:\n${out}`);
  });
  step("L2 desktop 版本号一致性（version-sync）", () => {
    run(`cd ${q(desk)} && node scripts/check-version-sync.js 2>&1 | tail -3`);
  });
  step("L2 desktop 商业资产（check-commercial-assets）", () => {
    run(`cd ${q(desk)} && npm run check:commercial-assets 2>&1 | tail -3`);
  });

  /* ── L3 真实功能（需 3010/3011 起服务）───────────── */
  step("L3 防复发守卫 R1-R4", () => {
    run(`cd ${q(repoRoot)} && REGRESSION_FRONTEND_URL=${frontendUrl} node --experimental-sqlite scripts/ci/mobile-regression-guard.mjs 2>&1 | tail -6`);
  });
  step("L3 Mac 包全功能 18 项", () => {
    run(`cd ${q(repoRoot)} && node mac-app-test.mjs 2>&1 | tail -4`);
  });
  step("L3 发版核心 9 项（遮罩/简报卡/价值）", () => {
    run(`node scripts/ci/pre-release-core-verify.mjs 2>&1 | tail -6`);
  });
  step("L3 带登录态全路由扫描（149 路由）", () => {
    const token = existsSync(tok) ? readFileSync(tok, "utf8").trim() : "";
    run(`cd ${q(front)} && CONSOLE_SCAN_SESSION_TOKEN=${token} CONSOLE_SCAN_FRONTEND_URL=${frontendUrl} node scripts/console-quality-browser-scan.mjs 2>&1 | tail -8`);
  });

  /* ── L4 安装包内容完整性（替代 VM 的关键层）──────── */
  step("L4 解包验证 dist 产物（asar 对照 require + 依赖 + 引擎）", () => {
    if (skipBuild) return;
    run(`cd ${q(desk)} && node scripts/check-package-contents.js --dir ${q(distDir)} 2>&1 | tail -12`);
  });

  /* ── 执行 ───────────────────────────────────────── */
  for (const s of steps) {
    const level = s.name.split(" ")[0];
    if (only !== "all" && level !== only) continue;
    process.stdout.write(`\n▶ ${s.name} ... `);
    const t0 = Date.now();
    try {
      s.fn();
      results.push({ name: s.name, ok: true, ms: Date.now() - t0 });
      console.log(`✅ (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    } catch (e) {
      const msg = String(e.message || e).split("\n").slice(-6).join("\n");
      results.push({ name: s.name, ok: false, ms: Date.now() - t0, err: msg });
      console.log(`❌ (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      console.log(`   ${msg}`);
    }
  }

  /* ── 汇总 ───────────────────────────────────────── */
  const failed = results.filter((r) => !r.ok);
  console.log("\n" + "=".repeat(60));
  console.log(`发版前全量门禁结果（${((Date.now() - startMs) / 60000).toFixed(1)}min）`);
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : "\n      " + (r.err || "")}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log("\n🚫 有红项，不允许发版！修复后重跑。");
    process.exit(1);
  }
  console.log("\n✅ 全部通过，可以发版。Windows 真机只留：安装向导/SmartScreen/平台登录。");
}

main().catch((e) => { console.error(e); process.exit(1); });
