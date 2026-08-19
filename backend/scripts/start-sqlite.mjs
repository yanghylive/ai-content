// 一键起 SQLite 桌面模式后端：
//   1. 清代理环境变量（避免沙箱透明代理污染出网 → 上游 400）；
//   2. 构建 SQLite bundle（可 --skip-build 跳过）；
//   3. 启动 dist-bundle-sqlite/index.js（PORT=3011，读桌面 credential-master-key）。
// 用法（在 backend 目录）：
//   npm run start:sqlite            # 构建 + 启动
//   npm run start:sqlite -- --skip-build
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skipBuild = process.argv.includes('--skip-build');
const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const node = process.execPath;

const userDataDir = join(
  homedir(),
  'Library',
  'Application Support',
  'ai-content-desktop',
);
const dbPath = join(userDataDir, 'kaypal-ai.sqlite');
const keyPath = join(userDataDir, 'credential-master-key');

if (!existsSync(keyPath)) {
  console.error(`❌ 缺少 credential-master-key：${keyPath}`);
  process.exit(1);
}
const key = readFileSync(keyPath, 'utf8').trim();

// 清代理（沙箱透明代理会把明文 HTTP 转发到 HTTPS 端口导致 400）
const cleanEnv = { ...process.env };
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
  delete cleanEnv[k];
}

if (!skipBuild) {
  console.log('🔨 构建 SQLite bundle...');
  const r = spawnSync(node, ['scripts/build-sqlite-bundle.mjs'], {
    cwd: backendDir,
    env: cleanEnv,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('❌ SQLite bundle 构建失败');
    process.exit(r.status ?? 1);
  }
}

const env = {
  ...cleanEnv,
  PORT: '3011',
  AUTO_START_KAYPAL_RUNTIME: 'false',
  KAYPAL_DESKTOP_DATABASE_MODE: 'sqlite',
  KAYPAL_DESKTOP_USER_DATA_DIR: userDataDir,
  DATABASE_URL: `file:${dbPath}`,
  SQLITE_DATABASE_URL: `file:${dbPath}`,
  KAYPAL_CREDENTIAL_MASTER_KEY: key,
};

console.log('🚀 启动 SQLite 桌面模式后端（PORT=3011）...');
const child = spawn(node, ['dist-bundle-sqlite/index.js'], {
  cwd: backendDir,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error('❌ 后端启动失败：', error);
  process.exit(1);
});
