'use strict';
/**
 * browser-panel-broker.spec.js — Broker 会话/权限契约的纯 node 测试（负向用例）
 * 运行：node desktop/browser-panel-broker.spec.js
 */
const assert = require('node:assert/strict');
const { BrowserPanelBroker } = require('./browser-panel-broker');

function fakeWebContents(overrides = {}) {
  return {
    id: 101,
    url: 'http://127.0.0.1:9/foo',
    on: () => () => undefined,
    setWindowOpenHandler: () => undefined,
    debugger: {
      attach: () => undefined,
      isAttached: () => true,
      sendCommand: async (method) => ({ echo: method }),
      detach: () => undefined,
    },
    ...overrides,
  };
}

function setup() {
  const wcs = new Map();
  const broker = new BrowserPanelBroker({
    webContentsResolver: (panelId) => wcs.get(panelId) || null,
  });
  const created = broker.createPanel({
    panelId: 'panel-1',
    sessionId: 'sess-1',
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    platform: 'general-web',
  });
  wcs.set('panel-1', fakeWebContents());
  return { broker, wcs, created };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('同页绑定：resolveTarget 返回三方一致 id', () => {
  const { broker, created } = setup();
  const target = broker.resolveTarget(created.panelId, created.capabilityToken);
  assert.equal(target.panelId, 'panel-1');
  assert.equal(target.sessionId, 'sess-1');
  assert.equal(target.webContentsId, 101);
});

test('错 token 拒绝（fail-closed）', () => {
  const { broker, created } = setup();
  assert.throws(
    () => broker.resolveTarget(created.panelId, 'wrong-token'),
    /capability token 无效/,
  );
});

test('token 过期拒绝', () => {
  let now = Date.now();
  const wcs = new Map();
  const broker = new BrowserPanelBroker({
    now: () => now,
    tokenTtlMs: 100,
    webContentsResolver: (p) => wcs.get(p) || null,
  });
  const created = broker.createPanel({
    panelId: 'p',
    sessionId: 's',
    ownerId: 'o',
    tenantId: 't',
  });
  wcs.set('p', fakeWebContents());
  now += 200;
  assert.throws(
    () => broker.resolveTarget(created.panelId, created.capabilityToken),
    /已过期/,
  );
});

test('页面目标丢失 → blocked 状态 + 抛错', () => {
  const { broker, wcs, created } = setup();
  wcs.delete('panel-1');
  assert.throws(
    () => broker.resolveTarget(created.panelId, created.capabilityToken),
    /目标丢失/,
  );
  assert.throws(() => broker.listEvents('panel-1', 'x'), /面板不存在|无效/);
});

test('CDP 白名单外方法拒绝', async () => {
  const { broker, created } = setup();
  await assert.rejects(
    () =>
      broker.sendCDP(
        created.panelId,
        created.capabilityToken,
        'Network.getAllCookies',
      ),
    /不在白名单/,
  );
});

test('写动作无审批拒绝；request→approve→放行一次', async () => {
  const { broker, created } = setup();
  await assert.rejects(
    () =>
      broker.sendCDP(
        created.panelId,
        created.capabilityToken,
        'Input.dispatchMouseEvent',
      ),
    /需要审批/,
  );
  const { actionId } = broker.requestAction(
    created.panelId,
    created.capabilityToken,
    'Input.dispatchMouseEvent',
    { label: '点击 +1' },
  );
  broker.approveAction(
    actionId,
    created.capabilityToken,
    created.capabilityToken,
  );
  const done = await broker.sendCDP(
    created.panelId,
    created.capabilityToken,
    'Input.dispatchMouseEvent',
    {},
    { approvedActionId: actionId },
  );
  assert.equal(done.result.echo, 'Input.dispatchMouseEvent');
  // 确认单一次性：重放拒绝
  await assert.rejects(
    () =>
      broker.sendCDP(
        created.panelId,
        created.capabilityToken,
        'Input.dispatchMouseEvent',
        {},
        { approvedActionId: actionId },
      ),
    /需要审批/,
  );
});

test('确认单绑定失效：页面目标变化后旧确认单不可用', async () => {
  const { broker, wcs, created } = setup();
  const { actionId } = broker.requestAction(
    created.panelId,
    created.capabilityToken,
    'Input.dispatchMouseEvent',
    null,
  );
  broker.approveAction(
    actionId,
    created.capabilityToken,
    created.capabilityToken,
  );
  // 页面换成了另一个 webContents
  wcs.set('panel-1', fakeWebContents({ id: 202 }));
  await assert.rejects(
    () =>
      broker.sendCDP(
        created.panelId,
        created.capabilityToken,
        'Input.dispatchMouseEvent',
        {},
        { approvedActionId: actionId },
      ),
    /需要审批/,
  );
});

test('批准人必须与 owner 一致', () => {
  const { broker, created } = setup();
  const { actionId } = broker.requestAction(
    created.panelId,
    created.capabilityToken,
    'Input.dispatchMouseEvent',
    null,
  );
  assert.throws(
    () =>
      broker.approveAction(
        actionId,
        created.capabilityToken,
        'not-the-owner',
      ),
    /面板所有者/,
  );
});

test('跨用户不可见：B 拿不到 A 的面板', () => {
  const { broker } = setup();
  const createdB = broker.createPanel({
    panelId: 'panel-b',
    sessionId: 'sess-b',
    ownerId: 'user-b',
    tenantId: 'tenant-b',
  });
  assert.throws(
    () =>
      broker.resolveTarget('panel-1', createdB.capabilityToken),
    /token 无效/,
  );
});

test('事件流完整：动作产生 started/completed 留痕且带三方 id', async () => {
  const { broker, created } = setup();
  await broker.sendCDP(
    created.panelId,
    created.capabilityToken,
    'Runtime.evaluate',
  );
  const events = broker.listEvents(
    created.panelId,
    created.capabilityToken,
  );
  const types = events.map((e) => e.type);
  assert.ok(types.includes('panel.created'));
  assert.ok(types.includes('observe.started'));
  assert.ok(types.includes('observe.completed'));
  const completed = events.find((e) => e.type === 'observe.completed');
  assert.equal(completed.sessionId, 'sess-1');
  assert.equal(completed.webContentsId, 101);
});

test('非 persist 分区拒绝', () => {
  const broker = new BrowserPanelBroker();
  assert.throws(
    () =>
      broker.createPanel({
        panelId: 'p',
        sessionId: 's',
        ownerId: 'o',
        tenantId: 't',
        partition: 'off-the-record',
      }),
    /持久化分区/,
  );
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
    console.error(`BROKER SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`BROKER SPEC PASSED (${tests.length})`);
  }
})();
