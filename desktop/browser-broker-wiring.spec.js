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
  // TraeWork 控制权基线：存量用例语义 = 人工审批（等价用户接管中），
  // 系统控制的自动批准/交还放行由新增专项用例覆盖。
  let control = 'user';
  const controlListeners = new Set();
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
    getControl() {
      return control;
    },
    onControlChange(fn) {
      controlListeners.add(fn);
      return () => controlListeners.delete(fn);
    },
    setControl(next) {
      control = next;
      for (const fn of controlListeners) fn(next);
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
    // 模拟真实 manager.open() 复用语义：同 owner 重开 → panelId/sessionId 保持
    // 不变，仅更新归属字段/URL（browser-panel-manager.js open() 的会话复用分支）。
    reopenAs(session) {
      this.session = {
        ...this.session,
        ...session,
        status: 'starting',
        panelId: this.session.panelId,
        sessionId: this.session.sessionId,
        partition: this.session.partition,
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
    // 2026-09-05 panel-open：引擎打开面板入口（真实 manager.open 的最小面）
    open(input) {
      return this.openAs({
        ownerId: input.ownerId,
        tenantId: input.tenantId,
        accountId: input.accountId,
        platform: input.platform,
        currentUrl: input.url,
      });
    },
    // panel-state：会话事实读取（真实 publicState 的最小面）
    publicState() {
      return {
        visible: true,
        session: this.session
          ? { ...this.session, webContentsId: this._wc ? this._wc.id : null }
          : null,
      };
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

// ---- TraeWork 控制权模型：签单即系统控制自动批准；交还批量放行 ----

test('控制权·系统控制：签单即经 owner 通道自动批准，响应带 autoApproved=true', () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs(ACTOR_A);
  manager.setControl('system');
  const ticket = wiring.requestActionForAgent(
    session.panelId, ACTOR_A, 'Page.navigate', { label: '导航' },
  );
  assert.equal(ticket.autoApproved, true);
  assert.equal(
    wiring.actionStateForAgent(session.panelId, ACTOR_A, ticket.actionId).state,
    'approved',
  );
});

test('控制权·接管态：签单保持排队（autoApproved=false），人工审批语义不变', () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs(ACTOR_A);
  const ticket = wiring.requestActionForAgent(
    session.panelId, ACTOR_A, 'Page.navigate', { label: '导航' },
  );
  assert.equal(ticket.autoApproved, false);
  assert.equal(
    wiring.actionStateForAgent(session.panelId, ACTOR_A, ticket.actionId).state,
    'pending',
  );
});

test('控制权·交还：user→system 批量放行排队单，队列清空', () => {
  const { manager, wiring } = setupHarness();
  const session = manager.openAs(ACTOR_A);
  const t1 = wiring.requestActionForAgent(session.panelId, ACTOR_A, 'Page.navigate', { label: '导航1' });
  const t2 = wiring.requestActionForAgent(session.panelId, ACTOR_A, 'Input.insertText', { label: '输入' });
  assert.equal(wiring.listPendingActions(session.panelId).length, 2);
  manager.setControl('system'); // 交还
  assert.equal(wiring.actionStateForAgent(session.panelId, ACTOR_A, t1.actionId).state, 'approved');
  assert.equal(wiring.actionStateForAgent(session.panelId, ACTOR_A, t2.actionId).state, 'approved');
  assert.equal(wiring.listPendingActions(session.panelId).length, 0);
});

test('控制权·fail-safe：老宿主无 getControl → 一律人工审批（不自动批准）', () => {
  const manager = makeFakeManager();
  delete manager.getControl;
  const wiring = wireBrowserPanel({ manager });
  const session = manager.openAs(ACTOR_A);
  const ticket = wiring.requestActionForAgent(session.panelId, ACTOR_A, 'Page.navigate', {});
  assert.equal(ticket.autoApproved, false);
});

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

// ⑫ 阶段 5 只读校准真机抓获（2026-09-04）：面板闲置超 TTL → token 被 broker
// 过期删除 → open 复用会话（signature 不变）reconcile 早退 → 永远 TOKEN_INVALID。
// 修复：opened/shown 事件强制重铸 token；broker.dropPanel 清 destroyPanel 的
// token 死亡态残留。
test('⑫a 闲置 token 过期后，同 signature reopen 强制重铸恢复', () => {
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
  now += 2000; // 闲置超 TTL：首次「已过期」（token 随即被删），之后「无效」
  assert.throws(
    () => wiring.resolveTargetForAgent(session.panelId, ACTOR_A),
    /过期/,
  );
  assert.throws(
    () => wiring.resolveTargetForAgent(session.panelId, ACTOR_A),
    /无效/,
  );
  // 用户重新 open（同 owner/tenant，panelId/sessionId 不变 → signature 相同）
  const reopened = manager.reopenAs({
    ownerId: 'user-a',
    tenantId: 'tenant-a',
    currentUrl: 'http://127.0.0.1:80/x',
  });
  assert.equal(reopened.panelId, session.panelId, '预置条件：复用会话 signature 不变');
  // 修复后：重开即重铸，立即恢复（修复前这里永远 TOKEN_INVALID）
  assert.ok(wiring.resolveTargetForAgent(session.panelId, ACTOR_A));
});

test('⑫b shown 事件同样触发重铸（面板从隐藏恢复可见）', () => {
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
  now += 2000;
  assert.throws(
    () => wiring.resolveTargetForAgent(session.panelId, ACTOR_A),
    /过期|无效/,
  );
  manager._fire('shown');
  assert.ok(wiring.resolveTargetForAgent(session.panelId, ACTOR_A));
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

// ---- 2026-09-05 引擎「内置面板优先」：openPanelForAgent ----
// 2026-09-05 复核 P1：panel 路由与 /execute 同强度——actor 必须精确匹配引擎身份

const ENGINE_ACTOR = { ownerId: 'local-engine', tenantId: 'local-tenant' };

test('panel-open：白名单平台域放行，返回 partition/panelId 映射', () => {
  const { manager, wiring } = setupHarness();
  const out = wiring.openPanelForAgent({
    actor: ENGINE_ACTOR,
    url: 'https://creator.douyin.com/creator-micro/home',
    accountId: '7',
    platform: 'douyin',
  });
  assert.ok(out.panelId, 'panelId 应存在');
  assert.equal(out.accountId, '7');
  assert.equal(out.partition, 'persist:kaypal-browser-local-desktop-7');
  assert.equal(out.url.includes('creator.douyin.com'), true);
  // 固定引擎身份：不借调用方 actor 的 ownerId 开面板
  assert.equal(manager.session.ownerId, 'local-desktop');
});

test('panel-open：子域放行 + 非白名单域名拒绝（防通用导航器滥用）', () => {
  const { wiring } = setupHarness();
  const sub = wiring.openPanelForAgent({
    actor: ENGINE_ACTOR,
    url: 'https://channels.weixin.qq.com/platform/home',
    accountId: '9',
    platform: 'wechat-channel',
  });
  assert.equal(sub.partition, 'persist:kaypal-browser-local-desktop-9');
  assert.throws(
    () =>
      wiring.openPanelForAgent({
        actor: ENGINE_ACTOR,
        url: 'https://evil.example.com/phish',
        accountId: '1',
        platform: 'douyin',
      }),
    /仅允许已知平台域名/,
  );
  assert.throws(
    () => wiring.openPanelForAgent({ actor: ENGINE_ACTOR, url: 'not-a-url' }),
    /url|域名/,
  );
  assert.throws(
    () => wiring.openPanelForAgent({ actor: ENGINE_ACTOR }),
    /url 必填/,
  );
});

test('panel-open/panel-state：actor 非 local-engine 身份 fail-closed（2026-09-05 复核 P1）', () => {
  const { wiring } = setupHarness();
  const wrongActor = { ownerId: 'someone-else', tenantId: 'local-tenant' };
  assert.throws(
    () =>
      wiring.openPanelForAgent({
        actor: wrongActor,
        url: 'https://creator.douyin.com/creator-micro/home',
        accountId: '7',
        platform: 'douyin',
      }),
    /身份不一致/,
  );
  assert.throws(
    () =>
      wiring.openPanelForAgent({
        actor: { ownerId: 'local-engine', tenantId: 'other-tenant' },
        url: 'https://creator.douyin.com/creator-micro/home',
      }),
    /身份不一致/,
  );
  assert.throws(
    () => wiring.openPanelForAgent({ url: 'https://creator.douyin.com/x' }),
    /身份不一致/,
  );
  assert.throws(() => wiring.panelStateForAgent(wrongActor), /身份不一致/);
  assert.throws(() => wiring.panelStateForAgent(), /身份不一致/);
});

// ---- 2026-09-05 复核 P0-1（账号强绑定）：panelStateForAgent ----

test('panel-state：有会话返回台账 accountId/partition（脱敏），无会话返回 hasSession=false', () => {
  const { manager, wiring } = setupHarness();
  const empty = wiring.panelStateForAgent(ENGINE_ACTOR);
  assert.equal(empty.hasSession, false);
  assert.equal(empty.accountId, null);

  manager.openAs({
    ownerId: 'local-desktop',
    tenantId: 'local-tenant',
    accountId: '7',
    platform: 'douyin',
  });
  const state = wiring.panelStateForAgent(ENGINE_ACTOR);
  assert.equal(state.hasSession, true);
  assert.equal(state.accountId, '7');
  assert.equal(state.partition, 'persist:kaypal-browser-local-desktop-7');
  assert.equal(state.platform, 'douyin');
  // sessionId 不是 URL，不走 URL 脱敏（2026-09-05 修复误标 [unparseable-url]）
  assert.ok(state.sessionId && state.sessionId !== '[unparseable-url]');
  assert.ok('visible' in state && 'status' in state);
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
