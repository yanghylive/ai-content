#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const frontendRoot = path.join(repoRoot, 'frontend');
const backendRoot = path.join(repoRoot, 'backend');

function run(label, command, args, options = {}) {
  console.log(`\n--- ${label} ---`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  if (process.platform !== 'win32' && !process.env.KAYPAL_CROSS_BUILD_WIN) {
    console.error(
      'Windows installer must be built on Windows so Playwright Chromium and native Prisma engines match win-x64.',
    );
    console.error(
      'macOS 交叉构建请设置 KAYPAL_CROSS_BUILD_WIN=1（需自行准备 win-x64 Chromium，见 prepare-playwright-browsers）。',
    );
    process.exit(1);
  }

  run('Build frontend static export', 'npm', ['run', 'build'], {
    cwd: frontendRoot,
    env: {
      NEXT_PUBLIC_API_BASE: 'http://localhost:3011/api',
      KAYPAL_SKIP_NEXT_BUILD_LINT: '1',
      KAYPAL_SKIP_NEXT_BUILD_TYPECHECK: '1',
    },
  });

  run('Build backend SQLite bundle', 'npm', ['run', 'build:bundle:sqlite'], {
    cwd: backendRoot,
    env: {
      BUILD_PLATFORM: 'win-x64',
      KAYPAL_KEEP_SQLITE_PRISMA_CLIENT: '1',
    },
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

  run('Check commercial assets', 'node', ['scripts/check-commercial-assets.js'], {
    cwd: desktopRoot,
  });

  run('Smoke Windows secure credential storage', 'npx', ['electron', 'scripts/smoke-electron-credential-key.js'], {
    cwd: desktopRoot,
  });

  run('Check full installer assets before packaging', 'node', ['scripts/check-full-installer-assets.js', '--phase=pre'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });

  run('Build Windows installer', 'npx', ['electron-builder', '--win'], {
    cwd: desktopRoot,
  });

  run('Check full installer assets after packaging', 'node', ['scripts/check-full-installer-assets.js', '--phase=post'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });

  run('Smoke packaged backend startup', 'node', ['scripts/smoke-packaged-backend.js'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });

  run('Check release size', 'node', ['scripts/check-release-size.js'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });
}

main();
