#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const targetRoot = path.join(desktopRoot, 'runtime', 'playwright-browsers');
const targetChromiumRoot = path.join(targetRoot, 'chromium');
const cacheRoot = path.join(desktopRoot, '.runtime-cache', 'playwright-browsers');

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
  return fs.existsSync(executablePath) ? executablePath : null;
}

function downloadBrowserRoot(targetPlatform, browserVersion) {
  const spec = {
    darwin: ['mac-arm64', 'chrome-mac-arm64'],
    'mac-arm64': ['mac-arm64', 'chrome-mac-arm64'],
    'mac-x64': ['mac-x64', 'chrome-mac'],
    win32: ['win64', 'chrome-win64'],
    'win-x64': ['win64', 'chrome-win64'],
    linux: ['linux64', 'chrome-linux64'],
    'linux-x64': ['linux64', 'chrome-linux64'],
  }[targetPlatform];
  if (!spec) return null;
    const [archivePlatform, extractedName] = spec;
    const archiveName = `chrome-${archivePlatform}.zip`;
  const versionRoot = path.join(cacheRoot, `chromium-${browserVersion}-${archivePlatform}`);
  const archivePath = path.join(cacheRoot, archiveName);
  const extractionRoot = archivePlatform === 'win64'
    ? path.join(versionRoot, `chromium-${browserVersion}`)
    : versionRoot;
  const extractedRoot = path.join(extractionRoot, extractedName);
  fs.mkdirSync(cacheRoot, { recursive: true });
  if (!fs.existsSync(extractedRoot)) {
    const url = `https://storage.googleapis.com/chrome-for-testing-public/${browserVersion}/${archivePlatform}/${archiveName}`;
    console.log(`Downloading Chrome for Testing ${browserVersion} (${archivePlatform})`);
    execFileSync('curl', ['-fL', '--retry', '3', '-o', archivePath, url], { stdio: 'inherit' });
    fs.mkdirSync(extractionRoot, { recursive: true });
    execFileSync('unzip', ['-q', '-o', archivePath, '-d', extractionRoot], { stdio: 'inherit' });
  }
  return fs.existsSync(extractedRoot) ? versionRoot : null;
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
  const targetPlatform =
    process.env.BUILD_PLATFORM ||
    (process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'mac-arm64'
        : 'mac-x64'
      : process.platform === 'win32'
        ? 'win-x64'
        : process.platform === 'linux'
          ? 'linux-x64'
          : process.platform);
  // win 交叉构建：从 PLAYWRIGHT_WIN_BROWSERS 目录（playwright install --platform=win64 产物）复制
  if (targetPlatform === 'win-x64' && process.platform !== 'win32') {
    let winBrowsersRoot =
      process.env.PLAYWRIGHT_WIN_BROWSERS || path.join(repoRoot, 'kaypal-ai', '.runtime', 'playwright-browsers-win');
    if (!fs.existsSync(winBrowsersRoot)) {
      let browserVersion = '';
      try {
        const browsersJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'backend', 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
        browserVersion = String((browsersJson.browsers || []).find((b) => b.name === 'chromium')?.browserVersion || '');
      } catch (error) {
        fail(`读取 win-x64 Chromium 版本失败：${error.message}`);
      }
      winBrowsersRoot = downloadBrowserRoot('win-x64', browserVersion);
    }
    const chromiumRootsFrom = (root) =>
      root && fs.existsSync(root)
        ? fs.readdirSync(root)
            .map((name) => path.join(root, name))
            .filter((p) => /chromium-\d+$/.test(path.basename(p)))
        : [];
    const copyWinBrowserRoot = (root) => {
      if (!root || !fs.existsSync(root)) return false;
      const stack = [root];
      let chromeRoot = null;
      while (stack.length) {
        const current = stack.pop();
        const candidate = path.join(current, 'chrome.exe');
        if (fs.existsSync(candidate) && path.basename(current) === 'chrome-win64') {
          chromeRoot = current;
          break;
        }
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (entry.isDirectory()) stack.push(path.join(current, entry.name));
        }
      }
      if (!chromeRoot) return false;
      fs.rmSync(targetChromiumRoot, { recursive: true, force: true });
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.cpSync(chromeRoot, path.join(targetChromiumRoot, 'chrome-win64'), { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true });
      console.log(`Bundled Playwright Chromium (win-x64): ${path.relative(repoRoot, path.join(targetChromiumRoot, 'chrome-win64', 'chrome.exe'))}`);
      return true;
    };
    if (copyWinBrowserRoot(winBrowsersRoot)) return;
    let chromiumRoots = chromiumRootsFrom(winBrowsersRoot);
    if (chromiumRoots.length === 0 && !process.env.PLAYWRIGHT_WIN_BROWSERS) {
      let browserVersion = '';
      try {
        const browsersJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'backend', 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
        browserVersion = String((browsersJson.browsers || []).find((b) => b.name === 'chromium')?.browserVersion || '');
      } catch (error) {
        fail(`读取 win-x64 Chromium 版本失败：${error.message}`);
      }
      winBrowsersRoot = downloadBrowserRoot('win-x64', browserVersion);
      if (copyWinBrowserRoot(winBrowsersRoot)) return;
      chromiumRoots = chromiumRootsFrom(winBrowsersRoot);
    }
    if (chromiumRoots.length === 0) {
      fail(`win-x64 Chromium 未就绪：${winBrowsersRoot || '<download failed>'}`);
    }
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

  let executablePath = resolvePlaywrightChromiumExecutable();
  let browserRoot = executablePath ? findBrowserRoot(executablePath) : null;
  if (!browserRoot) {
    let browserVersion = '';
    try {
      const browsersJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'backend', 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
      browserVersion = String((browsersJson.browsers || []).find((b) => b.name === 'chromium')?.browserVersion || '');
    } catch (error) {
      fail(`读取 Playwright Chromium 版本失败：${error.message}`);
    }
    browserRoot = downloadBrowserRoot(targetPlatform, browserVersion);
    if (!browserRoot) fail(`无法准备 Playwright Chromium：${targetPlatform} ${browserVersion}`);
    const isWindows = targetPlatform === 'win32' || targetPlatform === 'win-x64';
    const isMac = targetPlatform === 'darwin' || targetPlatform === 'mac-arm64' || targetPlatform === 'mac-x64';
    const archivePlatform = isWindows ? 'win64' : isMac ? (targetPlatform === 'mac-x64' ? 'mac-x64' : 'mac-arm64') : 'linux64';
    const extractedName = isWindows ? 'chrome-win64' : isMac ? (targetPlatform === 'mac-x64' ? 'chrome-mac' : 'chrome-mac-arm64') : 'chrome-linux64';
    const executableName = isWindows ? 'chrome.exe' : isMac ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' : 'chrome';
    executablePath = path.join(browserRoot, extractedName, executableName);
  }

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
