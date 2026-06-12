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
