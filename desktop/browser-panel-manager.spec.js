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
  return { WebContentsView, FakeWebContents, idSeq: () => idSeq };
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
    getContentBounds: () => ({ width: fakeWindow.width, height: fakeWindow.height }),
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
  };
  return tabManager;
}

function setup(width = 1600, height = 900, opts = {}) {
  const electron = makeFakeElectron();
  const tabManager = makeTabManager();
  const window = makeFakeWindow(width, height);
  const { BrowserPanelManager } = require('./browser-panel-manager');
  const manager = new BrowserPanelManager({
    electron,
    store: { get: () => undefined, set: () => undefined },
    tabManager,
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

test('默认宽度 480，窄面板下限 360，上限 60%', () => {
  const { manager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  assert.equal(manager.width(), 480);
  manager.setWidth(200);
  assert.equal(manager.width(), 360); // 最小
  manager.setWidth(10_000);
  assert.equal(manager.width(), 960); // 1600 * 0.6
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
  assert.equal(strip._bounds.height, 40);
  assert.equal(panel._bounds.y, 38 + 40); // tab 条 + 控制条之下
  assert.equal(panel._bounds.height, height - 38 - 40);
  assert.equal(tabManager.rightInset, 480);
  // 业务视图（模拟）不侵入面板区域
  const biz = tabManager.businessBoundsFor(width, height);
  assert.equal(biz.x + biz.width, width - 480);
});

test('窗口缩小时面板宽度自动重新夹取（60% 上限，不挤压主内容）', () => {
  const { manager, window, tabManager } = setup(1600, 900);
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  manager.setWidth(900); // 900 < 1600*0.6=960 允许
  assert.equal(manager.width(), 900);
  window.width = 1000; // 窗口收窄 → 60% 上限 600，relayout 自动夹取
  manager.relayout();
  assert.equal(manager.width(), 600);
  assert.equal(tabManager.rightInset, 600);
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
  assert.equal(manager.stripView._bounds.height, 40, '单 tab：控制条一行不变');
  assert.equal(manager.panelView._bounds.y, 38 + 40);
  manager.tabsOperation('new');
  assert.equal(manager.stripView._bounds.height, 66, '多 tab：tab 条行出现');
  assert.equal(manager.panelView._bounds.y, 38 + 66, '面板页随之下移');
  manager.tabsOperation('close', 1);
  assert.equal(manager.stripView._bounds.height, 40, '回到单 tab：tab 条消失');
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
