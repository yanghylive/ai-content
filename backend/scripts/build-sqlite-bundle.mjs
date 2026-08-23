#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

// 共享 Prisma client 的生成目录（sqlite / postgres schema 都写这里，必须显式隔离）
const defaultPrismaClientSchema = join(backendRoot, 'node_modules', '.prisma', 'client', 'schema.prisma');

function readDefaultPrismaClientProvider() {
  if (!existsSync(defaultPrismaClientSchema)) return null;
  const text = readFileSync(defaultPrismaClientSchema, 'utf8');
  // 只认 datasource 块里的 provider，跳过 generator client 的 prisma-client-js
  const match = text.match(/datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"([a-z]+)"/s);
  return match ? match[1] : null;
}

// SQLite 与 Postgres client 生成到同一个默认目录（node_modules/.prisma/client），
// 因此构建 SQLite bundle 会临时把共享 client 换成 sqlite 版。任何中途失败都必须
// 还原成 postgresql，否则后续 `npm run build` 会静默拿着 sqlite client 编译通过
// （模型定义一致，tsc 不报错），运行时才连不上 Postgres —— 典型假绿。
function restoreDefaultPrismaClient() {
  if (process.env.KAYPAL_KEEP_SQLITE_PRISMA_CLIENT === '1') {
    console.warn(
      '[build-sqlite-bundle] KAYPAL_KEEP_SQLITE_PRISMA_CLIENT=1：保留 sqlite client，' +
        '本地后续 `npm run build` 的 Prisma client 面向 SQLite，请自行 `npx prisma generate` 还原。',
    );
    return;
  }
  run(npxBin(), ['prisma', 'generate', '--schema', 'prisma/schema.prisma']);
}

function assertDefaultPrismaClientIsPostgres() {
  if (process.env.KAYPAL_KEEP_SQLITE_PRISMA_CLIENT === '1') return;
  const provider = readDefaultPrismaClientProvider();
  if (provider !== 'postgresql') {
    throw new Error(
      `[build-sqlite-bundle] 默认 Prisma client 还原校验失败：期望 postgresql，实际 ${provider ?? '缺失'}。` +
        '请手动执行 `npx prisma generate` 后再运行 `npm run build`。',
    );
  }
  console.log('[build-sqlite-bundle] 默认 Prisma client 已还原为 postgresql');
}

function buildSqliteBundleIntoTmp() {
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
    // sharp 0.35 含原生 libvips 二进制，ncc 打包崩溃（Cannot read properties
    // of undefined (reading 'path')，webpack 解析 prebuilt 二进制路径失败）；
    // external 后运行时从 node_modules require（与 playwright 同模式）
    '--external',
    'sharp',
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
}

// 原子替换：旧正式目录先 rename 成带时间戳的备份，再把 .tmp 顶上。
// 不用 rmSync 直删——正式 bundle 有 600+ 文件，会触发本机批量删除守卫，
// 让脚本卡死在最后一步、造成「构建失败」误判（实际 bundle 已经建好了）。
function promoteTmpToFinal() {
  if (!existsSync(join(sqliteBundleDir, 'index.js'))) {
    throw new Error('SQLite bundle index.js was not produced');
  }

  let backupDir = null;
  if (existsSync(finalBundleDir)) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    backupDir = `${finalBundleDir}.bak-${stamp}`;
    rmSync(backupDir, { recursive: true, force: true });
    renameSync(finalBundleDir, backupDir);
  }
  renameSync(sqliteBundleDir, finalBundleDir);

  if (backupDir) {
    if (process.env.KAYPAL_PRUNE_OLD_BUNDLE === '1') {
      rmSync(backupDir, { recursive: true, force: true });
      console.log(`[build-sqlite-bundle] 旧 bundle 已删除（KAYPAL_PRUNE_OLD_BUNDLE=1）`);
    } else {
      console.log(`[build-sqlite-bundle] 旧 bundle 备份保留在 ${backupDir}（确认无误后可手动删除）`);
    }
  }
}

try {
  buildSqliteBundleIntoTmp();
} finally {
  // 无论构建成功还是中途抛错，都必须还原共享 Prisma client
  restoreDefaultPrismaClient();
}
assertDefaultPrismaClientIsPostgres();
promoteTmpToFinal();

console.log(`SQLite backend bundle generated at ${finalBundleDir}`);
