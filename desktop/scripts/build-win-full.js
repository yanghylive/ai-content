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
      // 单入口改造（v1.1.70）：桌面内置静态服务已做 /api 反代，前端走同源相对路径
      NEXT_PUBLIC_API_BASE: '/api',
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

  // macOS 交叉构建路径下需要补齐 sharp Win 原生包；Windows 真机构建时已天然就位，脚本 no-op
  run('Ensure sharp Win32 native package present', 'node', ['scripts/prepare-sharp-win32.js'], {
    cwd: desktopRoot,
  });

  // 准备 win-x64 ffmpeg/ffprobe（视频发布硬依赖；此前 win 包从未带 media-tools，视频处理断链）
  run('Prepare bundled media tools (ffmpeg/ffprobe)', 'node', ['scripts/prepare-media-tools.js'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });

  run('Check commercial assets', 'node', ['scripts/check-commercial-assets.js'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });

  // Windows 安全凭据存储 smoke：仅在 Windows 真机构建时执行（macOS 交叉构建跳过，凭据存储需 Windows DPAPI）
  if (process.platform === 'win32') {
    run('Smoke Windows secure credential storage', 'npx', ['electron', 'scripts/smoke-electron-credential-key.js'], {
      cwd: desktopRoot,
    });
  } else {
    console.log('\n--- Smoke Windows secure credential storage (skipped on darwin cross-build) ---');
  }

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

  // 打包后端启动 smoke：仅 Windows 真机构建时执行（macOS 交叉构建跳过，需 Windows 启动包内后端）
  if (process.platform === 'win32') {
    run('Smoke packaged backend startup', 'node', ['scripts/smoke-packaged-backend.js'], {
      cwd: desktopRoot,
      env: { BUILD_PLATFORM: 'win-x64' },
    });
  } else {
    console.log('\n--- Smoke packaged backend startup (skipped on darwin cross-build) ---');
  }

  run('Check release size', 'node', ['scripts/check-release-size.js'], {
    cwd: desktopRoot,
    env: { BUILD_PLATFORM: 'win-x64' },
  });
}

main();
