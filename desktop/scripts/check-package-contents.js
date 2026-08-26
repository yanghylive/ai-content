/**
 * 发版前门禁 L4：安装包内容完整性检查（替代 Windows 虚拟机做内容层验证）
 *
 * 对照项：
 *  1. app.asar 顶层文件 vs desktop/main.js 的 require('./xxx') 本地模块清单
 *     （2026-08-20 sqlite-empty-template 漏打包 = 双击崩溃，本检查直接拦）
 *  2. backend 内置依赖：sharp + @img/{darwin,win32-x64} + detect-libc + semver
 *  3. 打包产物不得携带本地运行时数据（sqlite/log/wal/browser-profiles）
 *  4. 内置 chromium（win/mac）存在
 *  5. Prisma 引擎（darwin-arm64 / windows）
 *
 * 用法：
 *  node scripts/check-package-contents.js [--dir dist] [--exe 可选覆盖]
 *  要求：7z 在 PATH（brew install p7zip），desktop/node_modules/@electron/asar 可用。
 */
const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const desk = path.resolve(__dirname, "..");
const distDir = path.join(desk, "dist");
const ASAR = path.join(desk, "node_modules", "@electron", "asar", "bin", "asar.js");

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function asarList(asarPath) {
  const r = spawnSync(process.execPath, [ASAR, "list", asarPath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`asar list 失败: ${r.stderr || r.stdout}`);
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

function mainRequires() {
  const main = fs.readFileSync(path.join(desk, "main.js"), "utf8");
  const reqs = [...main.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)].map((m) => m[1]);
  return [...new Set(reqs.map((r) => r.replace(/\.js$/, "")))];
}

const fails = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(label);
}

function extractMacApp(zipPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prl-mac-"));
  run(`unzip -q -o "${zipPath}" -d "${tmp}"`);
  const appDir = fs.readdirSync(tmp).find((f) => f.endsWith(".app"));
  return {
    tmp,
    app: path.join(tmp, appDir),
    resources: path.join(tmp, appDir, "Contents", "Resources"),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

function extractWinExe(exePath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prl-win-"));
  run(`7z x -y -o"${tmp}" "${exePath}" >/dev/null 2>&1`);
  const plugin = path.join(tmp, "$PLUGINSDIR", "app-64.7z");
  if (!fs.existsSync(plugin)) return { tmp, resources: null, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  const appOut = path.join(tmp, "app");
  const r = spawnSync("7z", ["x", "-y", `-o${appOut}`, plugin], { encoding: "utf8" });
  if (r.status !== 0) {
    console.warn(`7z 解 app-64.7z 失败: ${r.stderr || r.stdout}`);
    return { tmp, resources: null, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
  }
  return {
    tmp,
    resources: path.join(appOut, "resources"),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

function checkBackendCommon(resources, label, requiredImgVariants) {
  const backendNodeModules = path.join(resources, "backend", "node_modules");
  for (const pkg of ["sharp", "detect-libc", "semver"]) {
    check(
      fs.existsSync(path.join(backendNodeModules, pkg, "package.json")),
      `${label} backend 内置 ${pkg}`,
    );
  }
  // 4 个 sharp 原生变体全检（Mac/Win 装包共用同一份 backend bundle，跨平台抽取须齐；
  // 之前 Mac 装包不带 win32-x64 是 #8 审计抓到的真实缺口，由
  // desktop/scripts/prepare-sharp-win32.js 在打包前补齐）。
  const imgList = requiredImgVariants || [
    "sharp-darwin-arm64",
    "sharp-libvips-darwin-arm64",
    "sharp-win32-x64",
    "sharp-libvips-win32-x64",
  ];
  for (const img of imgList) {
    check(
      fs.existsSync(path.join(backendNodeModules, "@img", img, "package.json")),
      `${label} backend 内置 @img/${img}`,
    );
  }
}

function checkExtracted(label, resources, requiredImgVariants) {
  if (!resources || !fs.existsSync(resources)) {
    check(false, `${label}: resources 目录不存在`);
    return;
  }
  const asarPath = path.join(resources, "app.asar");
  // 2026-08-27：支持 asar=false 形态（main 等顶层代码在 resources/app/ 目录）。
  const appDir = path.join(resources, "app");
  if (!fs.existsSync(asarPath) && fs.existsSync(path.join(appDir, "main.js"))) {
    const topFiles = fs
      .readdirSync(appDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => `/${d.name.replace(/\.js$/, "")}`);
    const reqs = mainRequires();
    for (const r of reqs) {
      const base = r.replace(/^\.\//, "").replace(/\.js$/, "");
      check(topFiles.includes(`/${base}`), `${label} resources/app 含 main.js 依赖 ${base}.js`, "");
    }
    checkBackendCommon(resources, label, requiredImgVariants);
    return;
  }
  if (!fs.existsSync(asarPath)) {
    check(false, `${label}: app.asar 缺失`);
    return;
  }
  const files = asarList(asarPath);
  const topFiles = files.filter((f) => !f.startsWith("/node_modules") && !f.startsWith("/assets"));

  // 1. main.js require 对照
  const reqs = mainRequires();
  for (const r of reqs) {
    const base = r.replace(/^\.\//, "").replace(/\.js$/, "");
    check(topFiles.includes(`/${base}.js`) || topFiles.includes(`/${base}`), `${label} asar 含 main.js 依赖 ${base}.js`, "");
  }

  // 2. backend 原生依赖（两形态共用）
  checkBackendCommon(resources, label, requiredImgVariants);

  // 3. 无本地运行时数据
  const forbidden = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(path.join(resources, "backend"), full);
      if (rel === path.join("prisma", "dev.db")) continue;
      if (e.isDirectory()) {
        if (e.name === ".local-logs" || e.name === "browser-profiles") forbidden.push(rel);
        else walk(full);
      } else if (/\.(sqlite|log|wal|shm)$/i.test(e.name)) forbidden.push(rel);
    }
  })(path.join(resources, "backend"));
  check(forbidden.length === 0, `${label} backend 无本地运行时数据`, forbidden.join(", ") || "");

  // 4. chromium + prisma 引擎
  check(fs.existsSync(path.join(resources, "playwright-browsers", "chromium")), `${label} 内置 playwright chromium`);
  const engines = fs.readdirSync(path.join(resources, "backend")).filter((f) => f.includes("query_engine") || f.includes("libquery_engine"));
  check(engines.length > 0, `${label} Prisma 引擎`, engines.join(", "));

  // 5. Octop sidecar（审计 #3：Octop 直接打包，不外部依赖。P1 #4 补漏检）
  const octopRoot = path.join(resources, "octop");
  check(fs.existsSync(octopRoot), `${label} 内置 Octop sidecar 目录`);
  check(fs.existsSync(path.join(octopRoot, "entry.sh")), `${label} Octop entry.sh`);
  check(fs.existsSync(path.join(octopRoot, "entry.bat")), `${label} Octop entry.bat`);
  check(fs.existsSync(path.join(octopRoot, "venv", "bin", "python")) || fs.existsSync(path.join(octopRoot, "venv", "Scripts", "python.exe")), `${label} Octop venv python`);
  check(fs.existsSync(path.join(octopRoot, "browsers")), `${label} Octop playwright browsers`);
}

const argDir = process.argv.find((a) => a.startsWith("--dir"))?.split("=")[1] || "dist";
const targetDir = path.join(desk, argDir);

console.log(`═══ 安装包内容完整性检查（${targetDir}）═══\n`);

const macZips = fs.readdirSync(targetDir).filter((f) => /arm64-mac\.zip$/.test(f) && !f.includes("1.1.85"));
const winExes = fs.readdirSync(targetDir).filter((f) => /Setup.*\.exe$/.test(f) && !f.includes("1.1.85"));

// Mac / Win 装包都共用同一份 backend bundle（含 4 个 sharp 原生变体）——
// 跨平台安装包抽取同一份 backend 时，4 个变体必须齐。
// 之前 Mac 装包不带 win32-x64 是 #8 审计抓到的真实缺口，
// 由 desktop/scripts/prepare-sharp-win32.js 在打包前补齐（macOS 交叉构建路径必须）。
const SHARP_REQUIRED_ALL = [
  "sharp-darwin-arm64",
  "sharp-libvips-darwin-arm64",
  "sharp-win32-x64",
  "sharp-libvips-win32-x64",
];

// Mac
if (macZips.length === 0) {
  check(false, "Mac zip 未找到", targetDir);
} else {
  const mac = extractMacApp(path.join(targetDir, macZips[macZips.length - 1]));
  checkExtracted(
    `Mac(${macZips[macZips.length - 1]})`,
    mac.resources,
    SHARP_REQUIRED_ALL,
  );
  mac.cleanup();
}

// Win：优先检查 win-unpacked 目录（Windows 原生构建无 7z，electron-builder 的
// win-unpacked 已含解包后的 resources）；缺失才 fallback 7z 解压 NSIS exe。
// --mac-only：只检查 Mac 包（Mac 测试包构建时本机 dist 无新 Win 包，跳过 Win 检查）
const macOnly = process.argv.includes('--mac-only');
if (macOnly) {
  console.log('（--mac-only：跳过 Win 包检查）');
} else {
const winUnpacked = path.join(targetDir, "win-unpacked");
if (fs.existsSync(path.join(winUnpacked, "resources"))) {
  checkExtracted("Win(win-unpacked)", path.join(winUnpacked, "resources"), SHARP_REQUIRED_ALL);
} else if (winExes.length === 0) {
  check(false, "Win exe 未找到", targetDir);
} else {
  const win = extractWinExe(path.join(targetDir, winExes[winExes.length - 1]));
  if (win.resources) {
    checkExtracted(
      `Win(${winExes[winExes.length - 1]})`,
      win.resources,
      SHARP_REQUIRED_ALL,
    );
  } else {
    check(false, "Win exe 解包失败（app-64.7z 未找到）", winExes[winExes.length - 1]);
  }
  win.cleanup();
}
}

console.log(fails.length ? `\n❌ ${fails.length} 项失败：\n  ${fails.join("\n  ")}` : "\n✅ 安装包内容完整性全部通过");
process.exit(fails.length ? 1 : 0);
