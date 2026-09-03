'use strict';
/**
 * browser-panel-bridge-runtime.spec.js — 桥生命周期编排测试
 * 运行：node desktop/browser-panel-bridge-runtime.spec.js
 *
 * 覆盖（生命周期规则是安全取舍，必须锁死）：
 *  - opened/shown → 起桥 + 写 0600 凭据文件，内容含 endpoint/panelId/webContentsId；
 *  - hidden/destroyed/account-switched → 关桥 + 删凭据文件（磁盘不留残留 token）；
 *  - 关桥后端口释放、旧 token 不可达；
 *  - 每次重新可见都换新端口+新 token（旧凭据自然失效）；
 *  - close 幂等；启动失败不留文件；getUserDataDir 返回 null 时不写文件也不崩。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createBrowserBridgeRuntime } = require('./browser-panel-bridge-runtime');
const { readRegistry } = require('./browser-panel-bridge-registry');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function makeWiring() {
  const session = {
    panelId: 'panel-r',
    sessionId: 'sess-r',
    ownerId: 'local-desktop',
    tenantId: 'local-tenant',
    url: 'http://127.0.0.1/page?token=SECRET&keep=1',
    webContentsId: 88,
  };
  return {
    resolveTargetForAgent(panelId, actor) {
      if (panelId !== 'panel-r') throw new Error('未登记');
      if (!actor || !actor.ownerId) throw new Error('actor 必须携带身份');
      return { ...session };
    },
    async sendCDPForAgent() {
      return { result: { result: { value: JSON.stringify({ title: 'T', text: 'x' }) } } };
    },
    requestActionForAgent() {
      return { actionId: 'act-r', binding: { webContentsId: 88 } };
    },
  };
}

function makeManager(sessionOverride = {}) {
  const session = {
    panelId: 'panel-r',
    sessionId: 'sess-r',
    webContentsId: 88,
    ...sessionOverride,
  };
  return { publicState: () => ({ session }) };
}

function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpb-runtime-'));
  const runtime = createBrowserBridgeRuntime({
    manager: makeManager(opts.session),
    wiring: makeWiring(),
    getUserDataDir: () => (opts.noDir ? null : dir),
    logger: { log: () => {}, warn: () => {} },
  });
  return { dir, runtime };
}

function registryPath(dir) {
  return path.join(dir, 'browser-panel-bridge.json');
}

const crypto = require('node:crypto');

/** 桥要求每次请求都带 token + nonce + 时间戳，缺一即 401 */
function get(port, token, route = '/health') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: route,
        method: 'GET',
        headers: token
          ? {
              'x-kaypal-bridge-token': token,
              'x-kaypal-bridge-nonce': crypto.randomBytes(16).toString('hex'),
              'x-kaypal-bridge-ts': String(Date.now()),
            }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('opened → 起桥 + 写 0600 凭据文件（含 endpoint/panelId/webContentsId）', async () => {
  const { dir, runtime } = setup();
  const result = await runtime.sync({ type: 'opened' });
  assert.equal(result.action, 'started');
  assert.equal(result.wrote, true);

  const filePath = registryPath(dir);
  assert.ok(fs.existsSync(filePath), '凭据文件应存在');
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600, '必须是 0600');

  const cred = readRegistry({ userDataDir: dir });
  assert.ok(cred, '应能读回凭据');
  assert.equal(cred.panelId, 'panel-r');
  assert.equal(cred.sessionId, 'sess-r');
  assert.equal(cred.webContentsId, 88);

  const res = await get(new URL(cred.endpoint).port, cred.token);
  assert.equal(res.status, 200, '桥应可访问');
  await runtime.close();
});

test('hidden → 关桥 + 删凭据文件（磁盘不留残留 token）', async () => {
  const { dir, runtime } = setup();
  await runtime.sync({ type: 'opened' });
  const cred = readRegistry({ userDataDir: dir });
  const port = new URL(cred.endpoint).port;

  const result = await runtime.sync({ type: 'hidden' });
  assert.equal(result.action, 'stopped');
  assert.equal(fs.existsSync(registryPath(dir)), false, '凭据文件必须被删除');
  assert.equal(readRegistry({ userDataDir: dir }), null);

  await assert.rejects(() => get(port, cred.token), /ECONNREFUSED/, '端口应已释放');
});

test('destroyed / account-switched 同样关桥并删文件', async () => {
  for (const type of ['destroyed', 'account-switched']) {
    const { dir, runtime } = setup();
    await runtime.sync({ type: 'opened' });
    await runtime.sync({ type });
    assert.equal(fs.existsSync(registryPath(dir)), false, type);
    assert.equal(runtime.info(), null, type);
  }
});

test('隐藏后重新可见 → 换新端口 + 新 token（旧凭据自然失效）', async () => {
  const { dir, runtime } = setup();
  await runtime.sync({ type: 'opened' });
  const first = readRegistry({ userDataDir: dir });
  await runtime.sync({ type: 'hidden' });
  await runtime.sync({ type: 'shown' });
  const second = readRegistry({ userDataDir: dir });

  assert.notEqual(second.token, first.token, 'token 必须轮换');
  assert.notEqual(second.endpoint, first.endpoint, '端口必须换');

  // 旧 endpoint 已关闭
  await assert.rejects(
    () => get(new URL(first.endpoint).port, first.token),
    /ECONNREFUSED/,
  );
  await runtime.close();
});

test('close 幂等（重复调用不抛）', async () => {
  const { dir, runtime } = setup();
  await runtime.sync({ type: 'opened' });
  await runtime.close();
  await runtime.close();
  await runtime.close();
  assert.equal(fs.existsSync(registryPath(dir)), false);
});

test('getUserDataDir 返回 null：不写文件、不崩、返回 wrote=false', async () => {
  const { runtime } = setup({ noDir: true });
  const result = await runtime.sync({ type: 'opened' });
  assert.equal(result.action, 'started');
  assert.equal(result.wrote, false, '没有 userData 目录就不该写凭据');
  await runtime.close();
});

test('info() 未起桥返回 null；起桥后含 endpoint/token', async () => {
  const { runtime } = setup();
  assert.equal(runtime.info(), null);
  await runtime.sync({ type: 'opened' });
  const info = runtime.info();
  assert.ok(info && info.endpoint && info.token);
  await runtime.close();
  assert.equal(runtime.info(), null);
});

test('并发 sync 串行化：全部事件按序消化、只起一次桥（2026-09-04 语义修订）', async () => {
  const { dir, runtime } = setup();
  const results = await Promise.all([
    runtime.sync({ type: 'opened' }),
    runtime.sync({ type: 'shown' }),
    runtime.sync({ type: 'opened' }),
  ]);
  // 旧实现（布尔守卫）会丢弃并发事件；新实现（串行队列）一个不丢，
  // ensure() 幂等保证只起一次桥（同一 endpoint/token）。
  const started = results.filter((r) => r.action === 'started');
  assert.equal(started.length, 3, '三个事件都应被消化（不丢弃）');
  assert.equal(new Set(started.map((r) => r.endpoint)).size, 1, '只应起一次桥');
  assert.ok(fs.existsSync(registryPath(dir)));
  await runtime.close();
});

test('hide→open 快速连发：hidden 不吞 opened，桥活着且凭据已写回（2026-09-04 真机竞态回归）', async () => {
  const { dir, runtime } = setup();
  await runtime.sync({ type: 'opened' });
  // 真机复现路径：控制条 hide 后脚本立刻 open——'hidden' 的 close 还在飞时
  // 'opened' 已入队。旧实现的 syncing 守卫会直接丢掉 'opened'，
  // 结果 = 桥死 + 凭据文件没写回 + 面板开着但 agent 链路全断。
  const [, openedResult] = await Promise.all([
    runtime.sync({ type: 'hidden' }),
    runtime.sync({ type: 'opened' }),
  ]);
  assert.equal(openedResult.action, 'started', 'opened 不应被 hidden 吞掉');
  assert.ok(fs.existsSync(registryPath(dir)), '凭据文件必须写回');
  const cred = readRegistry({ userDataDir: dir });
  const res = await get(new URL(cred.endpoint).port, cred.token);
  assert.equal(res.status, 200, '新桥应可访问（agent 链路恢复）');
  await runtime.close();
});

/** 单条测试超时保护：挂起必须被抓出来，不能让整个套件静默卡死 */
function withTimeout(promise, ms, name) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`测试超时（${ms}ms）：${name}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await withTimeout(fn(), 10_000, name);
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}: ${error && error.message}`);
    }
  }
  if (failed > 0) {
    console.error(`BRIDGE RUNTIME SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`BRIDGE RUNTIME SPEC PASSED (${tests.length})`);
  }
  process.exit(failed > 0 ? 1 : 0);
})();
