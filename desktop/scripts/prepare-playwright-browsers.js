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
    const browserRoot = chromiumRoots[0];
    fs.rmSync(targetChromiumRoot, { recursive: true, force: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.cpSync(browserRoot, targetChromiumRoot, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    const chromeWin = path.join(targetChromiumRoot, 'chrome-win64', 'chrome.exe');
    if (!fs.existsSync(chromeWin)) {
      fail(`win-x64 Chromium 缺少 chrome-win64/chrome.exe：${chromeWin}`);
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
