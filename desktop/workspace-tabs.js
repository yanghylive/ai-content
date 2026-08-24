/**
 * workspace-tabs.js — ai-content 桌面端多工作区标签壳（方案 A：WebContentsView per tab）
 *
 * 双工作区模型（连接本机已运行的 Octop）：
 *  - 每个标签 = 一个独立 WebContentsView，使用独立持久 partition（persist:ws-tab-<uuid> /
 *    octop-tab-<uuid>），因此每个标签拥有独立的 cookie / localStorage / 登录态，天然隔离。
 *  - kind:
 *      'business' → 加载 3010 业务前端；pinned 的业务标签（「业务工作区」）固定不可关闭。
 *      'octop'    → 加载本机 Octop（默认 127.0.0.1:8088），注入 Authorization Bearer 令牌实现免登录。
 *  - business 标签 session 注入 x-workspace-id（仅 localhost/127.0.0.1:3010|3011），后端据此做
 *    workspace 第 4 维隔离；octop 标签注入 Octop Bearer 令牌。前端代码零改动。
 *  - 标签列表与激活态持久化到 electron-store；octop 标签不持久化（令牌不落盘，重启需重新拉起）。
 *  - 窗口 contentView 下挂：顶部 tab 条（WebContentsView, tab-strip.html）+ 当前激活标签内容视图。
 */

const { WebContentsView, session, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');

const TAB_STRIP_HEIGHT = 38;
const TAB_MODULE_VERSION = 2;

// 持久化键
const STORE_KEY_TABS = 'workspaceTabs';
const STORE_KEY_ACTIVE = 'activeTabId';

// 是否为本应用自托管的 localhost 请求（前端静态资源 3010 + 后端 API 3011）。
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

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return 'http://127.0.0.1:8088';
  }
}

/**
 * 在指定 partition 上挂 x-workspace-id 注入（business 标签）。
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

/**
 * Octop 高级模式：向本机 Octop（origin 匹配）注入 Bearer 令牌，实现免登录。
 * 闭包读取 tab.octopToken 的当前值（拉起后可刷新）。
 */
function installOctopAuthInjection(tabSession, getToken, origin) {
  if (!tabSession || !tabSession.webRequest) return;
  tabSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const token = getToken();
    if (token && details.url.startsWith(origin)) {
      details.requestHeaders['Authorization'] = `Bearer ${token}`;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

/** 兜底：把 Octop 令牌写入会话 cookie（Octop 前端若从 cookie 读 token 时生效）。 */
async function setOctopCookie(tabSession, octopUrl, token) {
  try {
    const u = new URL(octopUrl);
    await tabSession.cookies.set({
      url: `${u.protocol}//${u.host}`,
      name: 'token',
      value: token,
      httpOnly: false,
      secure: u.protocol === 'https:',
    });
  } catch {
    /* ignore */
  }
}

class TabManager {
  constructor(store) {
    this.store = store;
    this.window = null;
    this.tabStrip = null;
    this.tabs = new Map(); // id -> { id, workspaceId, title, kind, pinned, view, ready, octopUrl, octopToken, loadUrl }
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

  // 仅向业务标签（优先 pinned）发送，用于把 tab 条发出的「请求拉起 Octop」转交给已登录的 3010 前端处理。
  sendToBusiness(channel, ...args) {
    for (const tab of this.tabs.values()) {
      if (tab.kind === 'business' && tab.pinned && tab.view && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.send(channel, ...args);
        return true;
      }
    }
    for (const tab of this.tabs.values()) {
      if (tab.kind === 'business' && tab.view && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.send(channel, ...args);
        return true;
      }
    }
    return false;
  }

  attach(window) {
    this.window = window;
    // 若窗口被重建（mac 极少，但防御性），先清空旧引用再重建。
    this.tabs.clear();
    this.knownWebContents.clear();
    this.activeId = null;

    this._ensureTabStrip();
    this._restoreTabs();
    this._ensurePrimaryBusinessTab();
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
      // 不恢复 octop 标签（令牌不持久化，重启需重新拉起）
      if (rec.kind === 'octop') continue;
      this._createTab(
        {
          workspaceId: rec.workspaceId ?? null,
          title: rec.title || '工作台',
          kind: rec.kind || 'business',
          pinned: !!rec.pinned
        },
        rec.id
      );
    }
    const active = this.store.get(STORE_KEY_ACTIVE);
    if (active && this.tabs.has(active)) {
      this.activeId = active;
    }
  }

  // 保证存在一个 pinned 业务标签（「业务工作区」）。无则创建一个。
  _ensurePrimaryBusinessTab() {
    let hasPrimary = false;
    for (const t of this.tabs.values()) {
      if (t.kind === 'business' && t.pinned) {
        hasPrimary = true;
        break;
      }
    }
    if (!hasPrimary) {
      const tab = this._createTab({
        workspaceId: null,
        title: '业务工作区',
        kind: 'business',
        pinned: true
      });
      if (!this.activeId) this.activeId = tab.id;
    }
  }

  _firstTabId() {
    return this.tabs.keys().next().value || null;
  }

  _createTab(
    { workspaceId = null, title = '工作台', kind = 'business', pinned = false, octopUrl = null, octopToken = null },
    forcedId = null
  ) {
    const id = forcedId || genId();
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        partition: kind === 'octop' ? `persist:octop-tab-${id}` : `persist:ws-tab-${id}`
      }
    });

    const tab = {
      id,
      workspaceId,
      title,
      kind,
      pinned,
      view,
      ready: false,
      octopUrl: octopUrl || null,
      octopToken: octopToken || null,
      loadUrl: null
    };
    tab.loadUrl =
      kind === 'octop'
        ? (octopUrl || 'http://127.0.0.1:8088')
        : (this.frontendServerUrl || 'http://localhost:3010');

    this.tabs.set(id, tab);
    this.knownWebContents.add(view.webContents);

    if (kind === 'octop') {
      const origin = originOf(tab.loadUrl);
      installOctopAuthInjection(view.webContents.session, () => tab.octopToken, origin);
      if (octopToken) setOctopCookie(view.webContents.session, tab.loadUrl, octopToken);
    } else {
      installWorkspaceHeaderInjection(view.webContents.session, () => tab.workspaceId);
    }

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
        if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.loadURL(tab.loadUrl);
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

    view.webContents.loadURL(tab.loadUrl);

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

  // 切到 pinned 业务标签（「业务工作区」）；无则第一个业务标签。
  switchToBusiness() {
    for (const t of this.tabs.values()) {
      if (t.kind === 'business' && t.pinned) return this.switchTo(t.id);
    }
    for (const t of this.tabs.values()) {
      if (t.kind === 'business') return this.switchTo(t.id);
    }
    return false;
  }

  createTab({ workspaceId = null, title = '工作台' } = {}) {
    const tab = this._createTab({ workspaceId, title, kind: 'business', pinned: false });
    this.persist();
    this.switchTo(tab.id);
    return tab.id;
  }

  closeTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    if (tab.pinned) return false; // 固定标签（业务工作区）不可关闭
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
        // 关掉最后一个 → 重建固定业务标签，保持窗口不空且不破坏「3010 不可关」约束
        this._ensurePrimaryBusinessTab();
        this.switchTo(this._firstTabId());
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

  /**
   * 拉起 / 切换 Octop 高级模式标签。
   * @param {string} url  Octop base URL（默认 http://127.0.0.1:8088）
   * @param {string} token Octop Bearer 令牌（来自后端 /api/octop/launch）
   */
  openOctop(url, token) {
    const target = url || 'http://127.0.0.1:8088';
    for (const t of this.tabs.values()) {
      if (t.kind === 'octop') {
        t.octopUrl = target;
        t.octopToken = token || null;
        t.loadUrl = target;
        t.title = 'Octop 高级模式';
        if (token) setOctopCookie(t.view.webContents.session, target, token);
        try {
          t.view.webContents.loadURL(target);
        } catch {
          /* ignore */
        }
        this.switchTo(t.id);
        this.persist();
        this._pushStripState();
        return t.id;
      }
    }
    const tab = this._createTab({
      title: 'Octop 高级模式',
      kind: 'octop',
      pinned: false,
      octopUrl: target,
      octopToken: token
    });
    this.persist();
    this.switchTo(tab.id);
    return tab.id;
  }

  getActive() {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    return tab
      ? { id: tab.id, workspaceId: tab.workspaceId, title: tab.title, kind: tab.kind, pinned: tab.pinned }
      : null;
  }

  list() {
    return Array.from(this.tabs.values()).map((t) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      title: t.title,
      kind: t.kind,
      pinned: t.pinned,
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
      const arr = Array.from(this.tabs.values())
        .filter((t) => t.kind !== 'octop') // octop 标签令牌不持久化
        .map((t) => ({
          id: t.id,
          workspaceId: t.workspaceId,
          title: t.title,
          kind: t.kind,
          pinned: t.pinned
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
    // 顶部「业务工作区」固定入口
    ipcMain.on('tab-strip:switch-business', () => {
      this.switchToBusiness();
    });
    // 顶部「Octop 高级模式」入口：转交给已登录的 3010 前端去拉起（需会话凭据）
    ipcMain.on('tab-strip:request-octop', () => {
      this.sendToBusiness('octop:request-launch');
    });

    // 供前端 workspace 切换器调用的高级接口
    ipcMain.handle('workspace-tabs:open', (_e, workspaceId, title) => {
      return this.createTab({ workspaceId: workspaceId || null, title: title || '工作台' });
    });
    ipcMain.handle('workspace-tabs:openOctop', (_e, url, token) => this.openOctop(url, token));
    ipcMain.handle('workspace-tabs:switch', (_e, id) => this.switchTo(id));
    ipcMain.handle('workspace-tabs:switchBusiness', () => this.switchToBusiness());
    ipcMain.handle('workspace-tabs:close', (_e, id) => this.closeTab(id));
    ipcMain.handle('workspace-tabs:setWorkspaceId', (_e, id, wsId) =>
      this.setWorkspaceId(id, wsId)
    );
    ipcMain.handle('workspace-tabs:list', () => this.list());
    ipcMain.handle('workspace-tabs:getActive', () => this.getActive());
  }
}

module.exports = { TabManager, isLocalAppRequest };
