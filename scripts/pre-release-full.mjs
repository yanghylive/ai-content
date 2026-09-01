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
import { execSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
let commitShort = "";
try { commitShort = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { commitShort = "unknown"; }
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

// v1.1.108（复核 P1-B）：每步完整输出捕获，供证据文件归档（不丢原始日志）
// v1.1.110（复核 P2）：补命令、退出码审计元数据
let lastRunLog = "";
let lastRunCommand = "";
let lastRunExit = 0;
function run(cmd, opts = {}) {
  const base = { stdio: "pipe", shell: "/bin/zsh", encoding: "utf8", env: { ...process.env, ...envClean } };
  // P1（P5 门禁 2026-08-22）：启用 pipefail——不加的话 `cmd | tail` 管道里
  // 上游测试/构建失败会被 tail 的成功退出码掩盖，导致门禁误报通过。
  // 显式 `|| true` 的步骤（有意容忍失败）不受影响。
  // v1.1.108（复核 P1-B）：去掉调用侧 `| tail` 后 execSync 捕获**完整**输出，
  // 屏幕摘要由 main 循环控制；失败仍 throw（step 判红），完整输出进证据文件。
  lastRunCommand = cmd;
  try {
    const out = execSync(`set -o pipefail; ${cmd}`, { ...base, ...opts });
    lastRunLog = String(out);
    lastRunExit = 0;
    return String(out);
  } catch (error) {
    lastRunLog = `${error.stdout || ""}\n${error.stderr || ""}\n[exit ${error.status ?? 1}]`;
    lastRunExit = error.status ?? 1;
    throw error;
  }
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
    // v1.1.103（复核整改）：backend 的 build:bundle:sqlite 会把 @prisma/client
    // 重新生成为 sqlite 版（schema.sqlite.prisma），jest 的 gateway spec 初始化
    // PrismaModule 时需要 PG 版 client——bundle build 之后跑 jest 必挂
    //（SQLITE_DATABASE_URL 缺失）。jest 前先恢复 PG client。
    run(`cd ${q(back)} && ./node_modules/.bin/prisma generate && npm test -- --runInBand --silent`);
  });
  step("L1 vitest 前端单测（26 例）", () => {
    run(`cd ${q(front)} && npx vitest run --silent`);
  });
  // v1.1.107（复核 P1）：release-guards.test.js 是 node:test（非 jest），此前门禁
  // L1 jest 跑不到它（jest 报 "must contain at least one test"）——25 项守卫
  // 一度 16/25 僵尸红灯无人发现。显式纳入门禁：25/25 必须全绿。
  step("L1 release-guards 25 项守卫（node:test）", () => {
    run(`cd ${q(desk)} && node --test scripts/release-guards.test.js`);
  });
  step("L1 循环依赖检查", () => {
    run(`cd ${q(back)} && npm run circular:check`);
  });

  /* ── L2 构建 + 守卫 ─────────────────────────────── */
  step("L2 前端生产构建（NEXT_PUBLIC_API_BASE=/api）", () => {
    if (skipBuild) return;
    run(`cd ${q(front)} && echo 'NEXT_PUBLIC_API_BASE=/api' > .env.local && ./node_modules/.bin/next build`);
  });
  step("L2 后端 bundle（sqlite）", () => {
    if (skipBuild) return;
    run(`cd ${q(back)} && npm run build:bundle:sqlite`);
  });
  step("L2 前端产物无 _next/image 残留（桌面端图标 404 坑）", () => {
    const out = run(`grep -rc "_next/image" ${front}/out/ 2>/dev/null | grep -v ":0" | head -3 || true`).trim();
    if (out) throw new Error(`产物仍含 _next/image 引用:\n${out}`);
  });
  step("L2 desktop 版本号一致性（version-sync）", () => {
    run(`cd ${q(desk)} && node scripts/check-version-sync.js`);
  });
  step("L2 desktop 商业资产（check-commercial-assets）", () => {
    run(`cd ${q(desk)} && npm run check:commercial-assets`);
  });

  /* ── L3 真实功能（需 3010/3011 起服务）───────────── */
  step("L3 防复发守卫 R1-R4", () => {
    run(`cd ${q(repoRoot)} && REGRESSION_FRONTEND_URL=${frontendUrl} node --experimental-sqlite scripts/ci/mobile-regression-guard.mjs`);
  });
  step("L3 Mac 包全功能 18 项", () => {
    run(`cd ${q(repoRoot)} && node mac-app-test.mjs`);
  });
  step("L3 发版核心 9 项（遮罩/简报卡/价值）", () => {
    run(`node scripts/ci/pre-release-core-verify.mjs`);
  });
  step("L3 带登录态全路由扫描（149 路由）", () => {
    const token = existsSync(tok) ? readFileSync(tok, "utf8").trim() : "";
    // v1.1.105（复核 P1-4）：路由扫描必须带本地登录态会话 + footer 硬断言——
    // localAcceptanceSession=false 的扫描不能作为登录态商业验收证据。
    run(`cd ${q(front)} && CONSOLE_SCAN_LOCAL_ACCEPTANCE_LOGIN=1 CONSOLE_SCAN_REQUIRE_SYSTEM_FOOTER=1 CONSOLE_SCAN_SESSION_TOKEN=${token} CONSOLE_SCAN_FRONTEND_URL=${frontendUrl} node scripts/console-quality-browser-scan.mjs`);
  });

  /* ── L4 安装包内容完整性（替代 VM 的关键层）──────── */
  // v1.1.105（复核 P0/P1-1）：以下两个 L4 检查只读 dist 现有产物，不依赖本轮
  // build——`--skip-build` 模式下也必须执行（8/30 曾因 skip-build 跳过 L4 造成
  // mac 资源混入 Win 包的 16/16 假绿）。check-package-contents 走最新包版本序
  // 并传 --win-only（平台互斥分支必须执行）；Win 严格检查绑定**精确的最新 exe**
  // （--installer，禁止回退 win-unpacked 中间目录）。
  const latestWinInstaller = (() => {
    const files = readdirSync(distDir).filter((f) => f.startsWith("JIUZHANG AI 内容创作平台 Setup") && f.endsWith(".exe"));
    const ver = (f) => {
      const m = f.match(/(\d+)\.(\d+)\.(\d+)/);
      return m ? m.slice(1).map(Number) : [0, 0, 0];
    };
    files.sort((a, b) => {
      const va = ver(a), vb = ver(b);
      return vb[0] - va[0] || vb[1] - va[1] || vb[2] - va[2];
    });
    return files[0] || null;
  })();
  const expectedPackageVersion = JSON.parse(readFileSync(path.join(desk, "package.json"), "utf8")).version;
  const versionOfFile = (f) => {
    const m = f.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? m.slice(1).join(".") : null;
  };
  step("L4 解包验证 dist 产物（asar 对照 require + 依赖 + 引擎）", () => {
    const extra = process.platform === "darwin" ? " --win-only" : "";
    run(`cd ${q(desk)} && node scripts/check-package-contents.js --dir ${q(distDir)}${extra}`);
  });
  // v1.1.102（复核 P0 整改）：L4 原 check-package-contents 只查目录存在不查平台
  // 可执行文件，导致 mac 资源混入 Win 包"15/15 假绿"。补严格平台资产检查：
  // 校验 win-x64 包内 node.exe / Playwright chrome.exe / Prisma win 引擎真实存在。
  step("L4 Win 包平台资产严格检查（node.exe/chrome.exe/引擎，防交叉构建假绿）", () => {
    if (!latestWinInstaller) {
      throw new Error(`dist 下缺少当前版本 ${expectedPackageVersion} 的 Win 安装包`);
    }
    if (versionOfFile(latestWinInstaller) !== expectedPackageVersion) {
      throw new Error(`Win 安装包版本 ${versionOfFile(latestWinInstaller)} 与 package.json ${expectedPackageVersion} 不一致`);
    }
    const installerRel = path.join(distDir, latestWinInstaller);
    run(`cd ${q(desk)} && BUILD_PLATFORM=win-x64 node scripts/check-full-installer-assets.js --phase=post --installer=${q(installerRel)}`);
  });

  /* ── 执行 ───────────────────────────────────────── */
  // v1.1.108（复核 P1-B）：门禁每步完整日志归档（不能只留 tail 摘要）。
  const evidenceDir = path.join(
    repoRoot,
    "docs",
    `gate-evidence-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${commitShort}`,
  );
  mkdirSync(evidenceDir, { recursive: true });
  for (const s of steps) {
    const level = s.name.split(" ")[0];
    if (only !== "all" && level !== only) continue;
    process.stdout.write(`\n▶ ${s.name} ... `);
    const t0 = Date.now();
    const logPath = path.join(
      evidenceDir,
      `${String(results.length + 1).padStart(2, "0")}-${level}-${s.name.replace(/[^\w\u4e00-\u9fa5]/g, "-").slice(0, 40)}.log`,
    );
    try {
      s.fn();
      results.push({ name: s.name, ok: true, ms: Date.now() - t0, log: logPath });
      console.log(`✅ (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      writeFileSync(logPath, `# ✅ ${s.name}\n# commit: ${commitShort}\n# exit: 0\n# duration_ms: ${Date.now() - t0}\n# command: ${lastRunCommand.replace(/\n/g, " ")}\n# 完整命令输出（未截断）：\n\n${lastRunLog || "(无输出)"}\n`);
    } catch (e) {
      const msg = String(e.message || e).split("\n").slice(-6).join("\n");
      results.push({ name: s.name, ok: false, ms: Date.now() - t0, err: msg, log: logPath });
      console.log(`❌ (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      console.log(`   ${msg}`);
      writeFileSync(logPath, `# ❌ ${s.name}\n# commit: ${commitShort}\n# exit: ${lastRunExit}\n# duration_ms: ${Date.now() - t0}\n# command: ${lastRunCommand.replace(/\n/g, " ")}\n# 完整命令输出（未截断）：\n\n${lastRunLog || "(无输出)"}\n`);
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
