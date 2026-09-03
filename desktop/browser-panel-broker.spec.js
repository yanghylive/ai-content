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

test('token 滑动续期：活跃使用不中断（2026-09-04 真机修复）', () => {
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
  // 每次成功授权都滑动续期：相邻使用间隔 < TTL 时授权永不断
  for (let i = 0; i < 5; i++) {
    now += 80; // < tokenTtlMs(100)
    broker.resolveTarget(created.panelId, created.capabilityToken); // 不抛 = 续期成功
  }
  // 空闲超过 TTL 仍然过期（安全语义不松）
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

// ── 阶段 5 新增：导航能力 + origin 允许表 + actor 首次绑定 ────────────────

function setupPanel(opts = {}) {
  const wcs = new Map();
  const broker = new BrowserPanelBroker({
    webContentsResolver: (panelId) => wcs.get(panelId) || null,
    ...opts,
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

/** 建一个占位身份面板（模拟 desktop 主进程：不知道当前登录用户） */
function setupPlaceholderPanel(opts = {}) {
  const wcs = new Map();
  const broker = new BrowserPanelBroker({
    webContentsResolver: (panelId) => wcs.get(panelId) || null,
    ...opts,
  });
  const created = broker.createPanel({
    panelId: 'panel-p',
    sessionId: 'sess-p',
    ownerId: 'local-desktop',
    tenantId: 'local-tenant',
    platform: 'general-web',
  });
  wcs.set('panel-p', fakeWebContents());
  return { broker, created };
}

function approve(broker, created, method) {
  const ticket = broker.requestAction(created.panelId, created.capabilityToken, method, {});
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  return ticket.actionId;
}

test('Page.navigate 进白名单：确认单 + 允许表内 origin 可导航', async () => {
  const { broker, created } = setupPanel({ allowedOrigins: ['https://kaypal.cn', 'http://127.0.0.1:9'] });
  const actionId = approve(broker, created, 'Page.navigate');
  const { result } = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Page.navigate',
    { url: 'https://kaypal.cn/publish' },
    { approvedActionId: actionId },
  );
  assert.equal(result.echo, 'Page.navigate');
});

test('Page.navigate 无确认单 → 拒绝（写动作必须审批）', async () => {
  const { broker, created } = setupPanel({ allowedOrigins: ['https://kaypal.cn'] });
  await assert.rejects(
    () => broker.sendCDP(created.panelId, created.capabilityToken, 'Page.navigate', { url: 'https://kaypal.cn/x' }),
    /动作需要审批/,
  );
});

test('Page.navigate origin 不在允许表 → 先于审批闸门拒绝', async () => {
  const { broker, created } = setupPanel({ allowedOrigins: ['https://kaypal.cn'] });
  const actionId = approve(broker, created, 'Page.navigate');
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Page.navigate',
      { url: 'https://evil.example.com/steal' },
      { approvedActionId: actionId },
    ),
    /origin 不在允许表/,
  );
  const reasons = broker.listEvents(created.panelId, created.capabilityToken)
    .filter((e) => e.type === 'blocked').map((e) => e.reason);
  assert.ok(reasons.includes('navigate-target-denied'), `实际 blocked 原因：${reasons}`);
});

test('Page.navigate 非 http(s) 协议 → 拒绝（javascript:/file:/data: 全挡）', async () => {
  const { broker, created } = setupPanel({ allowedOrigins: [] });
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x']) {
    await assert.rejects(
      () => broker.sendCDP(created.panelId, created.capabilityToken, 'Page.navigate', { url: bad }),
      /协议只允许 http\/https|不是合法 URL/,
      bad,
    );
  }
});

test('空白名单（默认）＝ 任何导航都要确认单，但不拦 origin', async () => {
  const { broker, created } = setupPanel();
  assert.deepEqual(broker.allowedOrigins(), []);
  await assert.rejects(
    () => broker.sendCDP(created.panelId, created.capabilityToken, 'Page.navigate', { url: 'https://anywhere.example.com/x' }),
    /动作需要审批/,
  );
  const actionId = approve(broker, created, 'Page.navigate');
  const { result } = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Page.navigate',
    { url: 'https://anywhere.example.com/x' },
    { approvedActionId: actionId },
  );
  assert.equal(result.echo, 'Page.navigate');
});

test('actor 首次绑定：占位身份面板被第一个 actor 绑走', () => {
  const { broker, created } = setupPlaceholderPanel();
  assert.equal(broker.boundActor(created.panelId, created.capabilityToken), null, '初始未绑定');
  const first = broker.assertActor(created.panelId, created.capabilityToken, {
    ownerId: 'user-real', tenantId: 'tenant-real',
  });
  assert.equal(first.panelId, 'panel-p');
  const bound = broker.boundActor(created.panelId, created.capabilityToken);
  assert.equal(bound.ownerId, 'user-real');
  assert.equal(bound.tenantId, 'tenant-real');
  assert.equal(typeof bound.boundAt, 'number');
});

test('actor 首次绑定后：同一 actor 可复用，换 actor 一律拒绝', () => {
  const { broker, created } = setupPlaceholderPanel();
  const A = { ownerId: 'u1', tenantId: 't1' };
  broker.assertActor(created.panelId, created.capabilityToken, A);
  broker.assertActor(created.panelId, created.capabilityToken, A);
  assert.throws(
    () => broker.assertActor(created.panelId, created.capabilityToken, { ownerId: 'u2', tenantId: 't1' }),
    /已绑定到其他身份/,
  );
  assert.throws(
    () => broker.assertActor(created.panelId, created.capabilityToken, { ownerId: 'u1', tenantId: 't2' }),
    /已绑定到其他身份/,
  );
});

test('真实身份面板：actor 必须完全一致（占位绑定逻辑不生效）', () => {
  const { broker, created } = setupPanel();
  assert.throws(
    () => broker.assertActor(created.panelId, created.capabilityToken, { ownerId: 'user-b', tenantId: 'tenant-b' }),
    /owner\/tenant 不一致/,
  );
  broker.assertActor(created.panelId, created.capabilityToken, { ownerId: 'user-a', tenantId: 'tenant-a' });
});

test('actor 绑定进事件流留痕（审计可查）', () => {
  const { broker, created } = setupPlaceholderPanel();
  broker.assertActor(created.panelId, created.capabilityToken, { ownerId: 'u1', tenantId: 't1' });
  const bound = broker.listEvents(created.panelId, created.capabilityToken)
    .filter((e) => e.type === 'actor.bound');
  assert.equal(bound.length, 1);
  assert.equal(bound[0].ownerId, 'u1');
  assert.equal(bound[0].fromPlaceholder, true);
});

test('缺 actor 仍然 fail-closed（绑定逻辑不绕过身份校验）', () => {
  const { broker, created } = setupPlaceholderPanel();
  assert.throws(
    () => broker.assertActor(created.panelId, created.capabilityToken, { ownerId: 'u1' }),
    /actor 必须携带 ownerId\/tenantId/,
  );
  assert.throws(
    () => broker.assertActor(created.panelId, created.capabilityToken, null),
    /actor 必须携带 ownerId\/tenantId/,
  );
});

test('确认单状态：签出=pending，批准后=approved，执行消费后=none', async () => {
  const { broker, created } = setupPanel({ allowedOrigins: ['https://kaypal.cn'] });
  const actor = { ownerId: 'user-a', tenantId: 'tenant-a' };
  broker.assertActor(created.panelId, created.capabilityToken, actor);
  const ticket = broker.requestAction(
    created.panelId,
    created.capabilityToken,
    'Page.navigate',
    { label: '导航' },
  );
  const pending = broker.actionState(ticket.actionId, created.capabilityToken);
  assert.equal(pending.state, 'pending');
  assert.equal(pending.method, 'Page.navigate');
  assert.equal(pending.binding.webContentsId, 101);

  broker.approveAction(
    ticket.actionId,
    created.capabilityToken,
    created.capabilityToken,
    { channel: 'owner-ui' },
  );
  const approved = broker.actionState(ticket.actionId, created.capabilityToken);
  assert.equal(approved.state, 'approved');
  assert.ok(approved.approvedAt > 0, '批准时间要留痕');

  await broker.sendCDP(
    created.panelId,
    created.capabilityToken,
    'Page.navigate',
    { url: 'https://kaypal.cn/ok' },
    { approvedActionId: ticket.actionId },
  );
  assert.equal(
    broker.actionState(ticket.actionId, created.capabilityToken).state,
    'none',
    '确认单一次性：执行后即消费',
  );
});

test('确认单状态：不存在的单 = none；查询不消费（approved 可重复查）', () => {
  const { broker, created } = setupPanel();
  assert.equal(broker.actionState('nope', created.capabilityToken).state, 'none');
  const ticket = broker.requestAction(
    created.panelId,
    created.capabilityToken,
    'Page.navigate',
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  assert.equal(broker.actionState(ticket.actionId, created.capabilityToken).state, 'approved');
  assert.equal(
    broker.actionState(ticket.actionId, created.capabilityToken).state,
    'approved',
    '查询不得消费确认单',
  );
});

test('确认单状态：换页后旧单不可执行（webContentsId 变了）', async () => {
  const { broker, wcs, created } = setupPanel({ allowedOrigins: ['https://kaypal.cn'] });
  const ticket = broker.requestAction(
    created.panelId,
    created.capabilityToken,
    'Page.navigate',
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  wcs.set('panel-1', fakeWebContents({ id: 999 }));
  await assert.rejects(
    broker.sendCDP(
      created.panelId,
      created.capabilityToken,
      'Page.navigate',
      { url: 'https://kaypal.cn/x' },
      { approvedActionId: ticket.actionId },
    ),
    /审批/,
  );
});

// ── 阶段 7：一次批准 = 一次逻辑点击（pressed 消耗单，released 走配对通道）──
// 背景：executor 的 click 全链路一次逻辑点击 = mousePressed + mouseReleased
// 两次 CDP 调用，但只有一张确认单。released 在单已被 pressed 消耗后，
// 走配对通道放行一次（同面板、坐标 ≤4px、10s 内、一次性）。

const PRESSED = (x, y) => ({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
const RELEASED = (x, y) => ({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

test('⑦ 一次批准覆盖一次点击：pressed 消耗单后 released 走配对放行', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent', { label: '点击' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  const pressed = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  assert.equal(pressed.result.echo, 'Input.dispatchMouseEvent');
  // 单已被 pressed 消耗：released 靠配对通道放行（同单同坐标）
  const released = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    RELEASED(100, 50), { approvedActionId: ticket.actionId },
  );
  assert.equal(released.result.echo, 'Input.dispatchMouseEvent');
});

test('⑦ 无 pressed 直接 released（无批准单、无配对记录）→ 拒绝', async () => {
  const { broker, created } = setupPanel();
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      RELEASED(100, 50),
    ),
    /需要审批/,
  );
});

test('⑦ 配对坐标校验：released 偏移 >4px 拒绝且烧单（同单重试也拒）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent', { label: '点击' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  // 偏移 10px > 4px：fail-closed 拒绝
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      RELEASED(110, 50), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
  // 烧单语义：坐标改回正确位置也放不了行（一次性，先烧再验）
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      RELEASED(100, 50), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

test('⑦ 配对一次性：released 放行一次后，同单再来一次 rejected', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent', { label: '点击' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    RELEASED(100, 50), { approvedActionId: ticket.actionId },
  );
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      RELEASED(100, 50), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

test('⑦ 配对超时：pressed 后超 10s，released 拒绝（超时烧单）', async () => {
  let now = 1_000_000;
  const { broker, created } = setupPanel({ now: () => now });
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent', { label: '点击' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  now += 11_000; // 超过 10s 配对有效期
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      RELEASED(100, 50), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

// ── 阶段 7 续：输入型确认单（Input.insertText）＝ 聚焦 pressed + insertText ──

test('⑦ 输入单：insertText 型确认单可被聚焦 mousePressed 消耗，insertText 走配对放行', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.insertText', { label: '输入文本' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  // 第一步：聚焦（method 组匹配——insertText 单允许 mousePressed 消耗）
  const pressed = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  assert.equal(pressed.result.echo, 'Input.dispatchMouseEvent');
  // 第二步：插入文本（配对通道，免坐标）
  const inserted = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.insertText',
    { text: 'hello' }, { approvedActionId: ticket.actionId },
  );
  assert.equal(inserted.result.echo, 'Input.insertText');
});

test('⑦ 输入单：insertText 直接消耗完整单（页面焦点已在目标时无需聚焦）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.insertText', { label: '输入文本' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  const inserted = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.insertText',
    { text: 'hello' }, { approvedActionId: ticket.actionId },
  );
  assert.equal(inserted.result.echo, 'Input.insertText');
});

test('⑦ 输入单：配对一次性——聚焦后再来一张 insertText 拒绝', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.insertText', { label: '输入文本' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.insertText',
    { text: 'hello' }, { approvedActionId: ticket.actionId },
  );
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.insertText',
      { text: 'again' }, { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

test('⑦ method 组匹配收紧：insertText 型单不能被 mouseReleased 消耗（click 续作不许借输入单放行）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.insertText', { label: '输入文本' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  // released 不是 insertText 单的合法消耗者（既不配对也无组匹配）
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      RELEASED(100, 50), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

test('⑦ 收紧：mouseReleased 不带坐标 → fail-closed 拒绝（不能借免坐标通道绕过校验）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent', { label: '点击' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      { type: 'mouseReleased' }, { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

// ── 阶段 7 续（第九轮）：按键型确认单（Input.dispatchKeyEvent）＝ keyDown + keyUp ──

const KEY_DOWN = (key) => ({ type: 'keyDown', key });
const KEY_UP = (key) => ({ type: 'keyUp', key });

test('⑧ 按键单：keyDown 消耗确认单，keyUp 走配对放行（一次逻辑按键）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    { label: '按下按键', key: 'Enter' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  // 第一步：keyDown（method 严格相等，直接消耗单）
  const down = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    KEY_DOWN('Enter'), { approvedActionId: ticket.actionId },
  );
  assert.equal(down.result.echo, 'Input.dispatchKeyEvent');
  // 第二步：keyUp（配对通道，免签单）
  const up = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    KEY_UP('Enter'), { approvedActionId: ticket.actionId },
  );
  assert.equal(up.result.echo, 'Input.dispatchKeyEvent');
});

test('⑧ 按键配对一次性：第二次 keyUp 拒绝', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    { label: '按下按键', key: 'Enter' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    KEY_DOWN('Enter'), { approvedActionId: ticket.actionId },
  );
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    KEY_UP('Enter'), { approvedActionId: ticket.actionId },
  );
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
      KEY_UP('Enter'), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

test('⑧ 按键配对键位校验：keyUp 键位不匹配 → 拒绝且烧单（同单正确键位重试也拒）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    { label: '按下按键', key: 'Enter' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    KEY_DOWN('Enter'), { approvedActionId: ticket.actionId },
  );
  // 键位不一致：fail-closed（先烧单再校验，重试也救不回来）
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
      KEY_UP('Tab'), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
      KEY_UP('Enter'), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

test('⑧ 收紧：keyUp 不能借鼠标配对放行（mousePressed 登记的配对不认按键续作）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent', { label: '点击' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
    PRESSED(100, 50), { approvedActionId: ticket.actionId },
  );
  // 鼠标配对还挂着，但 keyUp 不是它的合法续作（各通道互不串门）
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
      KEY_UP('Enter'), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

test('⑧ 收紧：insertText / mouseReleased 不能借按键配对放行（无键位字段天然不匹配）', async () => {
  const { broker, created } = setupPanel();
  const ticket = broker.requestAction(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    { label: '按下按键', key: 'Enter' },
  );
  broker.approveAction(ticket.actionId, created.capabilityToken, created.capabilityToken);
  await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Input.dispatchKeyEvent',
    KEY_DOWN('Enter'), { approvedActionId: ticket.actionId },
  );
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.insertText',
      { text: 'borrow' }, { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Input.dispatchMouseEvent',
      RELEASED(100, 50), { approvedActionId: ticket.actionId },
    ),
    /需要审批/,
  );
});

// ── 阶段 7 round11：Panel.tabs（主进程伪 method，不走 CDP debugger）────────

function setupTabs(tabsHandler) {
  const wcs = new Map();
  const broker = new BrowserPanelBroker({
    webContentsResolver: (panelId) => wcs.get(panelId) || null,
    ...(tabsHandler ? { tabsHandler } : {}),
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

test('⑪ Panel.tabs 无单拒（mutation 闸门）', async () => {
  const { broker, created } = setupTabs(() => ({ tabs: 2, activeIndex: 1, url: 'about:blank' }));
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Panel.tabs',
      { operation: 'new' },
    ),
    /需要审批/,
  );
});

test('⑪ Panel.tabs approved → handler 调用参数对 + binding 取切后 active（fresh target）', async () => {
  const calls = [];
  const { broker, created, wcs } = setupTabs((operation, index) => {
    calls.push({ operation, index });
    // switch 后 manager 的 active tab 变了：模拟 resolver 拿到新 webContents
    wcs.set('panel-1', fakeWebContents({ id: 202, url: 'http://127.0.0.1:9/tab-b' }));
    return { tabs: 2, activeIndex: index, url: 'http://127.0.0.1:9/tab-b' };
  });
  const { actionId } = broker.requestAction(
    created.panelId, created.capabilityToken, 'Panel.tabs',
    { label: '标签页操作', operation: 'switch', index: 1 },
  );
  broker.approveAction(actionId, created.capabilityToken, created.capabilityToken);
  const done = await broker.sendCDP(
    created.panelId, created.capabilityToken, 'Panel.tabs',
    { operation: 'switch', index: 1 }, { approvedActionId: actionId },
  );
  assert.deepEqual(calls, [{ operation: 'switch', index: 1 }]);
  assert.equal(done.result.tabs, 2);
  // binding 必须是执行后重新解析的 target（webContentsId/url = 新 active）
  assert.equal(done.target.webContentsId, 202);
  assert.equal(done.target.url, 'http://127.0.0.1:9/tab-b');
  // 确认单一次性：重放拒绝
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Panel.tabs',
      { operation: 'switch', index: 0 }, { approvedActionId: actionId },
    ),
    /需要审批/,
  );
});

test('⑪ Panel.tabs 非法 operation 拒（new/switch/close 之外）', async () => {
  const { broker, created } = setupTabs(() => ({ tabs: 9, activeIndex: 0, url: null }));
  const { actionId } = broker.requestAction(
    created.panelId, created.capabilityToken, 'Panel.tabs', { label: 'x' },
  );
  broker.approveAction(actionId, created.capabilityToken, created.capabilityToken);
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Panel.tabs',
      { operation: 'explode' }, { approvedActionId: actionId },
    ),
    /operation 必须是 new\/switch\/close/,
  );
});

test('⑪ Panel.tabs handler 未注入 → fail-closed 拒绝（不静默 no-op）', async () => {
  const { broker, created } = setupTabs(null);
  const { actionId } = broker.requestAction(
    created.panelId, created.capabilityToken, 'Panel.tabs', { label: 'x' },
  );
  broker.approveAction(actionId, created.capabilityToken, created.capabilityToken);
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Panel.tabs',
      { operation: 'new' }, { approvedActionId: actionId },
    ),
    /未接线/,
  );
});

test('⑪ Panel.tabs handler 抛错（越界/关最后一个）→ 动作失败透传（单已耗，语义与 CDP 失败一致）', async () => {
  const { broker, created } = setupTabs((operation) => {
    throw new Error('不能关闭最后一个标签页（面板至少保留一个页面）');
  });
  const { actionId } = broker.requestAction(
    created.panelId, created.capabilityToken, 'Panel.tabs', { label: 'x' },
  );
  broker.approveAction(actionId, created.capabilityToken, created.capabilityToken);
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Panel.tabs',
      { operation: 'close', index: 0 }, { approvedActionId: actionId },
    ),
    /不能关闭最后一个标签页/,
  );
  // 单已耗：同单重试也拒（需重新签单——如实交底的语义）
  await assert.rejects(
    () => broker.sendCDP(
      created.panelId, created.capabilityToken, 'Panel.tabs',
      { operation: 'close', index: 0 }, { approvedActionId: actionId },
    ),
    /需要审批/,
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
