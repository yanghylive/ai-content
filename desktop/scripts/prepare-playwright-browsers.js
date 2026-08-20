#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const targetRoot = path.join(desktopRoot, 'runtime', 'playwright-browsers');
const targetChromiumRoot = path.join(targetRoot, 'chromium');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resolvePlaywrightChromiumExecutable() {
  const playwrightPath = path.join(repoRoot, 'backend', 'node_modules', 'playwright');
  let playwright;
  try {
    playwright = require(playwrightPath);
  } catch (error) {
    fail(`Cannot load backend Playwright package: ${error.message}`);
  }

  const executablePath = playwright.chromium.executablePath();
  if (!fs.existsSync(executablePath)) {
    fail(`Playwright Chromium executable is missing: ${executablePath}\nRun backend Playwright install before packaging.`);
  }
  return executablePath;
}

function findBrowserRoot(executablePath) {
  let current = path.dirname(executablePath);
  while (current && current !== path.dirname(current)) {
    if (/chromium-\d+$/.test(path.basename(current))) {
      return current;
    }
    current = path.dirname(current);
  }
  fail(`Cannot locate chromium-* browser root for executable: ${executablePath}`);
}

function main() {
  const targetPlatform = process.env.BUILD_PLATFORM || process.platform;
  // win 交叉构建：从 PLAYWRIGHT_WIN_BROWSERS 目录（playwright install --platform=win64 产物）复制
  if (targetPlatform === 'win-x64' && process.platform !== 'win32') {
    const winBrowsersRoot =
      process.env.PLAYWRIGHT_WIN_BROWSERS || path.join(repoRoot, 'kaypal-ai', '.runtime', 'playwright-browsers-win');
    if (!fs.existsSync(winBrowsersRoot)) {
      fail(
        `win-x64 Chromium 未就绪：${winBrowsersRoot}\n` +
          `在 backend 目录执行：PLAYWRIGHT_BROWSERS_PATH=${winBrowsersRoot} npx playwright install --platform=win64 chromium`,
      );
    }
    const entries = fs.readdirSync(winBrowsersRoot);
    const chromiumRoots = entries
      .map((name) => path.join(winBrowsersRoot, name))
      .filter((p) => /chromium-\d+$/.test(path.basename(p)));
    if (chromiumRoots.length === 0) {
      fail(`win-x64 Chromium 目录下未找到 chromium-*：${winBrowsersRoot}`);
    }
    // 必须选与 backend playwright browsers.json 的 chromium.revision 匹配的目录。
    // readdir 字母序 [0] 会拿到旧 revision（2026-08-20 实测：选了 1223=v148 而
    // playwright 1.63 要 1237，版本不匹配导致 Windows 真机 CDP 空白页）。
    let expectedRevision = '';
    try {
      const browsersJson = JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, 'backend', 'node_modules', 'playwright-core', 'browsers.json'),
          'utf8',
        ),
      );
      const item = (browsersJson.browsers || []).find((b) => b.name === 'chromium');
      expectedRevision = item ? String(item.revision) : '';
    } catch (error) {
      console.warn(`读取 browsers.json 失败，退回字母序首个: ${error.message}`);
    }
    const matched = chromiumRoots.find((p) =>
      path.basename(p) === `chromium-${expectedRevision}`,
    );
    if (!matched && expectedRevision) {
      fail(
        `win-x64 Chromium revision 不匹配：playwright 期望 chromium-${expectedRevision}，` +
          `${winBrowsersRoot} 里只有 ${chromiumRoots.map((p) => path.basename(p)).join(', ')}。` +
          `请下载对应版本：https://storage.googleapis.com/chrome-for-testing-public/<browserVersion>/win64/chrome-win64.zip`,
      );
    }
    const browserRoot = matched || chromiumRoots[0];
    if (!matched) {
      console.warn(`未找到期望 revision ${expectedRevision}，使用字母序首个：${path.basename(browserRoot)}`);
    }
    fs.rmSync(targetChromiumRoot, { recursive: true, force: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.cpSync(browserRoot, targetChromiumRoot, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    const chromeWin =
      path.join(targetChromiumRoot, 'chrome-win64', 'chrome.exe');
    const chromeFlat = path.join(targetChromiumRoot, 'chrome.exe');
    if (!fs.existsSync(chromeWin) && !fs.existsSync(chromeFlat)) {
      fail(`win-x64 Chromium 缺少 chrome.exe（chrome-win64/ 或根目录）：${targetChromiumRoot}`);
    }
    console.log(`Bundled Playwright Chromium (win-x64): ${path.relative(repoRoot, chromeWin)}`);
    return;
  }

  const executablePath = resolvePlaywrightChromiumExecutable();
  const browserRoot = findBrowserRoot(executablePath);

  fs.rmSync(targetChromiumRoot, { recursive: true, force: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.cpSync(browserRoot, targetChromiumRoot, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    preserveTimestamps: true,
  });

  const relativeExecutable = path.relative(browserRoot, executablePath);
  const copiedExecutable = path.join(targetChromiumRoot, relativeExecutable);
  if (!fs.existsSync(copiedExecutable)) {
    fail(`Copied Playwright Chromium executable is missing: ${copiedExecutable}`);
  }

  console.log(`Bundled Playwright Chromium: ${path.relative(repoRoot, copiedExecutable)}`);
}

main();
