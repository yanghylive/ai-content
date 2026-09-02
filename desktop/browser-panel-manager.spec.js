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

function setup(width = 1600, height = 900) {
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

test('新 tab 一律拦截并回报（popup-blocked）', () => {
  const { manager, tabManager } = setup();
  const events = [];
  tabManager.sendToBusiness = (channel, payload) => {
    events.push([channel, payload]);
    return true;
  };
  manager.open({ url: 'http://127.0.0.1:8080/x', ownerId: 'u1', tenantId: 't1' });
  const handler = manager.panelWebContents()._openHandler;
  assert.equal(handler({ url: 'https://evil/x' }).action, 'deny');
  assert.ok(events.some(([c]) => c === 'browser-panel:popup-blocked'));
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
