#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const desktopRoot = path.resolve(__dirname, '..');
const resourcesRoot = path.join(desktopRoot, 'dist', 'win-unpacked', 'resources');
const backendRoot = path.join(resourcesRoot, 'backend');
const nodeBin = path.join(resourcesRoot, 'runtime', 'node', 'bin', 'node.exe');
const backendEntry = path.join(backendRoot, 'index.js');
const sqliteSeed = path.join(backendRoot, 'prisma', 'seed.db');
const prismaEngine = path.join(backendRoot, 'client', 'query_engine-windows.dll.node');
const timeoutMs = Number(process.env.KAYPAL_PACKAGED_BACKEND_SMOKE_TIMEOUT_MS || 90_000);

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} missing: ${filePath}`);
  }
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('failed to allocate backend smoke port'));
        else resolve(port);
      });
    });
  });
}

function requestSetupStatus(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/auth/setup-status',
      timeout: 2_000,
    }, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
        resolve(response.statusCode);
      } else {
        reject(new Error(`HTTP ${response.statusCode || 'unknown'}`));
      }
    });
    request.on('timeout', () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('packaged backend smoke test must run on Windows');
  }
  assertFile(nodeBin, 'bundled Node runtime');
  assertFile(backendEntry, 'packaged backend entry');
  assertFile(sqliteSeed, 'packaged SQLite seed');
  assertFile(prismaEngine, 'packaged Prisma engine');

  const port = await availablePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jiuzhang-packaged-backend-'));
  const databasePath = path.join(tempRoot, 'kaypal-ai.sqlite');
  const browserRuntimeRoot = path.join(tempRoot, 'browser-runtime');
  const runtimeDataRoot = path.join(tempRoot, 'runtime-data');
  fs.copyFileSync(sqliteSeed, databasePath);
  for (const directory of [
    path.join(browserRuntimeRoot, 'profiles'),
    path.join(browserRuntimeRoot, 'evidence'),
    path.join(runtimeDataRoot, 'materials'),
    path.join(runtimeDataRoot, 'cookiesFile'),
    path.join(runtimeDataRoot, 'avatars'),
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  const childEnv = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    SQLITE_DATABASE_URL: databaseUrl,
    KAYPAL_DESKTOP_DATABASE_MODE: 'sqlite',
    KAYPAL_DESKTOP_USER_DATA_DIR: tempRoot,
    KAYPAL_CREDENTIAL_MASTER_KEY: `base64:${crypto.randomBytes(32).toString('base64')}`,
    KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
    KAYPAL_NODE_AGENT_RUNTIME: '1',
    KAYPAL_RUNTIME_SHARED_SECRET: 'packaged-backend-smoke-secret',
    KAYPAL_AGENT_S_TOKEN: 'packaged-backend-smoke-secret',
    // 2026-08-31（CI run 33398306023 实证）：agent-gateway 模块守卫——非 dev 环境
    // 无 AGENT_GATEWAY_SECRET 直接启动失败。真实安装由 main.js 启动注入，冒烟
    // 模拟同一契约（随机值，不落盘）；本机真机此前靠开发态 .env 残留通过。
    AGENT_GATEWAY_SECRET: crypto.randomBytes(32).toString('hex'),
    REDIS_DISABLED: 'true',
    AUTO_START_KAYPAL_RUNTIME: 'false',
    CORS_ORIGIN: 'http://127.0.0.1:3010',
    PRISMA_CLIENT_ENGINE_TYPE: 'library',
    PRISMA_QUERY_ENGINE_LIBRARY: prismaEngine,
    PLAYWRIGHT_BROWSERS_PATH: path.join(resourcesRoot, 'playwright-browsers'),
    KAYPAL_PLAYWRIGHT_BROWSERS_PATH: path.join(resourcesRoot, 'playwright-browsers'),
    PLAYWRIGHT_MCP_CLI_PATH: path.join(backendRoot, 'node_modules', '@playwright', 'mcp', 'cli.js'),
    LOCAL_BROWSER_PROFILE_ROOT: path.join(browserRuntimeRoot, 'profiles'),
    KAYPAL_BROWSER_BRIDGE_PROFILE_ROOT: path.join(browserRuntimeRoot, 'profiles'),
    LOCAL_BROWSER_EVIDENCE_ROOT: path.join(browserRuntimeRoot, 'evidence'),
    AUTO_UPLOAD_MATERIALS_DIR: path.join(runtimeDataRoot, 'materials'),
    AUTO_UPLOAD_COOKIES_DIR: path.join(runtimeDataRoot, 'cookiesFile'),
    AUTO_UPLOAD_AVATARS_DIR: path.join(runtimeDataRoot, 'avatars'),
    LEGACY_AUTO_UPLOAD_ROOT: path.join(runtimeDataRoot, 'legacy-auto-upload'),
  };

  const child = spawn(nodeBin, [backendEntry], {
    cwd: backendRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let outputTail = '';
  let exit = null;
  const collect = (chunk) => {
    outputTail = `${outputTail}${chunk.toString()}`.slice(-24_000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });

  const startedAt = Date.now();
  try {
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
      if (exit) {
        throw new Error(`packaged backend exited code=${exit.code} signal=${exit.signal || 'none'}`);
      }
      try {
        const statusCode = await requestSetupStatus(port);
        console.log(`Packaged backend smoke passed in ${Date.now() - startedAt}ms (HTTP ${statusCode}).`);
        return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`packaged backend readiness timed out after ${timeoutMs}ms: ${lastError?.message || 'unknown'}`);
  } catch (error) {
    const cleanOutput = outputTail.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    throw new Error(`${error.message}\n--- packaged backend output tail ---\n${cleanOutput}`);
  } finally {
    await stopProcess(child);
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
