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
  run('Build frontend static export', 'npm', ['run', 'build'], {
    cwd: frontendRoot,
    env: {
      NEXT_PUBLIC_API_BASE: 'http://localhost:3011/api',
      KAYPAL_SKIP_NEXT_BUILD_LINT: '1',
      KAYPAL_SKIP_NEXT_BUILD_TYPECHECK: '1',
    },
  });

  run('Build backend bundle', 'npm', ['run', 'build:bundle'], {
    cwd: backendRoot,
  });

  run('Set Prisma Windows engine target', 'node', ['scripts/prepare-prisma-engines.js', 'set'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });

  try {
    run('Generate Prisma Windows client', 'npx', ['prisma', 'generate'], {
      cwd: backendRoot,
    });

    run('Prune Prisma engines for Windows package', 'node', ['scripts/prepare-prisma-engines.js', 'prune'], {
      cwd: desktopRoot,
      env: { BUILD_PLATFORM: 'win-x64' },
    });
  } finally {
    run('Restore Prisma schema', 'node', ['scripts/prepare-prisma-engines.js', 'restore'], {
      cwd: desktopRoot,
      env: { BUILD_PLATFORM: 'win-x64' },
    });
  }

  run('Smoke Agent-S sidecar before packaging', 'node', ['scripts/smoke-agent-s-sidecar.js'], {
    cwd: desktopRoot,
  });

  run('Prepare Python wheelhouse (offline pip deps)', 'node', ['scripts/prepare-wheelhouse.js'], {
    cwd: desktopRoot,
  });

  run('Check commercial assets', 'node', ['scripts/check-commercial-assets.js'], {
    cwd: desktopRoot,
  });

  run('Check full installer assets before packaging', 'node', ['scripts/check-full-installer-assets.js', '--phase=pre'], {
    cwd: desktopRoot,
  });

  run('Build Windows installer', 'npx', ['electron-builder', '--win'], {
    cwd: desktopRoot,
  });

  run('Check full installer assets after packaging', 'node', ['scripts/check-full-installer-assets.js', '--phase=post'], {
    cwd: desktopRoot,
  });

  run('Check release size', 'node', ['scripts/check-release-size.js'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });
}

main();
