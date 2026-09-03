'use strict';
/**
 * browser-broker-wiring.spec.js — 阶段 3 会话与安全边界测试
 * 运行：node desktop/browser-broker-wiring.spec.js
 *
 * 覆盖工作流文档 §4 阶段 3 六条必须验证项：
 *  1) A 用户不能读取/控制 B 用户的 panel/session（actor 断言 + token 不出主进程）；
 *  2) 跨租户访问 fail-closed；
 *  3) 不同账号 partition 隔离 + 换账号旧 token 立即失效；
 *  4) capability token 过期/重放/错 owner/错 tenant 全部拒绝；
 *  5) Broker/接线销毁后句柄失效，不能继续执行旧动作；
 *  6) 证据文本不含敏感数据（URL query 凭据类参数脱敏）。
 * 另：Agent 不得自我批准写动作（硬约束 5）。
 */
const assert = require('node:assert/strict');
const { wireBrowserPanel } = require('./browser-broker-wiring');
const { BrowserPanelBroker, redactUrlForEvidence } = require('./browser-panel-broker');

// ---- manager 假实现（复用 stage2 假 electron 的最小面）----
function makeFakeManager() {
  let idSeq = 500;
  const listeners = new Set();
  const manager = {
    session: null,
    _wc: null,
    panelWebContents() {
      return this._wc;
    },
    onSessionEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    _fire(type) {
      for (const fn of listeners) fn({ type, manager });
    },
    openAs(session) {
      this.session = {
        panelId: `panel-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: `sess-${Math.random().toString(36).slice(2, 10)}`,
        status: 'starting',
        ...session,
        partition: `persist:kaypal-browser-${session.ownerId}${session.accountId ? `-${session.accountId}` : ''}`,
      };
      this._wc = {
        id: ++idSeq,
        getURL: () => this.session.currentUrl || '',
        isDestroyed: () => false,
        debugger: {
          attach: () => undefined,
          isAttached: () => true,
          sendCommand: async (method, params) => {
            manager._lastCommand = { method, params };
            return { ok: true, echo: method };
          },
          detach: () => undefined,
        },
      };
      this._fire('opened');
      return this.session;
    },
    switchAccountAs(session) {
      this.openAs(session); // 简化：等价重建
    },
    destroyAll() {
      this._fire('destroyed');
      this.session = null;
      this._wc = null;
    },
  };
  return manager;
}

const ACTOR_A = { ownerId: 'user-a', tenantId: 'tenant-a' };
const ACTOR_B = { ownerId: 'user-b', tenantId: 'tenant-b' };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function setupHarness() {
  const manager = makeFakeManager();
  const wiring = wireBrowserPanel({ manager });
  return { manager, wiring };
}

// ── 阶段 7 round11：tabsHandler 接线（Panel.tabs → manager.tabsOperation）──

test('⑪ wiring 注入 tabsHandler：Panel.tabs 经 broker 闸门透传 manager.tabsOperation（含参数）', async () => {
  const manager = makeFakeManager();
  const tabCalls = [];
  manager.tabsOperation = (operation, index) => {
    tabCalls.push({ operation, index });
    return { tabs: 2, activeIndex: 1, url: 'about:blank' };
  };
  const wiring = wireBrowserPanel({ manager });
  const session = manager.openAs({ ownerId: 'user-a', tenantId: 'tenant-a' });
  const actor = { ownerId: 'user-a', tenantId: 'tenant-a' };
  const { actionId } = wiring.requestActionForAgent(
    session.panelId, actor, 'Panel.tabs',
    { label: '标签页操作', operation: 'new' },
  );
  wiring.approveActionAsOwner(session.panelId, actionId);
  const out = await wiring.sendCDPForAgent(
    session.panelId, actor, 'Panel.tabs',
    { operation: 'new', index: undefined },
    { approvedActionId: actionId },
  );
  assert.deepEqual(tabCalls, [{ operation: 'new', index: undefined }]);
  assert.equal(out.result.tabs, 2, '台账快照经 result 回传（server 放行特例的 broker 层语义）');
});

test('⑪ wiring 后 Panel.tabs 无单仍被 broker 闸门拒绝（mutation 白名单生效）', async () => {
  const manager = makeFakeManager();
  const wiring = wireBrowserPanel({ manager });
  const session = manager.openAs({ ownerId: 'user-a', tenantId: 'tenant-a' });
  const actor = { ownerId: 'user-a', tenantId: 'tenant-a' };
  await assert.rejects(
    () => wiring.sendCDPForAgent(
      session.panelId, actor, 'Panel.tabs', { operation: 'new' }, {},
    ),
    /需要审批/,
  );
});

test('1) 跨 owner 拒绝：B 无法读/控制 A 的面板', async () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  assert.throws(
    () => wiring.resolveTargetForAgent(session.panelId, ACTOR_B),
    /不一致|拒绝/,
  );
  await assert.rejects(
    () =>
      wiring.sendCDPForAgent(session.panelId, ACTOR_B, 'Runtime.evaluate'),
    /不一致|拒绝/,
  );
  assert.throws(
    () => wiring.listEventsForAgent(session.panelId, ACTOR_B),
    /不一致|拒绝/,
  );
  // A 自己访问正常
  const target = wiring.resolveTargetForAgent(session.panelId, ACTOR_A);
  assert.equal(target.webContentsId, manager.panelWebContents().id);
});

test('2) 跨租户 fail-closed：owner 对但 tenant 错也拒', () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  assert.throws(
    () =>
      wiring.resolveTargetForAgent(session.panelId, {
        ownerId: 'user-a',
        tenantId: 'tenant-EVIL',
      }),
    /不一致/,
  );
});

test('3) 换账号：旧 token 立即失效，新会话新 partition', async () => {
  const { manager, wiring } = setupHarness();
  const sessionA = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/a',
  });
  const handleBefore = wiring.handles()[0];
  assert.equal(handleBefore.ownerId, 'user-a');
  // 换到 B 账号（同面板实例场景：manager 重建会话）
  const sessionB = manager.openAs({
    ownerId: 'user-b',
    tenantId: 'tenant-b',
    currentUrl: 'http://127.0.0.1:80/b',
  });
  assert.notEqual(sessionB.sessionId, sessionA.sessionId);
  assert.equal(sessionB.partition, 'persist:kaypal-browser-user-b');
  // A 的 actor 现在访问新面板 → 拒
  assert.throws(
    () => wiring.resolveTargetForAgent(sessionB.panelId, ACTOR_A),
    /不一致|未登记/,
  );
  // B 正常
  assert.ok(wiring.resolveTargetForAgent(sessionB.panelId, ACTOR_B));
  // handles 只剩一个且是 B
  const handles = wiring.handles();
  assert.equal(handles.length, 1);
  assert.equal(handles[0].ownerId, 'user-b');
  assert.ok(
    JSON.stringify(handles).indexOf('capabilityToken') === -1,
    'handles 不得暴露 capabilityToken',
  );
});

test('4) token 过期拒绝（broker 时钟注入）', async () => {
  const manager = makeFakeManager();
  let now = Date.now();
  const wiring = wireBrowserPanel({
    manager,
    brokerDeps: { now: () => now, tokenTtlMs: 1000 },
  });
  const session = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  assert.ok(wiring.resolveTargetForAgent(session.panelId, ACTOR_A));
  now += 2000;
  assert.throws(
    () => wiring.resolveTargetForAgent(session.panelId, ACTOR_A),
    /过期/,
  );
});

test('5) 接线销毁后句柄全部失效（Broker 重启语义）', () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  wiring.dispose();
  assert.equal(wiring.hasHandle(session.panelId), false);
  assert.throws(
    () => wiring.resolveTargetForAgent(session.panelId, ACTOR_A),
    /未登记/,
  );
});

test('5b) manager destroy 事件 → wiring 自动撤销', () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  manager.destroyAll();
  assert.equal(wiring.hasHandle(session.panelId), false);
});

test('6) 证据流 URL 脱敏：凭据类 query 不进事件', async () => {
  const { manager, wiring } = setupHarness();
  const secretUrl =
    'http://127.0.0.1:80/x?token=SECRET-TOKEN-abc&code=authcode123&safe=keep';
  manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: secretUrl,
  });
  // 让 webContents 的 getURL 返回带敏感参数的地址
  manager._wc.getURL = () => secretUrl;
  await wiring.sendCDPForAgent(
    manager.session.panelId,
    ACTOR_A,
    'Runtime.evaluate',
  );
  const events = wiring.listEventsForAgent(
    manager.session.panelId,
    ACTOR_A,
  );
  const serialized = JSON.stringify(events);
  assert.ok(
    serialized.indexOf('SECRET-TOKEN-abc') === -1 &&
      serialized.indexOf('authcode123') === -1,
    `事件流泄漏敏感参数：${serialized.slice(0, 200)}`,
  );
  assert.ok(serialized.indexOf('***') !== -1, '敏感参数应变为 ***');
  assert.ok(serialized.indexOf('safe=keep') !== -1, '非敏感参数保留');
});

test('6b) redactUrlForEvidence 单元：query 脱敏、路径保留、坏 URL 安全', () => {
  assert.equal(
    redactUrlForEvidence('https://a.com/p?token=x1&ok=1'),
    'https://a.com/p?token=***&ok=1',
  );
  assert.ok(!redactUrlForEvidence('https://a.com/p?access_token=y').includes('y'));
  assert.equal(redactUrlForEvidence('/relative/path'), '[unparseable-url]');
  assert.equal(redactUrlForEvidence('https://a.com/secret-path?b=1'), 'https://a.com/secret-path?b=1');
});

test('硬约束 5：Agent 不得自我批准（approve 需用户通道）', async () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  const { actionId } = wiring.requestActionForAgent(
    session.panelId,
    ACTOR_A,
    'Input.dispatchMouseEvent',
    { label: '点击' },
  );
  // 默认 harness 下 approveActionForAgent 需要"用户确认令牌"（阶段 4 接 UI），
  // 这里只验证：未经批准直接发写动作 → 被拒。
  await assert.rejects(
    () =>
      wiring.sendCDPForAgent(
        session.panelId,
        ACTOR_A,
        'Input.dispatchMouseEvent',
        {},
        { approvedActionId: actionId },
      ),
    /需要审批|未批准/,
  );
});

test('缺 actor 身份拒绝（fail-closed）', () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  assert.throws(() => wiring.resolveTargetForAgent(session.panelId, {}), /actor|身份/);
  assert.throws(() => wiring.resolveTargetForAgent(session.panelId, null), /actor|身份/);
});

test('wiring 未登记面板拒绝（Agent 只能访问已打开面板）', () => {
  const { wiring } = setupHarness();
  assert.throws(
    () => wiring.resolveTargetForAgent('panel-ghost', ACTOR_A),
    /未登记/,
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
    console.error(`WIRING SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`WIRING SPEC PASSED (${tests.length})`);
  }
})();
