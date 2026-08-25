#!/usr/bin/env node
/**
 * 生成 Octop sidecar（审计 #3：Octop 直接打包，不外部依赖）。
 *
 * 策略（方案 B，经隔离副本实测）：
 *   - ① 无损裁剪：删 __pycache__ / pip / setuptools / wheel / PyObjCTest
 *   - ③ connector 裁剪：删 googleapiclient / google / lark_oapi / openai
 *     （deepagents 顶层 import langchain_anthropic → anthropic 必须保留；
 *      已实测删这 4 项后 Octop 启动 health=200）
 *   - ② 只打包 headless_shell（Octop 浏览器会话用 headless，不需要 full chromium）
 *   - ④ chromium 复用不可行：Python playwright 1.62.0 = chromium 151，
 *     Node 桌面端 1.62.1 = chromium 152，版本无法对齐 → 放弃，各自打包。
 *
 * 输入：本机已安装的 Octop venv（OCTOP_VENV 或默认 ~/.octop/venv）。
 * 输出：desktop/runtime/octop/{venv,browsers,entry.sh}，由 electron-builder extraResources 打包。
 *
 * 用法：
 *   node scripts/prepare-octop-sidecar.js            # 生成精简 sidecar
 *   node scripts/prepare-octop-sidecar.js --dry-run  # 只打印裁剪清单，不落地
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const desktopRoot = path.resolve(__dirname, '..');
const runtimeOctop = path.join(desktopRoot, 'runtime', 'octop');
const octopVenv = process.env.OCTOP_VENV || path.join(os.homedir(), '.octop', 'venv');
const dryRun = process.argv.includes('--dry-run');

// ③ connector 裁剪清单（实测可删，deepagents 不依赖）
const CONNECTOR_DIRS = ['googleapiclient', 'google', 'lark_oapi', 'openai'];
// ① 无损裁剪清单
const CACHE_DIRS = ['pip', 'setuptools', 'wheel', 'PyObjCTest', 'pkg_resources'];
// 必须保留（误删会导致 Octop 启动失败）：anthropic（deepagents→langchain_anthropic）
const KEEP_IF_PRESENT = ['anthropic', 'langchain_core', 'langchain', 'langchain_anthropic', 'langchain_mcp_adapters'];

function run(label, cmd, args) {
  if (dryRun) {
    console.log(`[dry-run] ${label}: ${cmd} ${args.join(' ')}`);
    return;
  }
  console.log(`\n--- ${label} ---`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function sitePackagesOf(venv) {
  const sp = path.join(venv, 'lib', 'python3.12', 'site-packages');
  if (!fs.existsSync(sp)) {
    // 回退探测其他 python 版本
    const lib = path.join(venv, 'lib');
    if (fs.existsSync(lib)) {
      const py = fs.readdirSync(lib).find((d) => d.startsWith('python'));
      if (py) return path.join(lib, py, 'site-packages');
    }
  }
  return sp;
}

function chromiumDir() {
  const sp = sitePackagesOf(octopVenv);
  const browsersJson = path.join(sp, 'playwright', 'driver', 'package', 'browsers.json');
  if (!fs.existsSync(browsersJson)) return null;
  const { browsers } = JSON.parse(fs.readFileSync(browsersJson, 'utf8'));
  const h = browsers.find((b) => b.name === 'chromium-headless-shell');
  // 目录名用 revision（如 chromium_headless_shell-1228），不是 browserVersion（Chrome 版本号）
  return h ? { revision: h.revision } : null;
}

/** Playwright 浏览器缓存目录（跨平台：macOS ~/Library/Caches，Windows %LOCALAPPDATA%） */
function playwrightCacheDir() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'ms-playwright',
    );
  }
  return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
}

function copyWithSkip(src, dst, skipDirs, skipSuffix) {
  // 复制 site-packages，跳过 skipDirs 目录 + 所有 __pycache__/*.pyc
  fs.mkdirSync(dst, { recursive: true });
  const skipSet = new Set(skipDirs);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const name = entry.name;
    if (skipSet.has(name)) continue;
    if (name === '__pycache__') continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (entry.isDirectory()) {
      // dist-info / 含 .pyc 的包内部还要清 __pycache__
      fs.cpSync(s, d, {
        recursive: true,
        filter: (srcPath) => {
          const base = path.basename(srcPath);
          if (base === '__pycache__') return false;
          if (base.endsWith('.pyc')) return false;
          return true;
        },
      });
    } else {
      if (name.endsWith('.pyc')) continue;
      fs.copyFileSync(s, d);
    }
  }
}

function main() {
  if (!fs.existsSync(octopVenv)) {
    fail(`未找到 Octop venv: ${octopVenv}（请先安装 Octop，或用 OCTOP_VENV 指定路径）`);
  }
  const sp = sitePackagesOf(octopVenv);
  if (!fs.existsSync(sp)) fail(`未找到 site-packages: ${sp}`);

  const chrom = chromiumDir();
  console.log(`Octop venv: ${octopVenv}`);
  console.log(`site-packages: ${sp}`);
  console.log(`headless-shell chromium: ${chrom ? chrom.revision : '未探测到'}`);
  console.log(`目标: ${runtimeOctop}`);
  if (dryRun) console.log('（--dry-run，不落地）');

  const dstVenv = path.join(runtimeOctop, 'venv');
  const dstSp = sitePackagesOf(dstVenv);

  if (!dryRun) {
    fs.rmSync(runtimeOctop, { recursive: true, force: true });
    fs.mkdirSync(dstVenv, { recursive: true });
  }

  // 1. 用 uv 建干净 venv（处理 shebang/symlink/pyvenv.cfg 路径问题）
  run('uv venv', 'uv', ['venv', dstVenv, '--python', '3.12']);

  // 2. 复制 site-packages（精简）
  if (!dryRun) {
    console.log('\n--- 复制 + 精简 site-packages ---');
    copyWithSkip(sp, dstSp, [...CONNECTOR_DIRS, ...CACHE_DIRS], '__pycache__');
  } else {
    console.log(`[dry-run] 复制 site-packages（跳过 ${[...CONNECTOR_DIRS, ...CACHE_DIRS].join(',')} + __pycache__/*.pyc）`);
  }

  // 3. 复制 headless_shell chromium 到 sidecar（跨平台缓存路径）
  if (chrom) {
    const srcBrowsers = path.join(playwrightCacheDir(), `chromium_headless_shell-${chrom.revision}`);
    const dstBrowsers = path.join(runtimeOctop, 'browsers', `chromium_headless_shell-${chrom.revision}`);
    if (fs.existsSync(srcBrowsers)) {
      if (!dryRun) fs.mkdirSync(path.dirname(dstBrowsers), { recursive: true });
      run(`复制 headless_shell chromium ${chrom.revision}`, 'cp', ['-R', srcBrowsers, dstBrowsers]);
    } else {
      console.warn(`⚠ 未找到 ${srcBrowsers}，请先 playwright install chromium（headless shell）`);
    }
  }

  // 4. 生成 entry.sh
  const entry = path.join(runtimeOctop, 'entry.sh');
  const entryContent = '#!/usr/bin/env bash\n' +
    '# Octop sidecar 启动脚本（由 prepare-octop-sidecar.js 生成）\n' +
    'set -euo pipefail\n' +
    'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\n' +
    'export PLAYWRIGHT_BROWSERS_PATH="$DIR/browsers"\n' +
    'export OCTOP_HOME="${OCTOP_HOME:-$DIR/octop-home}"\n' +
    'mkdir -p "$OCTOP_HOME"\n' +
    '# 首次启动：用 octop init 预置 admin（免 wizard）。凭据由 main.js 经 OCTOP_ADMIN_USERNAME/PASSWORD 注入，\n' +
    '# 与 backend 的 OCTOP_USERNAME/OCTOP_PASSWORD 一致，backend 才能登录本 sidecar。\n' +
    'if [ ! -f "$OCTOP_HOME/.octop-initialized" ]; then\n' +
    '  echo "[octop-sidecar] 首次启动，初始化 admin 账号..."\n' +
    '  "$DIR/venv/bin/python" -m octop.cli.main init \\\n' +
    '    --admin-username "${OCTOP_ADMIN_USERNAME:-octop-bridge}" \\\n' +
    '    --admin-password "${OCTOP_ADMIN_PASSWORD:-Octop1234}" \\\n' +
    '    --yes\n' +
    '  touch "$OCTOP_HOME/.octop-initialized"\n' +
    'fi\n' +
    'exec "$DIR/venv/bin/python" -m octop.cli.main run --host 127.0.0.1 --port "${OCTOP_PORT:-8088}" "$@"\n';
  if (!dryRun) {
    fs.writeFileSync(entry, entryContent, { mode: 0o755 });
    console.log(`\n✓ entry.sh 已生成`);
  } else {
    console.log('[dry-run] 生成 entry.sh');
  }

  // 4b. 生成 entry.bat（Windows 版：venv 用 Scripts\python.exe，环境变量用 set 语法）
  const entryBat = path.join(runtimeOctop, 'entry.bat');
  const entryBatContent = '@echo off\r\n' +
    'setlocal\r\n' +
    'set "DIR=%~dp0"\r\n' +
    'set "PLAYWRIGHT_BROWSERS_PATH=%DIR%browsers"\r\n' +
    'if "%OCTOP_HOME%"=="" set "OCTOP_HOME=%DIR%octop-home"\r\n' +
    'if not exist "%OCTOP_HOME%" mkdir "%OCTOP_HOME%"\r\n' +
    'if not exist "%OCTOP_HOME%\\.octop-initialized" (\r\n' +
    '  echo [octop-sidecar] 首次启动，初始化 admin 账号...\r\n' +
    '  if "%OCTOP_ADMIN_USERNAME%"=="" set "OCTOP_ADMIN_USERNAME=octop-bridge"\r\n' +
    '  if "%OCTOP_ADMIN_PASSWORD%"=="" set "OCTOP_ADMIN_PASSWORD=Octop1234"\r\n' +
    '  "%DIR%venv\\Scripts\\python.exe" -m octop.cli.main init --admin-username "%OCTOP_ADMIN_USERNAME%" --admin-password "%OCTOP_ADMIN_PASSWORD%" --yes\r\n' +
    '  type nul > "%OCTOP_HOME%\\.octop-initialized"\r\n' +
    ')\r\n' +
    'if "%OCTOP_PORT%"=="" set "OCTOP_PORT=8088"\r\n' +
    '"%DIR%venv\\Scripts\\python.exe" -m octop.cli.main run --host 127.0.0.1 --port "%OCTOP_PORT%" %*\r\n';
  if (!dryRun) {
    fs.writeFileSync(entryBat, entryBatContent);
    console.log('✓ entry.bat 已生成');
  } else {
    console.log('[dry-run] 生成 entry.bat');
  }

  // 5. 报告大小
  if (!dryRun && fs.existsSync(runtimeOctop)) {
    const { execSync } = require('node:child_process');
    const size = execSync(`du -sh "${runtimeOctop}"`, { encoding: 'utf8' }).trim();
    console.log(`\n✓ Octop sidecar 生成完成: ${runtimeOctop} (${size.split('\t')[0]})`);
  }
}

main();
