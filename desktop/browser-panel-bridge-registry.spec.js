'use strict';
/**
 * browser-panel-bridge-registry.spec.js — 凭据投递文件（0600）读写测试
 * 运行：node desktop/browser-panel-bridge-registry.spec.js
 *
 * 覆盖：
 *  - 写入即 0600（真实 stat 校验，不是"相信 writeFileSync 的 mode"）；
 *  - 读取：正常往返 / 存量 0644 文件被强制收紧为 0600 / 形状非法 / 非回环 endpoint /
 *    老化 / 缺 startedAt 全部 → null（fail-closed）；
 *  - 目录递归创建；
 *  - clear 删除文件且幂等；
 *  - 环境覆盖 KAYPAL_BROWSER_PANEL_BRIDGE_FILE 生效。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  writeRegistry,
  readRegistry,
  clearRegistry,
  resolveRegistryPath,
  REGISTRY_FILE_NAME,
} = require('./browser-panel-bridge-registry');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bpb-registry-'));
}

test('写入往返：endpoint/token/panelId 完整读回', () => {
  const dir = tmpDir();
  const { filePath } = writeRegistry({
    userDataDir: dir,
    endpoint: 'http://127.0.0.1:54321',
    token: 'tok-abc',
    panelId: 'panel-1',
    sessionId: 'sess-1',
    webContentsId: 77,
  });
  assert.equal(path.basename(filePath), REGISTRY_FILE_NAME);
  const got = readRegistry({ userDataDir: dir });
  assert.ok(got, '应读到凭据');
  assert.equal(got.endpoint, 'http://127.0.0.1:54321');
  assert.equal(got.token, 'tok-abc');
  assert.equal(got.panelId, 'panel-1');
  assert.equal(got.sessionId, 'sess-1');
  assert.equal(got.webContentsId, 77);
  assert.ok(got.ageMs >= 0 && got.ageMs < 5000);
});

test('文件权限必须是 0600（真实 stat 校验）', () => {
  const dir = tmpDir();
  writeRegistry({ userDataDir: dir, endpoint: 'http://127.0.0.1:1', token: 't' });
  const mode = fs.statSync(path.join(dir, REGISTRY_FILE_NAME)).mode & 0o777;
  assert.equal(mode, 0o600, `实际权限 ${mode.toString(8)}，应为 600`);
});

test('存量 0644 文件读取时被强制收紧为 0600（local-mcp-auth 同款修复）', () => {
  const dir = tmpDir();
  const filePath = path.join(dir, REGISTRY_FILE_NAME);
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      protocol: 'kaypal-browser-bridge',
      endpoint: 'http://127.0.0.1:54321',
      token: 'legacy',
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o644 },
  );
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o644, '前置条件：确实是 0644');
  const got = readRegistry({ userDataDir: dir });
  assert.ok(got, '存量文件应可读');
  assert.equal(got.token, 'legacy');
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600, '读取后应被收紧为 0600');
});

test('fail-closed：文件缺失 → null', () => {
  const dir = tmpDir();
  assert.equal(readRegistry({ userDataDir: dir }), null);
});

test('fail-closed：形状非法 / 坏 JSON → null', () => {
  const dir = tmpDir();
  const filePath = path.join(dir, REGISTRY_FILE_NAME);
  fs.writeFileSync(filePath, '{ not json', { mode: 0o600 });
  assert.equal(readRegistry({ userDataDir: dir }), null);

  fs.writeFileSync(filePath, JSON.stringify({ endpoint: 'http://127.0.0.1:1' }), { mode: 0o600 });
  assert.equal(readRegistry({ userDataDir: dir }), null, '缺 token/protocol 应拒');

  fs.writeFileSync(
    filePath,
    JSON.stringify({ protocol: 'other', endpoint: 'http://127.0.0.1:1', token: 't' }),
    { mode: 0o600 },
  );
  assert.equal(readRegistry({ userDataDir: dir }), null, '协议不匹配应拒');
});

test('fail-closed：非回环 endpoint → null（防凭据被写去外部主机）', () => {
  for (const bad of [
    'http://evil.example.com:1234',
    'http://10.0.0.5:1234',
    'http://192.168.1.9:1234',
    'https://127.0.0.1:1234',
  ]) {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, REGISTRY_FILE_NAME),
      JSON.stringify({
        protocol: 'kaypal-browser-bridge',
        endpoint: bad,
        token: 't',
        startedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    assert.equal(readRegistry({ userDataDir: dir }), null, bad);
  }
});

test('fail-closed：老化 / 缺 startedAt → null', () => {
  const dir = tmpDir();
  const filePath = path.join(dir, REGISTRY_FILE_NAME);
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      protocol: 'kaypal-browser-bridge',
      endpoint: 'http://127.0.0.1:1',
      token: 't',
      startedAt: stale,
    }),
    { mode: 0o600 },
  );
  assert.equal(readRegistry({ userDataDir: dir }), null, '超过 1h 应判老化');

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      protocol: 'kaypal-browser-bridge',
      endpoint: 'http://127.0.0.1:1',
      token: 't',
    }),
    { mode: 0o600 },
  );
  assert.equal(readRegistry({ userDataDir: dir }), null, '缺 startedAt 应视为老化');
});

test('目录不存在时递归创建', () => {
  const dir = path.join(tmpDir(), 'nested', 'deeper');
  writeRegistry({ userDataDir: dir, endpoint: 'http://127.0.0.1:1', token: 't' });
  assert.ok(fs.existsSync(path.join(dir, REGISTRY_FILE_NAME)));
});

test('clear 删除文件且幂等；删后读回 null', () => {
  const dir = tmpDir();
  writeRegistry({ userDataDir: dir, endpoint: 'http://127.0.0.1:1', token: 't' });
  assert.equal(clearRegistry({ userDataDir: dir }), true);
  assert.equal(clearRegistry({ userDataDir: dir }), false, '重复清理应返回 false');
  assert.equal(readRegistry({ userDataDir: dir }), null, '清理后不应读到 token');
});

test('环境变量 KAYPAL_BROWSER_PANEL_BRIDGE_FILE 可覆盖路径', () => {
  const dir = tmpDir();
  const custom = path.join(dir, 'custom-bridge.json');
  const original = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
  try {
    process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE = custom;
    assert.equal(resolveRegistryPath('/unused'), custom);
    writeRegistry({ userDataDir: '/unused', endpoint: 'http://127.0.0.1:1', token: 't' });
    assert.ok(fs.existsSync(custom));
    assert.equal(readRegistry({ userDataDir: '/unused' }).token, 't');
  } finally {
    if (original === undefined) delete process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
    else process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE = original;
  }
});

test('resolveRegistryPath：userDataDir 缺失且无 env → 抛错（不静默落 cwd）', () => {
  const original = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
  try {
    delete process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE;
    assert.throws(() => resolveRegistryPath(''), /userDataDir 必填/);
  } finally {
    if (original !== undefined) process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE = original;
  }
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}: ${error && error.message}`);
    }
  }
  if (failed > 0) {
    console.error(`BRIDGE REGISTRY SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`BRIDGE REGISTRY SPEC PASSED (${tests.length})`);
  }
})();
