/**
 * workspace-tabs.js — ai-content 桌面端多工作区标签壳（方案 A：WebContentsView per tab）
 *
 * 设计要点：
 *  - 每个标签 = 一个独立 WebContentsView，使用独立持久 partition（persist:ws-tab-<uuid>），
 *    因此每个标签拥有独立的 cookie / localStorage / 登录态，天然隔离。
 *  - 每个标签的 session 通过 webRequest.onBeforeSendHeaders 注入 x-workspace-id（仅 localhost/127.0.0.1 请求），
 *    后端 KaypalAuthGuard 据此做第 4 维（workspace）隔离与归属校验。前端代码零改动。
 *  - 标签列表与激活态持久化到 electron-store；重启后复用同一 partition id，登录态保留。
 *  - 窗口 contentView 下挂：顶部 tab 条（WebContentsView, tab-strip.html）+ 当前激活标签内容视图。
 *
 * 该模块保持对 main.js 的最小入侵：main.js 仅负责创建 BrowserWindow 后调用 attach()，
 * 并把原窗口级 handler（崩溃自愈 / 外链 / 更新广播）下沉到本模块。
 */

const { WebContentsView, session, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

const TAB_STRIP_HEIGHT = 38;
const TAB_MODULE_VERSION = 1;

// 持久化键
const STORE_KEY_TABS = 'workspaceTabs';
const STORE_KEY_ACTIVE = 'activeTabId';

// 是否为本应用自托管的 localhost 请求（前端静态资源 3010 + 后端 API 3011）。
// 只有这些请求才注入 x-workspace-id，避免外泄到第三方域名。
function isLocalAppRequest(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      (u.port === '3010' || u.port === '3011')
    );
  } catch {
    return false;
  }
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function isDev() {
  return process.env.NODE_ENV === 'development';
}

/**
 * 在指定 partition 上挂 x-workspace-id 注入。
 * 闭包读取 tab.workspaceId 的当前值，运行时改 workspaceId 立即生效。
 */
function installWorkspaceHeaderInjection(tabSession, getWorkspaceId) {
  if (!tabSession || !tabSession.webRequest) return;
  tabSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const workspaceId = getWorkspaceId();
    if (workspaceId && isLocalAppRequest(details.url)) {
      details.requestHeaders['x-workspace-id'] = workspaceId;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

class TabManager {
  constructor(store) {
    this.store = store;
    this.window = null;
    this.tabStrip = null;
    this.tabs = new Map(); // id -> { id, workspaceId, title, view, ready }
    this.activeId = null;
    this.frontendServerUrl = null;
    this.knownWebContents = new Set(); // 我们持有的所有 webContents（标签视图 + tab 条）
  }

  setFrontendUrl(url) {
    this.frontendServerUrl = url;
  }

  // 供外部（IPC 来源校验 / 更新广播）判断某个 webContents 是否归属于本壳。
  isOwnedWebContents(contents) {
    if (!contents) return false;
    return this.knownWebContents.has(contents);
  }

  // 向所有标签内容视图广播（含 tab 条忽略未知 channel）。
  broadcast(channel, ...args) {
    for (const tab of this.tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        try {
          tab.view.webContents.send(channel, ...args);
        } catch {
          /* ignore */
        }
      }
    }
  }

  attach(window) {
    this.window = window;
    // 若窗口被重建（mac 极少，但防御性），先清空旧引用再重建。
    this.tabs.clear();
    this.knownWebContents.clear();
    this.activeId = null;

    this._ensureTabStrip();
    this._restoreTabs();
    if (this.tabs.size === 0) {
      this._createTab({ workspaceId: null, title: '工作台' });
    }
    this.switchTo(this.activeId || this._firstTabId());
    this.relayout();
    this._pushStripState();

    window.on('resize', () => this.relayout());
  }

  _ensureTabStrip() {
    const stripView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'tab-strip-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        partition: 'persist:ai-content-tab-strip'
      }
    });
    stripView.webContents.loadFile(path.join(__dirname, 'tab-strip.html'));
    this.knownWebContents.add(stripView.webContents);
    stripView.webContents.on('ipc-message' /* fallback */, () => {});
    // tab 条交互全部走 ipcMain.handle / ipcMain.on，见 registerIpc()。
    this.tabStrip = stripView;
    this.window.contentView.addChildView(stripView);
  }

  _restoreTabs() {
    let saved = [];
    try {
      saved = this.store.get(STORE_KEY_TABS) || [];
    } catch {
      saved = [];
    }
    if (!Array.isArray(saved)) saved = [];
    for (const rec of saved) {
      if (!rec || !rec.id) continue;
      this._createTab(
        { workspaceId: rec.workspaceId ?? null, title: rec.title || '工作台' },
        rec.id
      );
    }
    const active = this.store.get(STORE_KEY_ACTIVE);
    if (active && this.tabs.has(active)) {
      this.activeId = active;
    }
  }

  _firstTabId() {
    return this.tabs.keys().next().value || null;
  }

  _createTab({ workspaceId = null, title = '工作台' }, forcedId = null) {
    const id = forcedId || genId();
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        partition: `persist:ws-tab-${id}`
      }
    });

    const tab = { id, workspaceId, title, view, ready: false };
    this.tabs.set(id, tab);
    this.knownWebContents.add(view.webContents);

    // —— 关键：每 tab 独立 session 注入 x-workspace-id ——
    installWorkspaceHeaderInjection(view.webContents.session, () => tab.workspaceId);

    // 崩溃 / 加载失败自愈（原窗口级 handler 下沉到各 tab 视图）
    view.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      console.warn(`[Tab ${id}] 渲染进程退出，自动恢复:`, details.reason);
      setTimeout(() => {
        if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload();
      }, 500);
    });
    view.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      console.warn(`[Tab ${id}] 前端加载失败(${code}): ${desc}，自动重试`);
      setTimeout(() => {
        if (tab.view && !tab.view.webContents.isDestroyed() && this.frontendServerUrl) {
          tab.view.webContents.loadURL(this.frontendServerUrl);
        }
      }, 1000);
    });
    view.webContents.on('unresponsive', () => {
      console.warn(`[Tab ${id}] 视图无响应，尝试恢复`);
      setTimeout(() => {
        if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload();
      }, 500);
    });

    // 外链在系统浏览器打开
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    if (isDev()) view.webContents.openDevTools({ mode: 'detach' });

    view.webContents.loadURL(this.frontendServerUrl || 'http://localhost:3010');

    this.window.contentView.addChildView(view);
    return tab;
  }

  _removeViewFromWindow(view) {
    try {
      this.window.contentView.removeChildView(view);
    } catch {
      /* ignore */
    }
  }

  switchTo(id) {
    if (!this.tabs.has(id)) return false;
    // 隐藏其它视图、显示目标视图
    for (const [tid, tab] of this.tabs) {
      if (tid === id) continue;
      this._removeViewFromWindow(tab.view);
    }
    const target = this.tabs.get(id);
    // 确保目标视图在窗口中
    try {
      this.window.contentView.addChildView(target.view);
    } catch {
      /* 已在窗口中 */
    }
    this.activeId = id;
    this.store.set(STORE_KEY_ACTIVE, id);
    this.relayout();
    this._pushStripState();
    return true;
  }

  createTab({ workspaceId = null, title = '工作台' } = {}) {
    const tab = this._createTab({ workspaceId, title });
    this.persist();
    this.switchTo(tab.id);
    return tab.id;
  }

  closeTab(id) {
    if (!this.tabs.has(id)) return false;
    const tab = this.tabs.get(id);
    this._removeViewFromWindow(tab.view);
    try {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.destroy();
    } catch {
      /* ignore */
    }
    this.knownWebContents.delete(tab.view.webContents);
    this.tabs.delete(id);

    if (this.activeId === id) {
      const next = this._firstTabId();
      if (next) {
        this.switchTo(next);
      } else {
        // 关掉最后一个 → 开一个默认空白标签，保持窗口不空
        this.createTab({ workspaceId: null, title: '工作台' });
        return true;
      }
    }
    this.persist();
    this._pushStripState();
    return true;
  }

  renameTab(id, title) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    tab.title = title || '工作台';
    this.persist();
    this._pushStripState();
    return true;
  }

  // 运行时绑定 / 解绑 workspace（注入头立即生效，因闭包读 tab.workspaceId）
  setWorkspaceId(id, workspaceId) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    tab.workspaceId = workspaceId || null;
    this.persist();
    this._pushStripState();
    return true;
  }

  getActive() {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    return tab ? { id: tab.id, workspaceId: tab.workspaceId, title: tab.title } : null;
  }

  list() {
    return Array.from(this.tabs.values()).map((t) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      title: t.title,
      active: t.id === this.activeId
    }));
  }

  relayout() {
    if (!this.window || !this.tabStrip) return;
    const { width, height } = this.window.getContentBounds();
    const w = Math.max(0, width);
    const h = Math.max(0, height);
    // tab 条：顶部通栏
    this.tabStrip.setBounds({ x: 0, y: 0, width: w, height: TAB_STRIP_HEIGHT });
    // 内容：tab 条下方铺满
    const contentY = TAB_STRIP_HEIGHT;
    const contentH = Math.max(0, h - TAB_STRIP_HEIGHT);
    for (const tab of this.tabs.values()) {
      try {
        tab.view.setBounds({ x: 0, y: contentY, width: w, height: contentH });
      } catch {
        /* ignore */
      }
    }
  }

  persist() {
    try {
      const arr = Array.from(this.tabs.values()).map((t) => ({
        id: t.id,
        workspaceId: t.workspaceId,
        title: t.title
      }));
      this.store.set(STORE_KEY_TABS, arr);
      if (this.activeId) this.store.set(STORE_KEY_ACTIVE, this.activeId);
    } catch {
      /* ignore */
    }
  }

  _pushStripState() {
    if (!this.tabStrip || this.tabStrip.webContents.isDestroyed()) return;
    this.tabStrip.webContents.send('tab-strip:state', {
      version: TAB_MODULE_VERSION,
      activeId: this.activeId,
      tabs: this.list()
    });
  }

  // —— IPC 注册：由 main.js 的 setupIPC() 调用 ——
  registerIpc(ipcMain) {
    ipcMain.on('tab-strip:new', () => {
      this.createTab({ workspaceId: null, title: '新标签' });
    });
    ipcMain.on('tab-strip:switch', (_e, id) => {
      this.switchTo(id);
    });
    ipcMain.on('tab-strip:close', (_e, id) => {
      this.closeTab(id);
    });
    ipcMain.on('tab-strip:rename', (_e, id, title) => {
      this.renameTab(id, title);
    });
    ipcMain.on('tab-strip:set-workspace', (_e, id, workspaceId) => {
      this.setWorkspaceId(id, workspaceId);
    });

    // 供前端 workspace 切换器调用的高级接口
    ipcMain.handle('workspace-tabs:open', (_e, workspaceId, title) => {
      return this.createTab({ workspaceId: workspaceId || null, title: title || '工作台' });
    });
    ipcMain.handle('workspace-tabs:switch', (_e, id) => this.switchTo(id));
    ipcMain.handle('workspace-tabs:close', (_e, id) => this.closeTab(id));
    ipcMain.handle('workspace-tabs:setWorkspaceId', (_e, id, wsId) =>
      this.setWorkspaceId(id, wsId)
    );
    ipcMain.handle('workspace-tabs:list', () => this.list());
    ipcMain.handle('workspace-tabs:getActive', () => this.getActive());
  }
}

module.exports = { TabManager, isLocalAppRequest };
