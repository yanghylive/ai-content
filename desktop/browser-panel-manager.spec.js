'use strict';
/**
 * browser-panel-manager.spec.js — 阶段 2 面板管理的纯 node 测试（Electron 注入假实现）
 * 运行：node desktop/browser-panel-manager.spec.js
 *
 * 覆盖：
 *  1) 布局几何：面板默认 480 / 最小 360 / 最大 60% 窗口宽；
 *  2) 遮挡门禁：面板打开时业务视图不侵入面板区域（工作流 UI 规则：
 *     面板隐藏/缩放/窄屏不得遮挡 3010 主内容）；
 *  3) 会话生命周期：关闭=隐藏保留会话与 partition，重开恢复；换账号重建视图；
 *  4) 导航协议白名单（仅 http/https，javascript:/file: 拒绝）；
 *  5) strip-only 通道与 sender 校验（isStripSender）；
 *  6) 状态机广播：did-navigate/did-fail-load/render-process-gone → 状态事件。
 */
const assert = require('node:assert/strict');
const { PANEL_GUTTER } = require('./browser-panel-manager');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---- fake electron ----
function makeFakeElectron() {
  let idSeq = 100;
  class FakeWebContents {
    constructor(partition) {
      this.id = ++idSeq;
      this._partition = partition;
      this._listeners = new Map();
      this._url = '';
      this._destroyed = false;
      this._canGoBack = false;
      this._canGoForward = false;
      this.debugger = {
        attach: () => undefined,
        isAttached: () => true,
        sendCommand: async () => ({}),
        detach: () => undefined,
      };
    }
    on(event, fn) {
      const list = this._listeners.get(event) || [];
      list.push(fn);
      this._listeners.set(event, list);
    }
    off(event, fn) {
      const list = this._listeners.get(event) || [];
      this._listeners.set(event, list.filter((f) => f !== fn));
    }
    emit(event, ...args) {
      for (const fn of this._listeners.get(event) || []) fn(...args);
    }
    loadURL(url) {
      this._url = url;
      return Promise.resolve();
    }
    loadFile() { return Promise.resolve(); }
    getURL() { return this._url; }
    getTitle() { return this._title || ''; }
    isDestroyed() { return this._destroyed; }
    canGoBack() { return this._canGoBack; }
    canGoForward() { return this._canGoForward; }
    goBack() { this._wentBack = true; }
    goForward() { this._wentForward = true; }
    reload() { this._reloaded = true; }
    close() { this._destroyed = true; }
    setWindowOpenHandler(fn) { this._openHandler = fn; }
  }
  class WebContentsView {
    constructor(options = {}) {
      this.webPreferences = options.webPreferences || {};
      this.webContents = new FakeWebContents(this.webPreferences.partition);
      this._visible = true;
      this._bounds = null;
    }
    setVisible(v) { this._visible = v; }
    setBounds(b) { this._bounds = b; }
  }
  // 拖拽调宽靠系统光标轮询驱动（见 manager.beginResize），fake 提供可控光标
  const cursor = { x: 0, y: 0 };
  return {
    WebContentsView,
    FakeWebContents,
    idSeq: () => idSeq,
    screen: { getCursorScreenPoint: () => ({ x: cursor.x, y: cursor.y }) },
    setCursor: (x, y) => { cursor.x = x; cursor.y = y; },
  };
}

function makeFakeWindow(width = 1600, height = 900) {
  const children = [];
  const fakeWindow = {
    width,
    height,
    contentView: {
      addChildView: (v) => children.push(v),
      removeChildView: (v) => {
        const i = children.indexOf(v);
        if (i >= 0) children.splice(i, 1);
      },
    },
    getContentBounds: () => ({ x: 0, y: 0, width: fakeWindow.width, height: fakeWindow.height }),
    on: () => undefined,
    isDestroyed: () => false,
    children,
  };
  return fakeWindow;
}

function makeTabManager() {
  const relayouts = [];
  const tabManager = {
    rightInset: 0,
    tabs: new Map(),
    activeId: null,
    _onActiveChange: null,
    relayouts,
    relayout() {
      relayouts.push(tabManager.rightInset);
    },
    broadcast: () => undefined,
    sendToBusiness: () => true,
    isOwnedWebContents: () => true,
    businessBoundsFor: (windowWidth, windowHeight) => ({
      x: 0,
      y: 38,
      width: windowWidth - tabManager.rightInset,
      height: windowHeight - 38,
    }),
    onActiveChange: (cb) => { tabManager._onActiveChange = cb; },
  };
  return tabManager;
}

function setup(width = 1600, height = 900, opts = {}) {
  const electron = makeFakeElectron();
  const tabManager = makeTabManager();
  const window = makeFakeWindow(width, height);
  const { BrowserPanelManager, PANEL_GUTTER } = require('./browser-panel-manager');
  const manager = new BrowserPanelManager({
    electron,
    store: { get: () => undefined, set: () => undefined },
    tabManager,
    // 默认关动画（既有断言都是同步读 _bounds）；动画专测 opts.animate:true 开启
    animatePanels: opts.animate === true,
    preloadPath: '/fake/preload.js',
    stripHtmlPath: '/fake/strip.html',
    logger: { warn: () => undefined },
    // ③：面板模式开关文件落 userData（测试注入临时目录； throwingDir 专测异常取法）
    getUserDataDir: opts.throwingDir
      ? () => { throw new Error('no userData in test'); }
      : (opts.userDataDir ? () => opts.userDataDir : undefined),
  });
  manager.attach(window);
  return { electron, manager, tabManager, window };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- TraeWork 控制权模型（默认系统控制，手动接管/交还） ----

test('控制权：默认系统控制（system），publicState 下发 control 字段', () => {
  const { manager } = setup(1600, 900);
  assert.equal(manager.getControl(), 'system');
  assert.equal(manager.publicState().control, 'system');
});

test('控制权：接管→user（订阅/活动/幂等），交还→system 复原', () => {
  const { manager } = setup(1600, 900);
  const seen = [];
  manager.onControlChange((c) => seen.push(c));
  manager.takeControl();
  assert.equal(manager.getControl(), 'user');
  assert.equal(manager.publicState().control, 'user');
  assert.deepEqual(seen, ['user']);
  const last = manager._activityLog[manager._activityLog.length - 1];
  assert.equal(last.type, 'control', '接管要留活动痕迹');
  manager.takeControl(); // 重复接管幂等：不再触发变更
  assert.deepEqual(seen, ['user']);
  manager.releaseControl();
  assert.equal(manager.getControl(), 'system');
  assert.deepEqual(seen, ['user', 'system']);
  manager.releaseControl(); // 重复交还幂等
  assert.deepEqual(seen, ['user', 'system']);
});

test('控制权：切换时重推浮层待批列表且带最新 control（接管横幅数据源）', () => {
  const { manager } = setup(1600, 900);
  const sends = [];
  manager._sendToApproval = (channel, payload) => sends.push({ channel, payload });
  manager.updateApprovalList([
    { actionId: 'x1', method: 'Page.navigate', summary: {}, binding: {} },
  ]);
  assert.equal(sends[0].payload.control, 'system');
  manager.takeControl();
  const last = sends[sends.length - 1];
  assert.equal(last.channel, 'browser-panel:pending-actions');
  assert.equal(last.payload.control, 'user');
  assert.equal(last.payload.actions.length, 1, '排队卡片内容不丢');
});

test('sanitizePanelUserAgent：去 Electron/app 标识，保留标准 Chrome 形态（2026-09-04）', () => {
  const { sanitizePanelUserAgent } = require('./browser-panel-manager');
  const electronUA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'ai-content-desktop/1.1.115 Chrome/128.0.6613.186 Electron/32.3.3 Safari/537.36';
  const cleaned = sanitizePanelUserAgent(electronUA);
  assert.ok(!cleaned.includes('Electron/'), '不得残留 Electron 标识');
  assert.ok(!cleaned.includes('ai-content-desktop'), '不得残留 app 标识');
  assert.ok(cleaned.includes('Chrome/128.0.6613.186'), 'Chrome 版本号从原 UA 提取');
  assert.ok(cleaned.endsWith('Safari/537.36'), '标准 Chrome UA 收尾');
  assert.ok(cleaned.startsWith('Mozilla/5.0 (Macintosh'), 'macOS 平台段');
  // 输入异常兜底：空/畸形输入不抛，给保守默认
  assert.ok(sanitizePanelUserAgent('').includes('Chrome/'), '空 UA 兜底');
  assert.ok(sanitizePanelUserAgent(undefined).includes('Chrome/'), 'undefined 兜底');
});

test('分区沟槽：全高贴面板左缘，宽度=10，命中 strip 门禁（面板页不命中）', () => {
  const { manager, window } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const { width, height } = window.getContentBounds();
  const gutter = manager.gutterView;
  assert.ok(gutter, 'attach 后应建出沟槽视图');
  assert.equal(gutter._bounds.width, PANEL_GUTTER);
  assert.equal(gutter._bounds.x, width - 480 - PANEL_GUTTER, '紧贴面板左缘');
  assert.equal(gutter._bounds.y, 38, '从 tab 条之下开始');
  assert.equal(gutter._bounds.height, height - 38, '全高（不止控制条那一行）');
  assert.equal(gutter._visible, true);
  assert.equal(manager.isStripSender(gutter.webContents), true, '沟槽=本地受信 chrome');
  assert.equal(manager.isStripSender(manager.panelView.webContents), false, '第三方面板页不命中');
  manager.hide();
  assert.equal(gutter._visible, false, '收起面板时沟槽一起隐藏');
});

test('拖拽调宽：主进程跟随系统光标，按下不跳宽，松手才落盘', () => {
  const saved = [];
  const { electron, manager } = setup(1600, 900);
  manager._store = { get: () => undefined, set: (k, v) => saved.push([k, v]) };
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  // 光标落在沟槽中间（面板左缘 1120，沟槽 1110~1120）
  electron.setCursor(1115, 400);
  assert.equal(manager.beginResize(), true);
  assert.equal(manager.width(), 480, '按下瞬间宽度不得跳变');
  // 往左拖 100px → 面板变宽 100
  electron.setCursor(1015, 400);
  manager._pollResize();
  assert.equal(manager.width(), 580);
  assert.equal(manager.panelView._bounds.x, 1600 - 580);
  assert.equal(saved.length, 0, '拖拽中不逐帧写 store（electron-store 同步落盘）');
  // 往右拖回、越过下限也被夹住
  electron.setCursor(1560, 400);
  manager._pollResize();
  // open 记录了一条活动 → 控制条含活动行（页面区高 900-38-70）→ 手机比例下限 365
  assert.equal(manager.width(), 365, '窄面板下限=手机比例宽（页面区高×393/852）');
  assert.equal(manager.endResize(), true);
  assert.deepEqual(saved, [['browserPanelWidth', 365]], '松手一次性持久化');
  assert.equal(manager.endResize(), false, '重复结束幂等');
  assert.equal(manager._resizeTimer, null);
  manager.destroy();
});

test('拖拽调宽：无系统光标能力时静默放弃，不炸会话', () => {
  const { electron, manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  electron.screen = undefined;
  assert.equal(manager.beginResize(), false);
  assert.equal(manager.width(), 480);
});

test('扩展行：地址栏聚焦时控制条视图加高 30px，失焦复原（TraeWork 地址行语义）', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const h1 = manager._stripHeight();
  const h2 = manager.setStripExpanded(true);
  assert.equal(manager._stripExpanded, true);
  assert.equal(h2, h1 + 30, '控制条视图加高一行');
  assert.equal(manager.setStripExpanded(true), h1 + 30, '重复调用幂等');
  // 建议下拉按需加高（快捷行 30 + 建议条数*24），上限 160
  const hBig = manager.setStripExpanded(true, 102);
  assert.equal(hBig, h1 + 102, '定制高度生效');
  assert.equal(manager.setStripExpanded(true, 999), h1 + 160, '高度上限 160');
  assert.equal(manager.setStripExpanded(true, 10), h1 + 30, '高度下限 30');
  manager.setStripExpanded(false);
  assert.equal(manager._stripHeight(), h1, '失焦复原');
  manager.hide();
  assert.equal(manager._stripExpanded, false, '收起面板归零');
});

test('状态订阅：onStateChange 收到广播，逐个解绑互不影响', () => {
  const { manager } = setup(1600, 900);
  const gotA = [], gotB = [];
  const offA = manager.onStateChange((st) => gotA.push(st.visible));
  const offB = manager.onStateChange((st) => gotB.push(st.panelWidth));
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.deepEqual(gotA, [true], 'open 只广播一次（内部记录为 silent）');
  assert.deepEqual(gotB, [480]);
  offA();
  manager.hide();
  assert.equal(gotA.length, 1, '取消订阅后不再收到');
  assert.deepEqual(gotB, [480, 0]); // hide 广播：panelWidth 归 0 已到 B
  offB();
});

test('活动流：record 追加/环形封顶/静默与广播语义/clear 清空', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  let acts = manager.publicState().activity;
  assert.equal(acts.length, 1, 'open 已记录一条');
  assert.equal(acts[0].type, 'open');
  // 非静默：广播一次；静默：只入库不发广播
  let emits = 0;
  const orig = manager._emitState.bind(manager);
  manager._emitState = () => { emits += 1; };
  manager.recordActivity('approve', '批准：Agent 点击「回复」');
  assert.equal(emits, 1, '非静默记录触发广播');
  manager.recordActivity('reject', '拒绝：Agent 输入', true);
  assert.equal(emits, 1, '静默记录不触发广播');
  manager._emitState = orig;
  acts = manager.publicState().activity;
  assert.deepEqual(acts.map(a => a.type), ['reject', 'approve', 'open'], '最新在前');
  // 封顶
  for (let i = 0; i < 40; i++) manager.recordActivity('nav', '打开 x' + i);
  assert.ok(manager._activityLog.length <= 30, '环形容量 30');
  assert.equal(manager.publicState().activity.length, 15, 'publicState 最多下发 15 条');
  manager.clearActivity();
  assert.equal(manager.publicState().activity.length, 0, '清除后为空');
  manager.relayout();
  assert.equal(manager.stripView._bounds.height, 40, '清除后活动行收起');
});

test('宽度记忆：全局默认 / 按工作区持久化 / 切换重读', () => {
  const saved = [];
  const mem = new Map();
  const { manager, tabManager } = setup(1600, 900);
  manager._store = { get: (k) => mem.get(k), set: (k, v) => { saved.push([k, v]); mem.set(k, v); } };
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  // 模拟 main.js 接线：active 变化 → 重读宽度
  tabManager.onActiveChange(() => { try { manager.recalcWidthForContext(); } catch (e) {} });
  manager.setWidth(600);
  assert.equal(manager.publicState().panelWidth, 600);
  assert.ok(saved.some(x => x[0] === 'browserPanelWidth' && x[1] === 600), '无工作区落全局键');
  const wsTab = { id: 'biz-ws', kind: 'business', workspaceId: 'ws-8f3c21', view: { webContents: { isDestroyed: () => false, id: 1 } } };
  tabManager.tabs.set('biz-ws', wsTab);
  tabManager.activeId = 'biz-ws';
  tabManager._onActiveChange('biz-ws');
  assert.equal(manager.width(), 600, '按工作区 scope 无值回落全局');
  manager.setWidth(520);
  assert.ok(saved.some(x => x[0] === 'browserPanelWidth.ws-8f3c21' && x[1] === 520), '写按工作区 scoped 键');
  saved.length = 0;
  tabManager.activeId = 'other';
  tabManager._onActiveChange('other');
  assert.equal(manager.width(), 600, '切到无记忆 tab 回落全局 600');
  tabManager.activeId = 'biz-ws';
  tabManager._onActiveChange('biz-ws');
  assert.equal(manager.width(), 520, '切回记忆工作区恢复 520');
});

test('审批高亮：updateApprovalList 驱动 selector 记录与清除（导航重注入钩子）', async () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  let injected = [];
  const wc = manager.panelView.webContents;
  wc.debugger.sendCommand = async (method, params) => { injected.push([method, params && params.expression ? 'expr' : params]); return {}; };
  await manager.updateApprovalList([
    { actionId: 'a1', method: 'Input.dispatchMouseEvent', summary: { label: '点击', selector: '#reply-btn' }, createdAt: 1, binding: {} },
  ]);
  assert.equal(manager._highlightSelector, '#reply-btn', '有待批带 selector → 记录并注入');
  assert.equal(injected[0][0], 'Runtime.evaluate');
  assert.ok(injected[0][1] === 'expr' && injected[0][0] === 'Runtime.evaluate');
  // 导航类（无 selector）→ 清除
  await manager.updateApprovalList([
    { actionId: 'a2', method: 'Page.navigate', summary: { label: '导航', url: 'https://x.test' }, createdAt: 2, binding: {} },
  ]);
  assert.equal(manager._highlightSelector, null, '无目标动作 → 清除');
  await manager.updateApprovalList([]);
  assert.equal(manager._highlightSelector, null, '空列表保持清除');
});

test('开合动画：open 从 0 展到目标宽，hide 收拢后才真正拆视图', async () => {
  const { manager } = setup(1600, 900, { animate: true });
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.width(), 480, '逻辑宽立即到位（记忆/广播不受动画影响）');
  assert.equal(manager.panelView._bounds.width, 0, '第 0 帧渲染宽 0（滑入起点）');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(manager.panelView._bounds.width, 480, '动画结束渲染宽=目标');
  manager.hide();
  assert.equal(manager.publicState().visible, true, '收拢动画期间仍算可见（延后拆视图）');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(manager.publicState().visible, false, '动画收拢后才真正隐藏');
  assert.equal(manager.gutterView._visible, false, '沟槽随收起隐藏');
});

test('收起动画中途重开：新动画顶掉旧 done，不会误拆视图', async () => {
  const { manager } = setup(1600, 900, { animate: true });
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  await new Promise((r) => setTimeout(r, 450));
  manager.hide();
  await new Promise((r) => setTimeout(r, 60));
  manager.show();
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(manager.publicState().visible, true, 'hide 动画未完成即 show → 面板保留');
  assert.equal(manager.panelView._bounds.width, 480);
});

test('拖拽磁吸：±14px 内吸附半宽/最大宽/最小宽，区间外不吸', () => {
  const { electron, manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  electron.setCursor(1120, 400); // 面板左缘（1600-480）→ grabOffset=0
  assert.equal(manager.beginResize(), true);
  electron.setCursor(807, 400); // raw=793 → 距半宽 800 差 7 → 吸
  manager._pollResize();
  assert.equal(manager.width(), 800);
  electron.setCursor(650, 400); // raw=950 → 距 60% 上限 960 差 10 → 吸
  manager._pollResize();
  assert.equal(manager.width(), 960);
  electron.setCursor(1221, 400); // raw=379 → 距手机比例下限 365 差 14 → 吸
  manager._pollResize();
  assert.equal(manager.width(), 365);
  electron.setCursor(995, 400); // raw=605 → 离所有吸附点都远 → 不吸
  manager._pollResize();
  assert.equal(manager.width(), 605);
  manager.endResize();
});

test('默认宽度 480，窄面板下限=手机比例宽，上限 60%', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.width(), 480);
  manager.setWidth(200);
  assert.equal(manager.width(), 365); // 最小 = 手机比例（页面区高×393/852）
  manager.clearActivity(); // 无活动行：页面区更高 → 最窄更宽
  manager.setWidth(200);
  assert.equal(manager.width(), Math.round((900 - 38 - 40) * (393 / 852))); // = 379
  manager.setWidth(10_000);
  assert.equal(manager.width(), 960); // 1600 * 0.6
});

test('最窄=手机视口比例：页面区宽高比恒为 393:852（跨窗口尺寸/小窗回落）', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.setWidth(100); // 往死了压也压不到比例以下
  const min900 = manager.width();
  assert.equal(min900, Math.round((900 - 38 - 70) * (393 / 852))); // open 活动行在
  const pageH = manager.panelView._bounds.height;
  assert.ok(Math.abs(min900 / pageH - 393 / 852) < 0.02, '面板页面区宽高比≈手机比例');
  // 高窗：最窄更宽，比例不变（受 60% 上限−沟槽的可用宽夹取）
  manager.window.getContentBounds = () => ({ x: 0, y: 0, width: 1600, height: 1200 });
  manager.setWidth(100);
  const min1200 = manager.width();
  assert.ok(min1200 > min900, '窗口越高手机形态越宽');
  assert.equal(min1200, Math.min(Math.round((1200 - 38 - 70) * (393 / 852)), Math.floor(1600 * 0.6) - 12, 560));
  // 矮窗：比例算出来低于绝对兜底 320 → 回落 320（可用性优先）
  manager.window.getContentBounds = () => ({ x: 0, y: 0, width: 1600, height: 700 });
  manager.setWidth(100);
  assert.equal(manager.width(), 320);
  // 活动行占位参与计算：清空后页面区更高 → 最窄按比例变宽
  manager.window.getContentBounds = () => ({ x: 0, y: 0, width: 1600, height: 900 });
  manager.clearActivity();
  manager.setWidth(100);
  assert.equal(manager.width(), Math.round((900 - 38 - 40) * (393 / 852)));
});

test('快捷打开联动：面板导航到平台站 → 广播 platform-focus 给业务视图；非平台站不发', () => {
  const { manager, tabManager } = setup(1600, 900);
  const sent = [];
  const focus = () => sent.filter((s) => s.channel === 'browser-panel:platform-focus');
  tabManager.sendToBusiness = (channel, payload) => { sent.push({ channel, payload }); return true; };
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.navigate('https://www.xiaohongshu.com');
  assert.equal(focus().length, 1);
  assert.equal(focus()[0].payload.platform, 'xiaohongshu');
  assert.equal(focus()[0].payload.url, 'https://www.xiaohongshu.com/', 'url 为归一化后的导航地址');
  manager.navigate('https://www.douyin.com/jingxuan');
  assert.equal(focus()[1].payload.platform, 'douyin');
  manager.navigate('https://channels.weixin.qq.com');
  assert.equal(focus()[2].payload.platform, 'wechat-channel');
  // 无对应获客页的站点不联动（公众号/百度/杂站）
  manager.navigate('https://mp.weixin.qq.com');
  manager.navigate('https://www.baidu.com');
  assert.equal(focus().length, 3, '非平台站不得广播');
  // 纯函数边界：非法 URL / 子域误伤防护
  const { matchPanelPlatform } = require('./browser-panel-manager');
  assert.equal(matchPanelPlatform('not-a-url'), null);
  assert.equal(matchPanelPlatform('https://fake-xiaohongshu.com.evil.cn/'), null);
  assert.equal(matchPanelPlatform('https://www.kuaishou.com'), 'kuaishou');
});

test('布局：面板占右列，控制条在业务区之上，rightInset 通知 TabManager', () => {
  const { manager, tabManager, window } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const { width, height } = window.getContentBounds();
  const panel = manager.panelView;
  const strip = manager.stripView;
  assert.equal(panel._bounds.width, 480);
  assert.equal(panel._bounds.x, width - 480);
  assert.equal(strip._bounds.x, width - 480);
  assert.equal(strip._bounds.height, 70, 'open 记录了一条活动 → 控制条含活动行');
  assert.equal(panel._bounds.y, 38 + 70);
  manager.clearActivity();
  assert.equal(strip._bounds.height, 40, '清空活动后控制条复原一行'); // tab 条 + 控制条之下
  assert.equal(panel._bounds.height, height - 38 - 40);
  assert.equal(tabManager.rightInset, 480 + PANEL_GUTTER, '业务区还要多让出一条沟');
  // 业务视图（模拟）不侵入面板区域
  const biz = tabManager.businessBoundsFor(width, height);
  assert.equal(biz.x + biz.width, width - 480 - PANEL_GUTTER);
});

test('窗口缩小时面板宽度自动重新夹取（60% 上限，不挤压主内容）', () => {
  const { manager, window, tabManager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.setWidth(900); // 900 < 1600*0.6=960 允许
  assert.equal(manager.width(), 900);
  window.width = 1000; // 窗口收窄 → 60% 上限 600，relayout 自动夹取
  manager.relayout();
  assert.equal(manager.width(), 600);
  assert.equal(tabManager.rightInset, 600 + PANEL_GUTTER);
  assert.equal(manager.panelView._bounds.width, 600);
});

test('关闭=隐藏：会话与 partition 保留，重开恢复同一 webContents', () => {
  const { manager, tabManager } = setup();
  const state = manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const firstWcId = manager.panelWebContents().id;
  assert.equal(state.session.partition, 'persist:kaypal-browser-u1');
  manager.hide();
  assert.equal(manager.publicState().visible, false);
  assert.equal(tabManager.rightInset, 0);
  assert.ok(manager.session, '会话应保留');
  manager.show();
  assert.equal(manager.panelWebContents().id, firstWcId);
  assert.equal(manager.publicState().visible, true);
});

test('换账号 → 重建视图 + 新持久 partition', () => {
  const { manager } = setup();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const wcA = manager.panelWebContents();
  manager.open({ url: 'http://127.0.0.1:8080/y', ownerId: 'u2', tenantId: 't1' });
  const wcB = manager.panelWebContents();
  assert.notEqual(wcA.id, wcB.id);
  assert.equal(wcA._destroyed, true, '旧视图应被销毁');
  assert.equal(manager.session.partition, 'persist:kaypal-browser-u2');
});

test('导航协议白名单：javascript:/file: 拒绝', async () => {
  const { manager } = setup();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.throws(() => manager.navigate('javascript:alert(1)'), /http\/https/);
  assert.throws(() => manager.navigate('file:///etc/passwd'), /http\/https/);
  assert.throws(() => manager.navigate('not a url'), /地址无效/);
});

test('面板视图零特权：sandbox:true + 无 preload + contextIsolation', () => {
  const { manager } = setup();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const prefs = manager.panelView.webPreferences;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.ok(!prefs.preload, '第三方 web 视图不允许挂 preload');
});

test('状态机广播：导航成功→ready；主框架失败→error；渲染崩溃→blocked', () => {
  const { manager, tabManager } = setup();
  const received = [];
  tabManager.sendToBusiness = (channel, payload) => {
    if (channel === 'browser-panel:state') received.push(payload.session?.status);
    return true;
  };
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const wc = manager.panelWebContents();
  wc.emit('did-navigate', null, 'http://127.0.0.1:8080/x');
  wc.emit('did-fail-load', null, -105, 'ERR_NAME_NOT_RESOLVED', 'http://bad/', true);
  wc.emit('render-process-gone', null, { reason: 'crashed' });
  assert.ok(received.includes('ready'));
  assert.ok(received.includes('error'));
  assert.ok(received.includes('blocked'));
});

test('新 tab 一律拦截并转受控 tab（round17：deny + popup-opened-in-tab，不外逃）', () => {
  const { manager, tabManager } = setup();
  const events = [];
  tabManager.sendToBusiness = (channel, payload) => {
    events.push([channel, payload]);
    return true;
  };
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const handler = manager.panelWebContents()._openHandler;
  assert.equal(handler({ url: 'https://evil/x' }).action, 'deny');
  // round17 语义升级：不再只 deny+回报 blocked，而是 deny 原窗口 + 面板内受控 tab 打开
  assert.ok(events.some(([c]) => c === 'browser-panel:popup-opened-in-tab'));
  assert.ok(!events.some(([c]) => c === 'browser-panel:popup-blocked'), '正常路径无 blocked 回报');
});

test('isStripSender：只认控制条视图', () => {
  const { manager } = setup();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.isStripSender(manager.stripView.webContents), true);
  assert.equal(manager.isStripSender(manager.panelWebContents()), false);
  assert.equal(manager.isStripSender(null), false);
});

test('resolvePanelTarget：三方绑定（阶段 1 事实源）', () => {
  const { manager } = setup();
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const target = manager.resolvePanelTarget();
  assert.equal(target.panelId, manager.session.panelId);
  assert.equal(target.sessionId, manager.session.sessionId);
  assert.equal(target.webContentsId, manager.panelWebContents().id);
  assert.ok(target.url.startsWith('http://127.0.0.1:8080/'));
});

// ── 阶段 6 决策 ③：面板模式开关（0600 文件投递）─────────────────────────────
test('③ 默认 off：无 userDataDir / 文件缺失 → agentMode=off（铁律不变）', () => {
  const { manager } = setup();
  assert.equal(manager.getAgentMode(), 'off');
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.publicState().agentMode, 'off');
});

test('③ setAgentMode(true) → 写 0600 文件，回读 on；publicState 同步', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mode-mgr-'));
  const { manager } = setup(1600, 900, { userDataDir: dir });
  const modePath = path.join(dir, 'browser-panel-mode.json');
  assert.equal(fs.existsSync(modePath), false);
  const result = manager.setAgentMode(true);
  assert.equal(result, 'on');
  assert.equal(manager.getAgentMode(), 'on');
  assert.equal(manager.publicState().agentMode, 'on');
  // 0600 权限落盘（POSIX 才有意义，Windows 上 mode 位忽略）
  if (process.platform !== 'win32') {
    const stat = fs.statSync(modePath);
    assert.equal(stat.mode & 0o777, 0o600, `应 0600，实际 ${stat.mode.toString(8)}`);
  }
  const payload = JSON.parse(fs.readFileSync(modePath, 'utf8'));
  assert.equal(payload.protocol, 'kaypal-browser-panel-mode');
  assert.equal(payload.mode, 'on');
  assert.equal(payload.pid, process.pid);
});

test('③ setAgentMode(false) → 文件删除（而非写 off），回读 off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mode-mgr-'));
  const { manager } = setup(1600, 900, { userDataDir: dir });
  const modePath = path.join(dir, 'browser-panel-mode.json');
  manager.setAgentMode(true);
  assert.ok(fs.existsSync(modePath));
  assert.equal(manager.setAgentMode(false), 'off');
  assert.equal(fs.existsSync(modePath), false, '关闭 = 删文件，不留残留');
  assert.equal(manager.getAgentMode(), 'off');
});

test('③ setAgentMode 必须广播状态（stage7 真机抓的 bug：不广播 → 控制条用陈旧态 toggle）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mode-mgr-'));
  const { manager, tabManager } = setup(1600, 900, { userDataDir: dir });
  // 2026-09-04 阶段 5：open 现在会自动补开 agent mode（广播一次 on），
  // 断言只看后两次手动 toggle 的广播（末两位），open 那次不参与
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const pushed = [];
  tabManager.sendToBusiness = (channel, payload) => {
    if (channel === 'browser-panel:state') pushed.push(payload.agentMode);
    return true;
  };
  manager.setAgentMode(true);
  manager.setAgentMode(false);
  // 两次 toggle 各广播一次，且 agentMode 跟着变（控制条按钮靠它高亮/去高亮）
  assert.deepEqual(pushed.slice(-2), ['on', 'off']);
});

// ── 阶段 5（2026-09-04）：open 自动补开 agent mode ─────────────────────────
test('③ 阶段5 open 自动补开 agent mode：mode 文件落盘 on（点「在面板中打开」即授权使用面板）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mode-mgr-'));
  const { manager } = setup(1600, 900, { userDataDir: dir });
  const modePath = path.join(dir, 'browser-panel-mode.json');
  assert.equal(fs.existsSync(modePath), false);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.getAgentMode(), 'on');
  assert.equal(manager.publicState().agentMode, 'on');
  const payload = JSON.parse(fs.readFileSync(modePath, 'utf8'));
  assert.equal(payload.protocol, 'kaypal-browser-panel-mode');
  assert.equal(payload.mode, 'on');
  assert.equal(payload.pid, process.pid);
});

test('③ 阶段5 已 on 时 open 不重写文件（pid/startedAt 不被 open 覆盖）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mode-mgr-'));
  const { manager } = setup(1600, 900, { userDataDir: dir });
  const modePath = path.join(dir, 'browser-panel-mode.json');
  manager.setAgentMode(true);
  const before = fs.readFileSync(modePath, 'utf8');
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(fs.readFileSync(modePath, 'utf8'), before, '已 on 时 open 不应重写 mode 文件');
});

test('③ 阶段5 无 userDataDir 时 open 不炸（自动补开失败被吃掉，面板照常打开）', () => {
  const { manager } = setup(1600, 900); // 无 userDataDir
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.publicState().visible, true);
  assert.equal(manager.publicState().agentMode, 'off');
});

test('③ destroy() → 主动清掉开关文件（不留残留给下一次会话）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-mode-mgr-'));
  const { manager } = setup(1600, 900, { userDataDir: dir });
  const modePath = path.join(dir, 'browser-panel-mode.json');
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.setAgentMode(true);
  assert.ok(fs.existsSync(modePath));
  manager.destroy();
  assert.equal(fs.existsSync(modePath), false);
});

test('③ getUserDataDir 抛异常 → 读一律 off，写显式报错（不静默写 cwd）', () => {
  const { manager } = setup(1600, 900, { throwingDir: true });
  assert.equal(manager.getAgentMode(), 'off');
  assert.throws(() => manager.setAgentMode(true), /userData/);
});

// ── 阶段 7 round11：tabs 主进程台账（panelView 恒 = active tab 视图）────────

test('⑪ tabs new：台账 +1、active 指向新 view、panelView 换绑、新 tab 同 partition', () => {
  const { manager, window } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const firstWcId = manager.panelView.webContents.id;
  const snap = manager.tabsOperation('new');
  assert.equal(snap.tabs, 2);
  assert.equal(snap.activeIndex, 1);
  assert.equal(snap.url, 'about:blank'); // 新 tab = 空白页（对齐旧无头 newPage）
  assert.notEqual(manager.panelView.webContents.id, firstWcId);
  assert.equal(manager._panelTabs[0].view.webContents.id, firstWcId);
  assert.equal(
    manager._panelTabs[1].view.webPreferences.partition,
    manager._panelTabs[0].view.webPreferences.partition,
  );
  // 会话 URL 跟 active 走（不许残留旧 tab 的 URL——自相矛盾证据）
  assert.equal(manager.session.currentUrl, 'about:blank');
  // 层级：active tab 在子视图列表、审批浮层置顶
  assert.ok(window.children.includes(manager.panelView));
});

test('⑪ tabs switch：合法切换换绑 panelView + webContentsId 变；越界显式失败', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.tabsOperation('new');
  const secondWcId = manager.panelView.webContents.id;
  const snap = manager.tabsOperation('switch', 0);
  assert.equal(snap.activeIndex, 0);
  assert.equal(manager.panelView.webContents.id, manager._panelTabs[0].view.webContents.id);
  assert.notEqual(manager.panelView.webContents.id, secondWcId);
  assert.equal(manager.publicState().tabActiveIndex, 0);
  // 越界：显式失败（对齐 fail-closed，不静默 fallback pages[0]——与旧无头的差异交底）
  assert.throws(() => manager.tabsOperation('switch', 5), /不存在/);
  assert.throws(() => manager.tabsOperation('switch', -1), /不存在/);
});

test('⑪ tabs close：关后台 tab 修正 active 下标；关 active 落到相邻；最后一个不可关', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const t0 = manager.panelView;
  manager.tabsOperation('new'); // active=1
  manager.tabsOperation('new'); // active=2，台账 3
  // 关后台 tab 0：panelView 不变（仍是 active=2 的视图），active 下标左移
  const activeBefore = manager.panelView.webContents.id;
  const snap = manager.tabsOperation('close', 0);
  assert.equal(snap.tabs, 2);
  assert.equal(snap.activeIndex, 1);
  assert.equal(manager.panelView.webContents.id, activeBefore);
  assert.equal(t0.webContents._destroyed, true, '被关 tab 的 webContents 应被 close');
  // 关 active（index=1）→ 落到相邻 0
  const snap2 = manager.tabsOperation('close', 1);
  assert.equal(snap2.activeIndex, 0);
  assert.equal(manager._panelTabs.length, 1);
  // 最后一个不可关（对齐旧无头 pages[0] 保护的动机：面板永远保留一个页面）
  assert.throws(() => manager.tabsOperation('close', 0), /最后一个/);
});

test('⑪ tabs close 缺省 index = 关当前 active', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const firstWcId = manager.panelView.webContents.id;
  manager.tabsOperation('new'); // active=1（新 tab）
  manager.tabsOperation('close'); // 缺省 → 关 active（新 tab）
  assert.equal(manager._panelTabs.length, 1);
  assert.equal(manager.panelView.webContents.id, firstWcId);
});

test('⑪ tabs 未打开面板 → 显式失败；未知 operation → 显式失败', () => {
  const { manager } = setup(1600, 900);
  assert.throws(() => manager.tabsOperation('new'), /未打开/);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.throws(() => manager.tabsOperation('explode'), /未知/);
});

test('⑪ 后台 tab 的导航事件不得污染会话 currentUrl/status（多 tab 事件隔离）', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.tabsOperation('new'); // active=1（新 tab）
  const activeWc = manager.panelView.webContents;
  const bgWc = manager._panelTabs[0].view.webContents;
  // 后台 tab 触发导航：session 不动
  bgWc.emit('did-navigate', null, 'http://evil.example/backdoor');
  assert.notEqual(manager.session.currentUrl, 'http://evil.example/backdoor');
  // active tab 触发导航：session 跟随
  activeWc.emit('did-navigate', null, 'http://127.0.0.1:8080/active-page');
  assert.equal(manager.session.currentUrl, 'http://127.0.0.1:8080/active-page');
  assert.equal(manager.session.status, 'ready');
});

test('⑪ 换账号 → 台账全清（不留幽灵 view）；destroy 同样清台账', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.tabsOperation('new');
  assert.equal(manager._panelTabs.length, 2);
  manager.open({ url: 'http://127.0.0.1:8080/y', ownerId: 'u2', tenantId: 't1' });
  assert.equal(manager._panelTabs.length, 1, '账号切换 = 换登录态世界，台账重建为单 tab');
  assert.equal(manager._activeTabIndex, 0);
  manager.destroy();
  assert.equal(manager._panelTabs.length, 0);
  assert.equal(manager.panelView, null);
});

// ===== ⑮ tab 条 UI（round15）：用户手动切/关 tab + tabList + 动态 strip 高度 =====

test('⑮ switchTabByUser 合法 → ok+换绑+tabList 进 publicState；越界 → ok:false 不抛', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/page-a', ownerId: 'u1', tenantId: 't1' });
  manager.tabsOperation('new');
  const wc1 = manager.panelView.webContents;
  const out = manager.switchTabByUser(0);
  assert.equal(out.ok, true);
  assert.equal(out.snapshot.activeIndex, 0);
  assert.notEqual(manager.panelView.webContents.id, wc1.id, 'panelView 换绑回 tab0');
  const state = manager.publicState();
  assert.equal(state.tabList.length, 2);
  assert.equal(state.tabActiveIndex, 0);
  assert.equal(state.tabList[0].url, 'http://127.0.0.1:8080/page-a');
  // 越界：UI 通道不抛，转 ok:false
  const bad = manager.switchTabByUser(9);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不存在/);
});

test('⑮ closeTabByUser：关后台修正下标 + 触发 relayout；最后一个 → ok:false 不抛', () => {
  const { manager, tabManager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  manager.tabsOperation('new');
  manager.tabsOperation('new'); // active=2，台账 3
  const relayoutsBefore = tabManager.relayouts.length;
  const out = manager.closeTabByUser(0); // 关后台
  assert.equal(out.ok, true);
  assert.equal(out.snapshot.tabs, 2);
  assert.equal(manager._activeTabIndex, 1, '关后台 tab 后 active 下标修正');
  assert.ok(tabManager.relayouts.length > relayoutsBefore, 'tab 数变化必须 relayout（tab 条出现/消失改变 strip 高度）');
  // 关到只剩一个，再关 → ok:false 不抛
  manager.closeTabByUser(0);
  const last = manager.closeTabByUser(0);
  assert.equal(last.ok, false);
  assert.match(last.error, /最后一个/);
  assert.equal(manager._panelTabs.length, 1);
});

test('⑮ strip 动态高度：单 tab 40px、多 tab 66px（tab 条只在多 tab 时占位）', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  manager.show();
  assert.equal(manager.stripView._bounds.height, 70, '单 tab + 活动行（open 记录）');
  assert.equal(manager.panelView._bounds.y, 38 + 70);
  manager.tabsOperation('new');
  assert.equal(manager.stripView._bounds.height, 96, '多 tab：tab 条行 + 活动行');
  assert.equal(manager.panelView._bounds.y, 38 + 96, '面板页随之下移');
  manager.tabsOperation('close', 1);
  assert.equal(manager.stripView._bounds.height, 70, '回到单 tab：tab 条消失、活动行仍在');
  manager.clearActivity();
  assert.equal(manager.stripView._bounds.height, 40, '清空活动后复原');
});

test('⑮ page-title-updated：active 刷新 tabList；后台不广播（active-only 隔离）', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  manager.tabsOperation('new');
  const bgWc = manager._panelTabs[0].view.webContents;
  const activeWc = manager.panelView.webContents;
  bgWc.getTitle = () => '后台标题';
  activeWc.getTitle = () => '前台标题';
  let emits = 0;
  const orig = manager._emitState.bind(manager);
  manager._emitState = () => { emits += 1; orig(); };
  const emitsBefore = emits;
  bgWc.emit('page-title-updated', null, '后台标题');
  assert.equal(emits, emitsBefore, '后台 tab 标题变化不广播');
  activeWc.emit('page-title-updated', null, '前台标题');
  assert.equal(emits, emitsBefore + 1, 'active 标题变化触发广播');
  assert.equal(manager.publicState().tabList[1].title, '前台标题');
});

// ===== ⑯ popup 转受控 tab（round17）：deny 原 popup + 面板内自动开 tab =====
test('⑯ windowOpenHandler：popup URL 转 panels 内受控新 tab（deny + loadURL + 事件回报）', () => {
  const { manager, tabManager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  const sent = [];
  tabManager.sendToBusiness = (channel, payload) => { sent.push({ channel, payload }); return true; };
  const wc = manager.panelView.webContents;
  assert.equal(typeof wc._openHandler, 'function', 'handler 已注册');
  const decision = wc._openHandler({ url: 'http://127.0.0.1:8080/popup-target' });
  assert.deepEqual(decision, { action: 'deny' }, '原 popup 一律 deny');
  // 新 tab 已创建并成为 active，目标 URL 已加载进受控 tab
  assert.equal(manager._panelTabs.length, 2);
  assert.equal(manager.panelView.webContents.getURL(), 'http://127.0.0.1:8080/popup-target');
  // fake loadURL 不触发事件链——模拟真实导航完成事件后 session.currentUrl 跟进
  manager.panelView.webContents.emit('did-navigate', null, 'http://127.0.0.1:8080/popup-target');
  assert.equal(manager.session.currentUrl, 'http://127.0.0.1:8080/popup-target');
  const evt = sent.find((s) => s.channel === 'browser-panel:popup-opened-in-tab');
  assert.ok(evt, '回报 popup-opened-in-tab');
  assert.equal(evt.payload.url, 'http://127.0.0.1:8080/popup-target');
  assert.equal(evt.payload.tabs, 2);
});

test('⑯ windowOpenHandler：转 tab 异常 → 兜底 popup-blocked 回报且仍 deny（不外逃）', () => {
  const { manager, tabManager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  const sent = [];
  tabManager.sendToBusiness = (channel, payload) => { sent.push({ channel, payload }); return true; };
  const orig = manager.tabsOperation.bind(manager);
  manager.tabsOperation = () => { throw new Error('boom'); };
  const wc = manager.panelView.webContents;
  const decision = wc._openHandler({ url: 'http://127.0.0.1:8080/popup-x' });
  assert.deepEqual(decision, { action: 'deny' });
  const evt = sent.find((s) => s.channel === 'browser-panel:popup-blocked');
  assert.ok(evt, '兜底回报 popup-blocked');
  assert.equal(evt.payload.error, 'boom');
  manager.tabsOperation = orig;
});

// ===== ⑰ 导航守卫豁免（2026-09-04 微信登录卡死修复）：ownsWebContents 归属判断 =====
test('⑰ ownsWebContents：面板/控制条/审批视图命中，外部 webContents 与异常输入不命中', () => {
  const { manager, electron } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/a', ownerId: 'u1', tenantId: 't1' });
  // 面板视图与控制条、审批浮层均应命中（面板 open 时三视图齐备）
  assert.equal(manager.ownsWebContents(manager.panelView.webContents), true, '面板视图命中');
  assert.equal(manager.ownsWebContents(manager.stripView.webContents), true, '控制条视图命中');
  assert.equal(manager.ownsWebContents(manager.approvalView.webContents), true, '审批浮层视图命中');
  // 用 id 数字同样命中（main.js 守卫传实例，兼容 id 形态）
  assert.equal(manager.ownsWebContents(manager.panelView.webContents.id), true, '按 id 命中');
  // 外部 webContents（如主窗/3010 业务视图）不命中——守卫白名单继续保护
  const outsider = new electron.FakeWebContents('persist:outsider');
  assert.equal(manager.ownsWebContents(outsider), false, '外部 webContents 不命中');
  assert.equal(manager.ownsWebContents(outsider.id), false, '外部 id 不命中');
  // 异常/退化输入不抛
  assert.equal(manager.ownsWebContents(null), false, 'null 不命中');
  assert.equal(manager.ownsWebContents(undefined), false, 'undefined 不命中');
  assert.equal(manager.ownsWebContents({}), false, '无 getId 的对象不命中');
  // 销毁后一律 false（守卫侧异常路径安全）
  manager._destroyed = true;
  assert.equal(manager.ownsWebContents(manager.panelView.webContents), false, '销毁后不命中');
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
    console.error(`PANEL MANAGER SPEC FAILED: ${failed}`);
    process.exitCode = 1;
  } else {
    console.log(`PANEL MANAGER SPEC PASSED (${tests.length})`);
  }
})();
