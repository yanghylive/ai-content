import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, '..');
const rootDir = path.resolve(desktopDir, '..');
const playwrightRequire = createRequire(path.join(rootDir, 'backend', 'package.json'));
const electronRequire = createRequire(path.join(desktopDir, 'package.json'));
const { _electron: electron } = playwrightRequire('playwright');
const executablePath = electronRequire('electron');

const protocol = 'jiuzhang-local-bridge';
const version = 1;
const actions = [
  'JZ_BRIDGE_CHECK_STATUS',
  'JZ_BRIDGE_LIST_CAPABILITIES',
  'JZ_BRIDGE_LIST_ACCOUNTS',
];
const actionByPath = new Map([
  ['/api/local-bridge/status', actions[0]],
  ['/api/local-bridge/capabilities', actions[1]],
  ['/api/local-bridge/accounts', actions[2]],
]);
const statusFixture = {
  online: true,
  status: 'ok',
  service: protocol,
  version: 'e2e',
  protocolVersion: version,
  actions,
  checkedAt: new Date(0).toISOString(),
};
const capabilitiesFixture = [{
  platform: 'e2e',
  displayName: 'E2E',
  contentKinds: ['article'],
  executionModes: ['cdp'],
  supportsSchedule: false,
  supportsDraft: false,
  supportsCover: false,
  supportsReadback: false,
  supportsAccountDetection: true,
  riskLevel: 'high',
  adapterVersion: 'e2e',
}];
const rawAccountsFixture = [{
  id: 'e2e:1',
  platform: 'e2e',
  displayName: 'E2E',
  accountName: 'fixture',
  status: 'ready',
  statusLabel: 'ready',
  avatarUrl: null,
  lastCheckedAt: null,
  token: 'token-lure-must-not-leak',
  cookie: 'cookie-lure-must-not-leak',
  filePath: '/private/lure-must-not-leak.json',
}];
const accountsFixture = rawAccountsFixture.map(({
  token: _token,
  cookie: _cookie,
  filePath: _filePath,
  ...account
}) => account);
const mockFixtures = new Map([
  [actions[0], statusFixture],
  [actions[1], capabilitiesFixture],
  [actions[2], rawAccountsFixture],
]);
const expectedRendererFixtures = new Map([
  [actions[0], statusFixture],
  [actions[1], capabilitiesFixture],
  [actions[2], accountsFixture],
]);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kaypal-electron-e2e-'));
const seen = [];
const pageErrors = [];
const mock = http.createServer((request, response) => {
  if (request.url === '/api/auth/setup-status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
    return;
  }

  const action = actionByPath.get(request.url);
  const traceId = request.headers['x-jiuzhang-trace-id'];
  if (!action || typeof traceId !== 'string') {
    response.writeHead(404);
    response.end();
    return;
  }

  seen.push({ method: request.method, url: request.url, traceId });
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
  });
  response.end(JSON.stringify({
    protocol,
    version,
    type: 'response',
    traceId,
    action,
    ok: true,
    code: 200,
    message: 'ok',
    data: mockFixtures.get(action),
    timestamp: Date.now(),
  }));
});

let application;
let mockListening = false;
let cleaned = false;

async function closeMock() {
  if (!mockListening) return;
  await new Promise((resolve, reject) => {
    mock.close((error) => error ? reject(error) : resolve());
  });
  mockListening = false;
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await application?.close().catch(() => {});
  await closeMock().catch(() => {});

  const resolvedTempRoot = path.resolve(os.tmpdir());
  const resolvedTempDir = path.resolve(tempDir);
  assert.equal(path.dirname(resolvedTempDir), resolvedTempRoot, '拒绝删除不在 os.tmpdir() 直属目录中的路径');
  assert.match(path.basename(resolvedTempDir), /^kaypal-electron-e2e-/, '拒绝删除名称不安全的临时目录');
  await fs.rm(resolvedTempDir, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  });
}

try {
  await new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen({ host: '::', port: 3011, ipv6Only: false, exclusive: true }, () => {
      mock.off('error', reject);
      mockListening = true;
      resolve();
    });
  });

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    KAYPAL_E2E_MODE: '1',
    KAYPAL_E2E_USER_DATA_DIR: tempDir,
    KAYPAL_NODE_AGENT_RUNTIME: '1',
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
  };
  for (const key of [
    'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
  ]) {
    delete env[key];
  }

  application = await electron.launch({
    executablePath,
    args: [desktopDir, '--no-proxy-server', '--disable-background-networking'],
    cwd: desktopDir,
    env,
    timeout: 30_000,
  });

  const context = application.context();
  await context.route('http://localhost:3010/__electron_local_bridge_e2e__', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>Local Bridge E2E</title></head><body></body></html>',
  }));

  const page = await application.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('http://localhost:3010/__electron_local_bridge_e2e__');

  const actualUserDataDir = await application.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(actualUserDataDir, tempDir, 'Electron userData 未精确隔离到测试临时目录');

  const results = await page.evaluate(async ({ protocol, version, actions }) => {
    const send = (action, timeoutMs = 5_000) => new Promise((resolve, reject) => {
      const traceId = `e2e-${action.toLowerCase()}`;
      const timeout = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error(`等待 ${action} 响应超时`));
      }, timeoutMs);
      const onMessage = (event) => {
        const response = event.data;
        if (
          event.source === window
          && event.origin === window.location.origin
          && response?.type === 'response'
          && response.traceId === traceId
          && response.action === action
        ) {
          clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(response);
        }
      };
      window.addEventListener('message', onMessage);
      const nonce = Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      window.postMessage({
        protocol,
        version,
        type: 'request',
        traceId,
        action,
        timestamp: Date.now(),
        nonce,
        data: {},
      }, window.location.origin);
    });
    return Promise.all(actions.map((action) => send(action)));
  }, { protocol, version, actions });

  assert.equal(results.length, actions.length);
  for (const response of results) {
    assert.equal(response.protocol, protocol);
    assert.equal(response.version, version);
    assert.equal(response.type, 'response');
    assert.equal(response.ok, true);
    assert.equal(response.code, 200);
    assert.deepEqual(response.data, expectedRendererFixtures.get(response.action));
  }
  assert.equal(seen.length, actions.length);
  assert.deepEqual(new Set(seen.map(({ url }) => url)), new Set(actionByPath.keys()));
  assert.ok(seen.every(({ method, traceId }) => (
    method === 'GET' && results.some((response) => response.traceId === traceId)
  )));

  assert.ok(rawAccountsFixture[0].token && rawAccountsFixture[0].cookie && rawAccountsFixture[0].filePath);
  const rendererAccounts = results.find(({ action }) => action === actions[2]).data;
  const rendererAccountsJson = JSON.stringify(rendererAccounts);
  for (const lure of ['token-lure-must-not-leak', 'cookie-lure-must-not-leak', '/private/lure-must-not-leak.json']) {
    assert.equal(rendererAccountsJson.includes(lure), false, `renderer accounts 泄漏敏感诱饵: ${lure}`);
  }
  for (const key of ['token', 'cookie', 'filePath']) {
    assert.equal(Object.hasOwn(rendererAccounts[0], key), false, `renderer accounts 包含敏感字段: ${key}`);
  }

  const seenBeforeUnknownAction = seen.length;
  await page.evaluate(async ({ protocol, version }) => {
    const nonce = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    window.postMessage({
      protocol,
      version,
      type: 'request',
      traceId: 'e2e-unknown-action',
      action: 'JZ_BRIDGE_UNKNOWN_ACTION',
      timestamp: Date.now(),
      nonce,
      data: {},
    }, window.location.origin);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, { protocol, version });
  assert.equal(seen.length, seenBeforeUnknownAction, 'unknown action 不应触达 3011 mock');
  assert.deepEqual(pageErrors, [], `renderer pageerror: ${pageErrors.map(String).join('; ')}`);

  console.log(JSON.stringify({
    ok: true,
    userData: actualUserDataDir,
    actions: results.map(({ action, traceId }) => ({ action, traceId })),
    seen,
    unknownActionForwarded: false,
    sensitiveAccountFieldsLeaked: false,
    pageErrors: [],
  }, null, 2));
} finally {
  await cleanup();
}
