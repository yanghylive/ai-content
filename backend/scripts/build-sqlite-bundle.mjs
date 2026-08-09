#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const backendRoot = process.cwd();
const sqliteBundleDir = join(backendRoot, 'dist-bundle-sqlite');

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

rmSync(sqliteBundleDir, { recursive: true, force: true });

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:prepare:sqlite']);
run(npxBin(), ['prisma', 'generate', '--schema', 'prisma/schema.sqlite.prisma']);
run(npxBin(), [
  'ncc',
  'build',
  'src/main.ts',
  '-o',
  'dist-bundle-sqlite',
  '--quiet',
  '--external',
  'playwright',
  '--external',
  'playwright-core',
]);

copyFileSync(join(backendRoot, 'prisma', 'schema.sqlite.prisma'), join(sqliteBundleDir, 'schema.prisma'));
copyFileSync(join(backendRoot, 'prisma', 'schema.sqlite.prisma'), join(sqliteBundleDir, 'schema.sqlite.prisma'));
copyPrismaEngineForRuntime();
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

console.log(`SQLite backend bundle generated at ${sqliteBundleDir}`);
