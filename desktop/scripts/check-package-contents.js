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
  // 2026-08-31（CI run 33393818145 实证）：@electron/asar listFiles 用 path.join 拼
  // 路径，Windows 下输出 \node_modules\... 反斜杠 → 脚本按 / 前缀比对全部落空，
  // asar 相关检查在 win 上整齐假红（包本身是好的）。归一化成正斜杠再比对。
  return r.stdout.split("\n").map((l) => l.trim().replace(/\\/g, "/")).filter(Boolean);
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

// 2026-08-31（CI run 33391994962 实证）：GitHub windows runner 装了 7-Zip 但
// 不保证在 PATH → 依次尝试 PATH 与常见安装路径。
let cached7z;
function find7z() {
  if (cached7z !== undefined) return cached7z;
  const tries = ["7z"];
  if (process.platform === "win32") {
    tries.push("C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe");
  }
  cached7z = null;
  for (const c of tries) {
    const r = spawnSync(c, [], { encoding: "utf8" });
    if (!r.error) {
      cached7z = c;
      break;
    }
  }
  return cached7z;
}

function extractWinExe(exePath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prl-win-"));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  // 原 `>/dev/null 2>&1` 在 Windows cmd 下无 /dev/null → "The system cannot find
  // the path specified."；run() 的 stdio 已 pipe 捕获，无需 shell 重定向。
  const sevenZip = find7z();
  if (!sevenZip) {
    console.warn("7z 不存在（macOS: brew install p7zip / Windows: 安装 7-Zip），无法深度解包 exe");
    return { tmp, resources: null, cleanup };
  }
  run(`"${sevenZip}" x -y -o"${tmp}" "${exePath}"`);
  const plugin = path.join(tmp, "$PLUGINSDIR", "app-64.7z");
  if (!fs.existsSync(plugin)) return { tmp, resources: null, cleanup };
  const appOut = path.join(tmp, "app");
  const r = spawnSync(sevenZip, ["x", "-y", `-o${appOut}`, plugin], { encoding: "utf8" });
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
  // 2026-08-31（CI run 33393818145）：asar 顶层清单落日志——"works on my machine"
  // 类缺失（本机过、CI 挂）没清单就只能瞎猜，有了清单一眼定位
  console.log(`[asar] 顶层 ${topFiles.length} 项: ${topFiles.slice(0, 40).join(" ")}`);

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
      // v1.1.108（复核 P2）：白名单只放 seed.db（166 表空模板，首次启动复制用）；
      // dev.db 及其他任何 .db 一律禁止进包（1.1.107 起 seed 模板已改名 seed.db）。
      if (rel === path.join("prisma", "seed.db")) continue;
      if (e.isDirectory()) {
        if (e.name === ".local-logs" || e.name === "browser-profiles") forbidden.push(rel);
        else walk(full);
      } else if (/\.(sqlite|db|log|wal|shm)$/i.test(e.name)) forbidden.push(rel);
    }
  })(path.join(resources, "backend"));
  check(forbidden.length === 0, `${label} backend 无本地运行时数据`, forbidden.join(", ") || "");

  // 4. chromium + prisma 引擎
  check(fs.existsSync(path.join(resources, "playwright-browsers", "chromium")), `${label} 内置 playwright chromium`);
  const engines = fs.readdirSync(path.join(resources, "backend")).filter((f) => f.includes("query_engine") || f.includes("libquery_engine"));
  // v1.1.105（复核 P0 整改）：引擎必须按平台校验——以前只查"存在某个引擎"，
  // mac 资源的包也能通过（假绿根因之一）。win 检查要求 windows 引擎存在且
  // **不得混入 darwin 引擎**；非 win 检查保持存在性。
  check(engines.length > 0, `${label} Prisma 引擎`, engines.join(", "));
  if (process.argv.includes('--win-only') || process.argv.includes('--platform=win')) {
    check(
      engines.some((f) => f.includes("windows.dll.node") || f.includes("windows.node")),
      `${label} Prisma Windows 引擎`,
      engines.join(", "),
    );
    check(
      !engines.some((f) => f.includes("darwin")),
      `${label} 不得混入 darwin 引擎（平台互斥，混入 = 交叉构建资源串包）`,
      engines.join(", "),
    );
  }

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

// v1.1.105（复核 P0 整改）：按版本号降序取最新包（原 readdirSync 目录序会让
// "1.1.104" 排在 "1.1.99" 前面，取 last 拿到旧包——假绿根因之二）。
function versionOf(file) {
  const m = file.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function byVersionDesc(a, b) {
  const va = versionOf(a);
  const vb = versionOf(b);
  return vb[0] - va[0] || vb[1] - va[1] || vb[2] - va[2];
}
const macZips = fs.readdirSync(targetDir).filter((f) => /arm64-mac\.zip$/.test(f) && !f.includes("1.1.85")).sort(byVersionDesc);
const winExes = fs.readdirSync(targetDir).filter((f) => /Setup.*\.exe$/.test(f) && !f.includes("1.1.85")).sort(byVersionDesc);

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

// Mac（--win-only 时跳过）
const winOnly = process.argv.includes('--win-only');
if (winOnly) {
  console.log('（--win-only：跳过 Mac 包检查）');
} else if (macZips.length === 0) {
  check(false, "Mac zip 未找到", targetDir);
} else {
  const mac = extractMacApp(path.join(targetDir, macZips[0]));
  checkExtracted(
    `Mac(${macZips[0]})`,
    mac.resources,
    SHARP_REQUIRED_ALL,
  );
  mac.cleanup();
}

// Win：v1.1.105（复核 P0 整改）——优先解包**最新 exe**（不再默认信任 win-unpacked
// 目录：那是 electron-builder 中间产物，可能与实际 exe 不一致——8/30 曾用 mac
// runtime 打出 win-unpacked+exe 双坏包且检查通过）。
// --dir 显式指向 win-unpacked 时仍用目录（Windows 原生构建无 7z 的场景）。
const macOnly = process.argv.includes('--mac-only');
if (macOnly) {
  console.log('（--mac-only：跳过 Win 包检查）');
} else {
const useUnpacked = argDir.includes("win-unpacked");
if (useUnpacked && fs.existsSync(path.join(targetDir, "resources"))) {
  checkExtracted("Win(win-unpacked)", path.join(targetDir, "resources"), SHARP_REQUIRED_ALL);
} else if (winExes.length === 0) {
  check(false, "Win exe 未找到", targetDir);
} else {
  const win = extractWinExe(path.join(targetDir, winExes[0]));
  if (win.resources) {
    checkExtracted(
      `Win(${winExes[0]})`,
      win.resources,
      SHARP_REQUIRED_ALL,
    );
  } else {
    check(false, "Win exe 解包失败（app-64.7z 未找到）", winExes[0]);
  }
  win.cleanup();
}
}

console.log(fails.length ? `\n❌ ${fails.length} 项失败：\n  ${fails.join("\n  ")}` : "\n✅ 安装包内容完整性全部通过");
process.exit(fails.length ? 1 : 0);
