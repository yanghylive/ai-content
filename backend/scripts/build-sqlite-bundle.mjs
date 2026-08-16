#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const backendRoot = process.cwd();
// 构建到 .tmp，成功后原子替换到正式目录——构建失败时不破坏旧 bundle（P0-3）
const finalBundleDir = join(backendRoot, 'dist-bundle-sqlite');
const sqliteBundleDir = join(backendRoot, 'dist-bundle-sqlite.tmp');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env: {
      ...process.env,
      SQLITE_DATABASE_URL: process.env.SQLITE_DATABASE_URL || 'file:./kaypal-ai.sqlite',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function npxBin() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function prismaEngineFileForCurrentPlatform() {
  // 交叉构建：BUILD_PLATFORM 优先（win-x64 → windows 引擎）
  const buildPlatform = process.env.BUILD_PLATFORM;
  if (buildPlatform === 'win-x64' || buildPlatform === 'win-x86') {
    return 'query_engine-windows.dll.node';
  }
  if (buildPlatform === 'mac-arm64') {
    return 'libquery_engine-darwin-arm64.dylib.node';
  }
  if (buildPlatform === 'mac-x64') {
    return 'libquery_engine-darwin.dylib.node';
  }
  if (buildPlatform === 'linux-x64') {
    return 'libquery_engine-debian-openssl-3.0.x.so.node';
  }
  if (process.platform === 'win32') return 'query_engine-windows.dll.node';
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? 'libquery_engine-darwin-arm64.dylib.node'
      : 'libquery_engine-darwin.dylib.node';
  }
  if (process.platform === 'linux') {
    return 'libquery_engine-debian-openssl-3.0.x.so.node';
  }
  return null;
}

function copyPrismaEngineForRuntime() {
  const engineFile = prismaEngineFileForCurrentPlatform();
  if (!engineFile) {
    console.warn(`[build-sqlite-bundle] No Prisma engine mapping for ${process.platform}/${process.arch}`);
    return;
  }

  const source = join(backendRoot, 'node_modules', '.prisma', 'client', engineFile);
  if (!existsSync(source)) {
    throw new Error(`Prisma query engine was not generated: ${source}`);
  }

  const clientDir = join(sqliteBundleDir, 'client');
  mkdirSync(clientDir, { recursive: true });
  copyFileSync(source, join(clientDir, engineFile));
  copyFileSync(source, join(sqliteBundleDir, engineFile));
}

/** 复制各模块 prompts/ 资源（bundle 单文件运行时 __dirname 指向 dist-bundle-sqlite/，
 *  模块代码 loadPrompt('xxx') 按文件名读取 → 平铺复制 + 重名保护） */
function copyPromptsForRuntime() {
  const sourceRoot = join(backendRoot, 'src');
  const targetDir = join(sqliteBundleDir, 'prompts');
  mkdirSync(targetDir, { recursive: true });
  const seen = new Map();
  let copied = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // 只关心 prompts 目录下的文件
      if (!full.replace(/\\/g, '/').includes('/prompts/')) continue;
      if (seen.has(name)) {
        throw new Error(`[build-sqlite-bundle] prompts 文件名冲突: ${name}（${seen.get(name)} 与 ${full}）`);
      }
      seen.set(name, full);
      copyFileSync(full, join(targetDir, name));
      copied += 1;
    }
  };
  walk(sourceRoot);
  console.log(`[build-sqlite-bundle] copied ${copied} prompt files → ${targetDir}`);
}

rmSync(sqliteBundleDir, { recursive: true, force: true });

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:prepare:sqlite']);
run(npxBin(), ['prisma', 'generate', '--schema', 'prisma/schema.sqlite.prisma']);
run(npxBin(), [
  'ncc',
  'build',
  'src/main.ts',
  '-o',
  'dist-bundle-sqlite.tmp',
  '--quiet',
  '--external',
  'playwright',
  '--external',
  'playwright-core',
]);

copyFileSync(join(backendRoot, 'prisma', 'schema.sqlite.prisma'), join(sqliteBundleDir, 'schema.prisma'));
copyFileSync(join(backendRoot, 'prisma', 'schema.sqlite.prisma'), join(sqliteBundleDir, 'schema.sqlite.prisma'));
copyPrismaEngineForRuntime();
copyPromptsForRuntime();
writeFileSync(
  join(sqliteBundleDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'kaypal-ai-content-backend-runtime',
      private: true,
      type: 'commonjs',
      main: 'index.js',
    },
    null,
    2,
  )}\n`,
);

if (process.env.KAYPAL_KEEP_SQLITE_PRISMA_CLIENT !== '1') {
  try {
    run(npxBin(), ['prisma', 'generate', '--schema', 'prisma/schema.prisma']);
  } catch (error) {
    console.error('[build-sqlite-bundle] SQLite bundle was built, but restoring the default Prisma client failed.');
    throw error;
  }
}

if (!existsSync(join(sqliteBundleDir, 'index.js'))) {
  throw new Error('SQLite bundle index.js was not produced');
}

// 原子替换：构建成功后，删旧正式目录并 rename .tmp → 正式
rmSync(finalBundleDir, { recursive: true, force: true });
renameSync(sqliteBundleDir, finalBundleDir);

console.log(`SQLite backend bundle generated at ${finalBundleDir}`);
