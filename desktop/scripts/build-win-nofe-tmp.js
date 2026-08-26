#!/usr/bin/env node
// 临时脚本：复用现有 frontend/out 产物，跳过前端 build。
const { spawnSync } = require('child_process');
const path = require('path');
const desktopRoot = path.resolve(__dirname, '..');
const backendRoot = path.join(desktopRoot, '..', 'backend');
function run(label, command, args, options = {}) {
  console.log(`\n--- ${label} ---`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
function main() {
  if (process.platform !== 'win32' && !process.env.KAYPAL_CROSS_BUILD_WIN) {
    console.error('need KAYPAL_CROSS_BUILD_WIN=1');
    process.exit(1);
  }
  run('Build backend SQLite bundle', 'npm', ['run', 'build:bundle:sqlite'], {
    cwd: backendRoot,
    env: { BUILD_PLATFORM: 'win-x64', KAYPAL_KEEP_SQLITE_PRISMA_CLIENT: '1' },
  });
  run('Prune Prisma engines for Windows package', 'node', ['scripts/prepare-prisma-engines.js', 'prune'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });
  run('Prepare bundled Node runtime', 'node', ['scripts/prepare-node-runtime.js'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });
  run('Prepare bundled Playwright Chromium', 'node', ['scripts/prepare-playwright-browsers.js'], {
    cwd: desktopRoot,
  });
}
main();
