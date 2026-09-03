'use strict';
/**
 * browser-approval-overlay.spec.js — 阶段 6 桌面端审批 UI 的纯 node 测试
 * 运行：node desktop/browser-approval-overlay.spec.js
 *
 * 覆盖"批准权在用户手上"这条硬约束在 UI 层的落地：
 *  A. Broker 层：拒绝能力（终态）+ 摘要可读（2026-09-03 修的 bug）；
 *  B. Wiring 层：用户拒绝通道（owner 专用）+ 待批列表变更推送；
 *  C. Manager 层：审批浮层视图的创建 / z-order / sender 校验 / 可见性 / 生命周期。
 *
 * 关键安全断言：
 *  - Agent 侧**没有**拒绝通道（wiring 只暴露 rejectActionAsOwner）；
 *  - 非 owner 拒绝一律失败；
 *  - 已消费的确认单不能反悔拒绝；
 *  - 被拒绝的确认单执行时必须被闸门拦掉，且报错要明确（不是"需要审批"）。
 */
const assert = require('node:assert/strict');
const { BrowserPanelBroker } = require('./browser-panel-broker');
const { wireBrowserPanel } = require('./browser-broker-wiring');

// ────────────────────────── 假实现 ──────────────────────────

function fakeWebContents(id = 101, url = 'http://127.0.0.1:9/foo') {
  return {
    id,
    url,
    on: () => () => undefined,
    setWindowOpenHandler: () => undefined,
    debugger: {
      attach: () => undefined,
      isAttached: () => true,
      sendCommand: async (method) => ({ echo: method }),
      detach: () => undefined,
    },
  };
}

/** 最小 broker 场景：一个面板 + 已签出一张写动作确认单 */
function setupBroker() {
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
  const token = created.capabilityToken;
  const ticket = broker.requestAction('panel-1', token, 'Page.navigate', {
    label: '导航',
    url: 'https://kaypal.cn/x',
  });
  return { broker, wcs, token, ticket };
}

/** 最小 wiring 场景：带 onPendingChange 回调 */
function setupWiring() {
  let idSeq = 700;
  const listeners = new Set();
  const events = [];
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
    openAs(overrides = {}) {
      this.session = {
        panelId: 'panel-1',
        sessionId: 'sess-1',
        ownerId: 'user-a',
        tenantId: 'tenant-a',
        status: 'ready',
        platform: 'general-web',
        partition: 'persist:kaypal-browser-user-a',
        ...overrides,
      };
      this._wc = fakeWebContents(++idSeq);
      for (const fn of listeners) fn({ type: 'opened', manager });
      return this.session;
    },
    destroyAll() {
      for (const fn of listeners) fn({ type: 'destroyed', manager });
      this.session = null;
      this._wc = null;
    },
  };
  const wiring = wireBrowserPanel({
    manager,
    onPendingChange: (panelId, pending) => events.push({ panelId, count: pending.length }),
  });
  manager.openAs();
  return { manager, wiring, events };
}

/** 面板管理器用的完整假 webContents（比 broker 场景的需要更多方法） */
function fakePanelWebContents(id) {
  const listeners = new Map();
  return {
    id,
    _url: '',
    _listeners: listeners,
    _destroyed: false,
    _sent: [],
    on(event, fn) {
      const list = listeners.get(event) || [];
      list.push(fn);
      listeners.set(event, list);
    },
    off(event, fn) {
      const list = listeners.get(event) || [];
      listeners.set(event, list.filter((f) => f !== fn));
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) || []) fn(...args);
    },
    loadURL(url) {
      this._url = url;
      return Promise.resolve();
    },
    loadFile() {
      return Promise.resolve();
    },
    getURL() {
      return this._url;
    },
    send(channel, payload) {
      this._sent.push({ channel, payload });
    },
    goBack() {},
    goForward() {},
    reload() {},
    canGoBack() {
      return false;
    },
    canGoForward() {
      return false;
    },
    setWindowOpenHandler() {},
    isDestroyed() {
      return this._destroyed;
    },
    close() {
      this._destroyed = true;
    },
    debugger: {
      attach: () => undefined,
      isAttached: () => true,
      sendCommand: async (method) => ({ echo: method }),
      detach: () => undefined,
    },
  };
}

/** 最小 manager 场景：假 electron + 假窗口（children 数组可断言 z-order） */
function setupManager() {
  let idSeq = 900;
  const children = [];
  class WebContentsView {
    constructor(options = {}) {
      this.webPreferences = options.webPreferences || {};
      this.webContents = fakePanelWebContents(++idSeq);
      this._visible = true;
      this._bounds = null;
    }
    setVisible(v) {
      this._visible = v;
    }
    setBounds(b) {
      this._bounds = b;
    }
  }
  const window = {
    width: 1600,
    height: 900,
    contentView: {
      addChildView: (v) => children.push(v),
      removeChildView: (v) => {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
      },
    },
    getContentBounds: () => ({ width: 1600, height: 900 }),
    on: () => undefined,
    isDestroyed: () => false,
    children,
  };
  const { BrowserPanelManager } = require('./browser-panel-manager');
  const manager = new BrowserPanelManager({
    electron: { WebContentsView },
    store: { get: () => undefined, set: () => undefined },
    tabManager: {
      rightInset: 0,
      relayout() {},
      broadcast: () => undefined,
      sendToBusiness: () => true,
      isOwnedWebContents: () => true,
    },
    preloadPath: '/fake/strip-preload.js',
    stripHtmlPath: '/fake/strip.html',
    approvalPreloadPath: '/fake/approval-preload.js',
    approvalHtmlPath: '/fake/approval.html',
    logger: { warn: () => undefined },
  });
  manager.attach(window);
  return { manager, window, children };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ────────────────────── A. Broker：摘要 + 拒绝 ──────────────────────

test('A1 摘要可读：requestAction 的 summary 挂在 detail 顶层（修 bug）', () => {
  const { broker, token, ticket } = setupBroker();
  assert.ok(ticket.actionId);
  const state = broker.actionState(ticket.actionId, token);
  assert.equal(state.state, 'pending');
  assert.deepEqual(state.summary, { label: '导航', url: 'https://kaypal.cn/x' });
});

test('A2 待批列表带摘要（审批 UI 靠它显示"要干什么"）', () => {
  const { broker, token } = setupBroker();
  const list = broker.listPendingActions('panel-1', token);
  assert.equal(list.length, 1);
  assert.equal(list[0].method, 'Page.navigate');
  assert.equal(list[0].summary.label, '导航');
});

test('A3 owner 可拒绝，且状态变 rejected', () => {
  const { broker, token, ticket } = setupBroker();
  const out = broker.rejectAction(ticket.actionId, token, token, { via: 'ui' });
  assert.equal(out.rejected, true);
  assert.equal(broker.actionState(ticket.actionId, token).state, 'rejected');
});

test('A4 拒绝后从待批列表消失（卡片不会一直堆着）', () => {
  const { broker, token, ticket } = setupBroker();
  broker.rejectAction(ticket.actionId, token, token);
  assert.equal(broker.listPendingActions('panel-1', token).length, 0);
});

test('A5 非 owner 拒绝 → 失败（Agent 不能把用户的单搅黄）', () => {
  const { broker, token, ticket } = setupBroker();
  const other = broker.createPanel({
    panelId: 'panel-2',
    sessionId: 'sess-2',
    ownerId: 'user-b',
    tenantId: 'tenant-b',
    platform: 'general-web',
  });
  assert.throws(
    () => broker.rejectAction(ticket.actionId, other.capabilityToken, other.capabilityToken),
    // 跨面板的 token 在 _authorize 就被 fail-closed 拦下（比"非 owner"更早的一层）；
    // 两种报错都算拒绝成功，关键是单没被搅黄
    /capability token 无效|拒绝人必须是面板所有者/,
  );
  // 原单仍待批、摘要未丢 —— 别人的失败尝试不影响 owner 的单
  const state = broker.actionState(ticket.actionId, token);
  assert.equal(state.state, 'pending');
  assert.equal(broker.listPendingActions('panel-1', token).length, 1);
});

test('A6 被拒绝的单执行必须被拦掉，且报错明确说"已拒绝"', async () => {
  const { broker, token, ticket } = setupBroker();
  broker.rejectAction(ticket.actionId, token, token);
  await assert.rejects(
    () =>
      broker.sendCDP('panel-1', token, 'Page.navigate', { url: 'https://kaypal.cn/x' }, {
        approvedActionId: ticket.actionId,
      }),
    /已被用户拒绝/,
  );
});

test('A7 已执行的确认单不能再拒绝（一次性，反悔无效）', async () => {
  const { broker, token, ticket } = setupBroker();
  broker.approveAction(ticket.actionId, token, token, { channel: 'owner-ui' });
  await broker.sendCDP('panel-1', token, 'Page.navigate', { url: 'https://kaypal.cn/x' }, {
    approvedActionId: ticket.actionId,
  });
  // 执行后确认单被消费删除 → 拒绝必须失败（否则能"事后撤销"已发生的动作）
  assert.equal(broker.actionState(ticket.actionId, token).state, 'none');
  assert.throws(() => broker.rejectAction(ticket.actionId, token, token), /不存在或已过期/);
});

// ────────────────────── B. Wiring：用户拒绝通道 + 推送 ──────────────────────

test('B1 rejectActionAsOwner 走用户通道（channel=owner-ui）', () => {
  const { wiring } = setupWiring();
  const ticket = wiring.requestActionForAgent(
    'panel-1',
    { ownerId: 'user-a', tenantId: 'tenant-a' },
    'Input.dispatchMouseEvent',
    { label: '点击' },
  );
  const out = wiring.rejectActionAsOwner('panel-1', ticket.actionId);
  assert.equal(out.rejected, true);
});

test('B2 Agent 侧没有拒绝通道（wiring 不暴露 rejectActionForAgent）', () => {
  const { wiring } = setupWiring();
  assert.equal(typeof wiring.rejectActionForAgent, 'undefined');
  assert.equal(typeof wiring.rejectActionAsOwner, 'function');
});

test('B3 未登记面板拒绝 → 抛错（无主可拒）', () => {
  const { wiring } = setupWiring();
  assert.throws(() => wiring.rejectActionAsOwner('panel-nope', 'act-1'), /未登记/);
});

test('B4 签单 / 批准 / 拒绝 都会触发 onPendingChange', () => {
  const { wiring, events } = setupWiring();
  const actor = { ownerId: 'user-a', tenantId: 'tenant-a' };
  events.length = 0;
  const t1 = wiring.requestActionForAgent('panel-1', actor, 'Page.navigate', { label: 'A' });
  assert.equal(events.length, 1);
  assert.equal(events[0].count, 1);
  wiring.approveActionAsOwner('panel-1', t1.actionId);
  assert.equal(events.length, 2);
  assert.equal(events[1].count, 0); // 批准 → 从待批列表移除

  const t2 = wiring.requestActionForAgent('panel-1', actor, 'Input.insertText', { label: 'B' });
  assert.equal(events[2].count, 1);
  wiring.rejectActionAsOwner('panel-1', t2.actionId);
  assert.equal(events[3].count, 0); // 拒绝 → 也从待批列表移除
});

test('B5 onPendingChange 抛错不阻断签单（UI 是旁路）', () => {
  let idSeq = 800;
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
    openAs() {
      this.session = {
        panelId: 'panel-1',
        sessionId: 'sess-1',
        ownerId: 'user-a',
        tenantId: 'tenant-a',
        status: 'ready',
        platform: 'general-web',
        partition: 'persist:p',
      };
      this._wc = fakeWebContents(++idSeq);
      for (const fn of listeners) fn({ type: 'opened', manager });
    },
  };
  const wiring = wireBrowserPanel({
    manager,
    onPendingChange: () => {
      throw new Error('UI 炸了');
    },
  });
  manager.openAs();
  const ticket = wiring.requestActionForAgent(
    'panel-1',
    { ownerId: 'user-a', tenantId: 'tenant-a' },
    'Page.navigate',
    { label: 'A' },
  );
  assert.ok(ticket.actionId, 'UI 回调炸了也必须能签出确认单');
});

// ────────────────────── C. Manager：审批浮层 ──────────────────────

test('C1 attach 后审批浮层已创建并加载本地 HTML', () => {
  const { manager } = setupManager();
  assert.ok(manager.approvalView, '审批浮层视图应已创建');
  assert.equal(manager._approvalPreloadPath, '/fake/approval-preload.js');
});

test('C2 z-order：审批浮层必须在面板视图之上（后加入的在上层）', () => {
  const { manager, children } = setupManager();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  // 面板是后加的，会盖住浮层 → manager 在 _createPanelView 里必须把浮层重新置顶
  assert.ok(
    children.indexOf(manager.approvalView) > children.indexOf(manager.panelView),
    '审批浮层必须在 panelView 之后加入，否则会被面板盖住',
  );
});

test('C3 isApprovalSender 只认浮层自己（第三方页面伪造无效）', () => {
  const { manager } = setupManager();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.isApprovalSender(manager.approvalView.webContents), true);
  assert.equal(manager.isApprovalSender(manager.panelView.webContents), false);
  assert.equal(manager.isApprovalSender(manager.stripView.webContents), false);
  assert.equal(manager.isApprovalSender({ id: 99999 }), false);
  assert.equal(manager.isApprovalSender(null), false);
});

test('C4 有待批动作 → 浮层可见并收到列表推送', () => {
  const { manager } = setupManager();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.updateApprovalList([
    { actionId: 'act-1', method: 'Page.navigate', summary: { label: '导航' }, createdAt: Date.now(), binding: {} },
  ]);
  const sent = manager.approvalView.webContents._sent;
  const last = sent[sent.length - 1];
  assert.equal(last.channel, 'browser-panel:pending-actions');
  assert.equal(last.payload.actions.length, 1);
  assert.equal(last.payload.panelId, manager.session.panelId);
  assert.equal(manager.approvalView._visible, true);
});

test('C5 清空待批 → 浮层隐藏', () => {
  const { manager } = setupManager();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.updateApprovalList([{ actionId: 'act-1', method: 'Page.navigate', summary: null, createdAt: 0, binding: {} }]);
  assert.equal(manager.approvalView._visible, true);
  manager.updateApprovalList([]);
  assert.equal(manager.approvalView._visible, false);
});

test('C6 浮层高度按条数增长且封顶 220（不遮挡整个面板）', () => {
  const { manager } = setupManager();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const item = (id) => ({ actionId: id, method: 'Page.navigate', summary: null, createdAt: 0, binding: {} });
  manager.updateApprovalList([item('a')]);
  assert.equal(manager._approvalHeight(), 34 + 76);
  manager.updateApprovalList([item('a'), item('b'), item('c'), item('d'), item('e')]);
  assert.equal(manager._approvalHeight(), 220, '5 条应封顶 220');
  assert.equal(manager.approvalView._bounds.height, 220);
});

test('C7 面板收起 → 待批清空、浮层隐藏（不留陈旧卡片）', () => {
  const { manager } = setupManager();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.updateApprovalList([{ actionId: 'act-1', method: 'Page.navigate', summary: null, createdAt: 0, binding: {} }]);
  assert.equal(manager._approvalPendingCount, 1);
  manager.hide();
  assert.equal(manager._approvalPendingCount, 0);
  assert.equal(manager.approvalView._visible, false);
});

test('C8 destroy → 浮层从窗口移除并关闭（不留孤儿视图）', () => {
  const { manager, children } = setupManager();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const view = manager.approvalView;
  assert.ok(children.includes(view));
  manager.destroy();
  assert.equal(children.includes(view), false, '浮层应从窗口子视图中移除');
  assert.equal(view.webContents.isDestroyed(), true);
  assert.equal(manager.approvalView, null);
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
    console.error(`APPROVAL OVERLAY SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`APPROVAL OVERLAY SPEC PASSED (${tests.length})`);
  }
})();
