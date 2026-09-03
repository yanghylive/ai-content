'use strict';
/**
 * browser-panel-mode-registry.spec.js — 面板模式开关投递文件的纯 node 测试
 * 运行：node desktop/browser-panel-mode-registry.spec.js
 *
 * 覆盖（与 backend readPanelModeRegistry 的校验逐条对齐，两侧同规则）：
 *  1) 写读闭环：writeMode('on') → readMode 回读 mode/pid/startedAt；
 *  2) 0600 权限落盘 + 存量文件读取时强制收紧；
 *  3) fail-closed：文件缺失 / protocol 错 / mode 非法 / JSON 损坏 /
 *     老化超 7 天 / startedAt 缺失 / pid 已死 → 全部 null；
 *  4) clearMode：删除即回默认 off；
 *  5) env 覆盖：KAYPAL_BROWSER_PANEL_MODE_FILE 优先于 userDataDir。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MODE_FILE_NAME,
  PROTOCOL,
  resolveModePath,
  writeMode,
  readMode,
  clearMode,
} = require('./browser-panel-mode-registry');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mode-registry-'));
}

test('写读闭环：on 文件回读 mode/pid/startedAt/filePath', () => {
  const dir = tmpDir();
  const { filePath, payload } = writeMode({ userDataDir: dir, mode: 'on' });
  assert.equal(path.dirname(filePath), dir);
  assert.equal(path.basename(filePath), MODE_FILE_NAME);
  assert.equal(payload.mode, 'on');
  assert.equal(payload.protocol, PROTOCOL);
  assert.equal(payload.pid, process.pid);
  const got = readMode({ userDataDir: dir });
  assert.ok(got);
  assert.equal(got.mode, 'on');
  assert.equal(got.pid, process.pid);
  assert.equal(got.filePath, filePath);
  assert.equal(typeof got.startedAt, 'string');
});

test('off 文件也能回读（desktop 明确写下的关闭态）', () => {
  const dir = tmpDir();
  writeMode({ userDataDir: dir, mode: 'off' });
  assert.equal(readMode({ userDataDir: dir }).mode, 'off');
});

test('0600 落盘 + 存量 0644 文件读取时强制收紧', () => {
  const dir = tmpDir();
  const { filePath } = writeMode({ userDataDir: dir, mode: 'on' });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600, `应 0600，实际 ${fs.statSync(filePath).mode.toString(8)}`);
    // 模拟历史遗留的宽权限文件
    fs.chmodSync(filePath, 0o644);
    assert.ok(readMode({ userDataDir: dir }), '0644 存量文件内容合法仍应可读');
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600, '读取时必须收紧到 0600');
  }
});

const BAD_MODES = [
  { name: 'protocol 错', payload: { version: 1, protocol: 'kaypal-browser-bridge', mode: 'on', pid: -1, startedAt: new Date().toISOString() } },
  { name: 'mode 非法', payload: { version: 1, protocol: PROTOCOL, mode: 'yes', startedAt: new Date().toISOString() } },
  { name: 'mode 缺失', payload: { version: 1, protocol: PROTOCOL, startedAt: new Date().toISOString() } },
  { name: 'startedAt 缺失', payload: { version: 1, protocol: PROTOCOL, mode: 'on' } },
  { name: 'startedAt 非法', payload: { version: 1, protocol: PROTOCOL, mode: 'on', startedAt: 'not-a-date' } },
  { name: 'pid 非法（0）', payload: { version: 1, protocol: PROTOCOL, mode: 'on', pid: 0, startedAt: new Date().toISOString() } },
  { name: '老化超 7 天', payload: { version: 1, protocol: PROTOCOL, mode: 'on', startedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() } },
];
for (const bad of BAD_MODES) {
  test(`fail-closed：${bad.name} → null`, () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, MODE_FILE_NAME), JSON.stringify(bad.payload));
    assert.equal(readMode({ userDataDir: dir }), null, bad.name);
  });
}

test('fail-closed：JSON 损坏 → null；文件缺失 → null；根不是对象 → null', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, MODE_FILE_NAME), '{oops');
  assert.equal(readMode({ userDataDir: dir }), null);
  assert.equal(readMode({ userDataDir: tmpDir() }), null);
  fs.writeFileSync(path.join(dir, MODE_FILE_NAME), '"on"');
  assert.equal(readMode({ userDataDir: dir }), null);
});

test('pid 探活：写文件进程已死 → null（防残留文件把开关永久顶开）', () => {
  const dir = tmpDir();
  // 用一个当前必然不存在的 pid：取 pid 上限之外的值（macOS/Linux 均判死）
  writeMode({ userDataDir: dir, mode: 'on', pid: 4_000_000 });
  assert.equal(readMode({ userDataDir: dir }), null, '不存在的 pid 应判死');
  // checkPid=false 可关掉探活（诊断用途）
  writeMode({ userDataDir: dir, mode: 'on', pid: 4_000_000 });
  assert.ok(readMode({ userDataDir: dir, checkPid: false }), 'checkPid=false 应跳过探活');
});

test('clearMode：删除即回默认 off；幂等（重复清理返回 false）', () => {
  const dir = tmpDir();
  writeMode({ userDataDir: dir, mode: 'on' });
  assert.equal(clearMode({ userDataDir: dir }), true);
  assert.equal(readMode({ userDataDir: dir }), null);
  assert.equal(clearMode({ userDataDir: dir }), false);
});

test('resolveModePath：userDataDir 缺失且无 env → 抛错（不静默落 cwd）', () => {
  const prev = process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
  delete process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
  try {
    assert.throws(() => resolveModePath(''), /userDataDir 必填/);
  } finally {
    if (prev === undefined) delete process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
    else process.env.KAYPAL_BROWSER_PANEL_MODE_FILE = prev;
  }
});

test('writeMode：mode 非 on/off → 抛错（写入侧就不给垃圾值过）', () => {
  const dir = tmpDir();
  assert.throws(() => writeMode({ userDataDir: dir, mode: 'yes' }), /on\/off/);
});

test('env 覆盖：KAYPAL_BROWSER_PANEL_MODE_FILE 优先于 userDataDir', () => {
  const dir = tmpDir();
  const other = tmpDir();
  const prev = process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
  process.env.KAYPAL_BROWSER_PANEL_MODE_FILE = path.join(other, MODE_FILE_NAME);
  try {
    writeMode({ userDataDir: dir, mode: 'on' });
    assert.equal(fs.existsSync(path.join(dir, MODE_FILE_NAME)), false, '不应写进 userDataDir');
    assert.ok(readMode({ userDataDir: other }), 'env 指向的文件应生效');
  } finally {
    if (prev === undefined) delete process.env.KAYPAL_BROWSER_PANEL_MODE_FILE;
    else process.env.KAYPAL_BROWSER_PANEL_MODE_FILE = prev;
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
    console.error(`MODE REGISTRY SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`MODE REGISTRY SPEC PASSED (${tests.length})`);
  }
})();
