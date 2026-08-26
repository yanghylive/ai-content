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
 * origin 用 getter 动态读取（拉起换 URL 后注入 origin 立即跟随）。
 */
function installOctopAuthInjection(tabSession, getToken, getOrigin) {
  if (!tabSession || !tabSession.webRequest) return;
  tabSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const token = getToken();
    const origin = getOrigin();
    // 严格 origin 等值比较（非前缀匹配）：防 "http://127.0.0.1:8088.evil.com" 类伪同前缀域名携带 Bearer 外泄
    let sameOrigin = false;
    if (token && origin) {
      try {
        sameOrigin = new URL(details.url).origin === origin;
      } catch {
        sameOrigin = false;
      }
    }
    if (sameOrigin) {
      details.requestHeaders['Authorization'] = `Bearer ${token}`;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

/** Octop 标签仅允许加载 loopback（127.0.0.1/localhost/::1）http(s) 地址，防任意站点加载 + 令牌外泄。 */
function isLoopbackHttpUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === '[::1]' ||
      u.hostname === '::1'
    );
  } catch {
    return false;
  }
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
    // 若窗口被重建（mac 极少，但防御性）：先销毁旧视图防泄漏，再清空引用重建。
    if (this.tabStrip) {
      try {
        if (!this.tabStrip.webContents.isDestroyed()) this.tabStrip.webContents.destroy();
      } catch { /* ignore */ }
      this.tabStrip = null;
    }
    for (const tab of this.tabs.values()) {
      this._removeViewFromWindow(tab.view);
      try {
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.destroy();
      } catch { /* ignore */ }
    }
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
      webPreferences:
        kind === 'octop'
          ? // Octop 标签：不挂业务 preload（第三方 web 内容不给任何特权 IPC 面），sandbox 加固
            { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `persist:octop-tab-${id}` }
          : {
              preload: path.join(__dirname, 'preload.js'),
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: false,
              partition: `persist:ws-tab-${id}`
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
      loadUrl: null,
      failRetry: 0 // 连续加载失败计数（指数退避 + 上限）
    };
    tab.loadUrl =
      kind === 'octop'
        ? (octopUrl || 'http://127.0.0.1:8088')
        : (this.frontendServerUrl || 'http://localhost:3010');

    this.tabs.set(id, tab);
    this.knownWebContents.add(view.webContents);

    if (kind === 'octop') {
      installOctopAuthInjection(view.webContents.session, () => tab.octopToken, () => originOf(tab.loadUrl));
      if (octopToken) setOctopCookie(view.webContents.session, tab.loadUrl, octopToken);
      // 首次加载完成后播种 localStorage.auth_token 并重载（见 _bootstrapOctopAuth 注释）
      if (octopToken) view.webContents.once('did-finish-load', () => this._bootstrapOctopAuth(tab));
      this._installOctop401AutoRenew(tab);
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
    view.webContents.on('did-finish-load', () => {
      tab.failRetry = 0; // 成功加载即重置退避计数
    });
    view.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      if (tab.failRetry >= 10) {
        console.warn(`[Tab ${id}] 前端加载失败(${code}): ${desc}，连续 ${tab.failRetry} 次，停止自动重试`);
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, tab.failRetry), 10000); // 1s→2s→…→10s 封顶
      tab.failRetry += 1;
      console.warn(`[Tab ${id}] 前端加载失败(${code}): ${desc}，${delay}ms 后第 ${tab.failRetry} 次重试`);
      setTimeout(() => {
        if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.loadURL(tab.loadUrl);
      }, delay);
    });
    view.webContents.on('unresponsive', () => {
      console.warn(`[Tab ${id}] 视图无响应，尝试恢复`);
      setTimeout(() => {
        if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload();
      }, 500);
    });

    // 外链一律在系统浏览器打开；本壳内不开新 webContents（file:// 等协议同样拒绝）
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
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
   * Octop SPA 会话自举（真机验证结论，2026-08-24）：
   * Octop 前端把会话 token 存 localStorage.auth_token，启动时纯靠它判定登录态
   * （不读 cookie、不依赖注入的 Authorization 头做初始路由判定）。
   * 故首次加载完成后写入 token 并重载一次，SPA 即视为已登录（免登录）。
   * 失败（如页面还没就绪）时复位标志，等待下次加载重试。
   */
  /**
   * Octop 标签 401 自动静默续签（产品要求：octop 无自有登录感知）。
   * token 过期（默认 24h，现配 7 天）后 octop API 返回 401 → 主进程重换 token
   * → 更新注入头/cookie/localStorage → 重载标签。用户全程无感，永不见 octop 登录页。
   * 防抖：续签中/10s 冷却内不重复触发；单标签连续失败 ≤3 次后放弃（避免死循环刷屏）。
   */
  _installOctop401AutoRenew(tab) {
    if (!tab.view || !tab.view.webContents.session || !tab.view.webContents.session.webRequest) return;
    tab.renewing = false;
    tab.lastRenewAt = 0;
    tab.renewFails = 0;
    tab.view.webContents.session.webRequest.onHeadersReceived({ urls: [`${originOf(tab.loadUrl)}/*`] }, (details, callback) => {
      callback({});
      if (details.statusCode !== 401 || tab.renewing) return;
      const now = Date.now();
      if (now - tab.lastRenewAt < 10_000) return;
      if (tab.renewFails >= 3) return;
      tab.renewing = true;
      tab.lastRenewAt = now;
      (async () => {
        try {
          const token = await this._exchangeOctopTokenWithRetry();
          if (!token) throw new Error('renew: exchange failed');
          tab.octopToken = token;
          if (tab.view && !tab.view.webContents.isDestroyed()) {
            await setOctopCookie(tab.view.webContents.session, tab.loadUrl, token);
            const script = `try{localStorage.setItem('auth_token', ${JSON.stringify(token)})}catch(e){}`;
            await tab.view.webContents.executeJavaScript(script).catch(() => {});
            tab.authSeeded = true;
            tab.view.webContents.loadURL(tab.loadUrl);
          }
          tab.renewFails = 0;
          console.log('[Octop] 401 后已静默续签并重载');
        } catch (e) {
          tab.renewFails += 1;
          console.warn(`[Octop] 401 续签失败(${tab.renewFails}/3):`, e && e.message);
        } finally {
          tab.renewing = false;
        }
      })();
    });
  }

  _bootstrapOctopAuth(tab) {
    if (!tab || tab.kind !== 'octop' || !tab.octopToken || tab.authSeeded) return;
    tab.authSeeded = true;
    const view = tab.view;
    const script = `try{localStorage.setItem('auth_token', ${JSON.stringify(tab.octopToken)})}catch(e){}`;
    view.webContents
      .executeJavaScript(script)
      .then(() => {
        if (!view.webContents.isDestroyed()) view.webContents.loadURL(tab.loadUrl);
      })
      .catch(() => {
        tab.authSeeded = false; // 页面未就绪等失败 → 允许下次 did-finish-load 重试
      });
  }

  /**
   * 拉起 / 切换 Octop 高级模式标签。
   * 安全：url 仅允许 loopback http(s)（防任意站点加载 + Bearer 令牌外泄）；
   * token 仅在拿到新值时覆盖（launch 失败 token=null 不清掉已开的合法会话）。
   *
   * 审计 #7：token 主进程侧交换——token 不再从 3010 渲染进程传入，
   * 而是主进程从 business 标签读登录 session cookie → 直接向后端 /api/octop/launch 换 token。
   * 3010 渲染进程只发「打开」信号（url），不接触 Octop Bearer 令牌。
   * @param {string} url  Octop base URL（默认 http://127.0.0.1:8088）
   */
  async openOctop(url) {
    const target = url || 'http://127.0.0.1:8088';
    if (!isLoopbackHttpUrl(target)) {
      console.warn(`[TabManager] 拒绝加载非 loopback 的 Octop 地址: ${target}`);
      return null;
    }
    let token = null;
    try {
      token = await this._exchangeOctopTokenWithRetry();
    } catch (e) {
      console.warn('[Octop] 主进程换 token 失败，将以未认证态打开:', e && e.message);
    }
    for (const t of this.tabs.values()) {
      if (t.kind === 'octop') {
        t.octopUrl = target;
        if (token) t.octopToken = token;
        t.loadUrl = target;
        t.title = 'Octop 高级模式';
        if (token) setOctopCookie(t.view.webContents.session, target, token);
        try {
          t.view.webContents.loadURL(target);
        } catch {
          /* ignore */
        }
        // 新 token → 加载完成后重新自举 localStorage 会话（SPA 换令牌后需重写）
        if (token) {
          t.authSeeded = false;
          t.view.webContents.once('did-finish-load', () => this._bootstrapOctopAuth(t));
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

  /**
   * 主进程侧 token 交换（审计 #7）：从 business 标签读登录 session cookie，
   * 带 Cookie 头调后端 /api/octop/launch 换 Octop Bearer 令牌。
   * 不经过 3010 渲染进程；失败返回 null（Octop 以未认证态打开，由后端降级提示）。
   */
  async _exchangeOctopToken() {
    const business = [...this.tabs.values()].find((t) => t.kind === 'business');
    if (!business || !business.view || business.view.webContents.isDestroyed()) return null;
    const cookies = await business.view.webContents.session.cookies.get({ name: 'ai_content_session' });
    const sessionToken = cookies && cookies[0] && cookies[0].value;
    if (!sessionToken) return null;
    const res = await fetch('http://127.0.0.1:3011/api/octop/launch', {
      headers: { cookie: `ai_content_session=${sessionToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d && d.healthy && d.token ? d.token : null;
  }

  /**
   * 带就绪重试的 token 交换（审计 P2：sidecar 冷启动期间用户可能提前点击）。
   * Octop sidecar 冷启动含 octop init + uvicorn（通常 20-30s），换不到 token 时
   * 每 2s 重试，最多等 90s；仍失败才降级为未认证态打开。
   */
  async _exchangeOctopTokenWithRetry() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 90_000) {
      try {
        const token = await this._exchangeOctopToken();
        if (token) return token;
      } catch {
        /* sidecar 未就绪，继续重试 */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
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

  // —— IPC 来源校验（P0-1 修复）：tab 条 / 业务标签各只信自己的通道 ——
  _isTabStripSender(contents) {
    return (
      !!this.tabStrip && !this.tabStrip.webContents.isDestroyed() && contents === this.tabStrip.webContents
    );
  }

  _businessOrigins() {
    const origins = new Set(['http://localhost:3010', 'http://127.0.0.1:3010']);
    if (this.frontendServerUrl) {
      try {
        origins.add(new URL(this.frontendServerUrl).origin);
      } catch { /* ignore */ }
    }
    return origins;
  }

  _isBusinessSender(event) {
    try {
      if (!this.isOwnedWebContents(event.sender)) return false;
      const url = (event.senderFrame && event.senderFrame.url) || event.sender.getURL();
      if (!url) return false;
      return this._businessOrigins().has(new URL(url).origin);
    } catch {
      return false;
    }
  }

  // —— IPC 注册：由 main.js 的 setupIPC() 调用 ——
  registerIpc(ipcMain) {
    // tab-strip:* 只信 tab 条视图自身
    ipcMain.on('tab-strip:new', (e) => {
      if (!this._isTabStripSender(e.sender)) return;
      this.createTab({ workspaceId: null, title: '新标签' });
    });
    ipcMain.on('tab-strip:switch', (e, id) => {
      if (!this._isTabStripSender(e.sender)) return;
      this.switchTo(id);
    });
    ipcMain.on('tab-strip:close', (e, id) => {
      if (!this._isTabStripSender(e.sender)) return;
      this.closeTab(id);
    });
    ipcMain.on('tab-strip:rename', (e, id, title) => {
      if (!this._isTabStripSender(e.sender)) return;
      this.renameTab(id, title);
    });
    ipcMain.on('tab-strip:set-workspace', (e, id, workspaceId) => {
      if (!this._isTabStripSender(e.sender)) return;
      this.setWorkspaceId(id, workspaceId);
    });
    // 顶部「业务工作区」固定入口
    ipcMain.on('tab-strip:switch-business', (e) => {
      if (!this._isTabStripSender(e.sender)) return;
      this.switchToBusiness();
    });
    // 顶部「Octop 高级模式」入口：转交给已登录的 3010 前端去拉起（需会话凭据）
    ipcMain.on('tab-strip:request-octop', (e) => {
      if (!this._isTabStripSender(e.sender)) return;
      this.sendToBusiness('octop:request-launch');
    });

    // workspace-tabs:* 只信业务前端来源（octop 标签无 preload 调不到；tab 条仅放行只读 list）
    ipcMain.handle('workspace-tabs:open', (e, workspaceId, title) => {
      if (!this._isBusinessSender(e)) return null;
      return this.createTab({ workspaceId: workspaceId || null, title: title || '工作台' });
    });
    ipcMain.handle('workspace-tabs:openOctop', (e, url) => {
      if (!this._isBusinessSender(e)) return null;
      // 审计 #7：token 主进程侧交换，IPC 只传 url（不传 token）
      return this.openOctop(url);
    });
    ipcMain.handle('workspace-tabs:switch', (e, id) => {
      if (!this._isBusinessSender(e)) return false;
      return this.switchTo(id);
    });
    ipcMain.handle('workspace-tabs:switchBusiness', (e) => {
      if (!this._isBusinessSender(e)) return false;
      return this.switchToBusiness();
    });
    ipcMain.handle('workspace-tabs:close', (e, id) => {
      if (!this._isBusinessSender(e)) return false;
      return this.closeTab(id);
    });
    ipcMain.handle('workspace-tabs:setWorkspaceId', (e, id, wsId) => {
      if (!this._isBusinessSender(e)) return false;
      return this.setWorkspaceId(id, wsId);
    });
    ipcMain.handle('workspace-tabs:list', (e) => {
      if (!this._isBusinessSender(e) && !this._isTabStripSender(e.sender)) return [];
      return this.list();
    });
    ipcMain.handle('workspace-tabs:getActive', (e) => {
      if (!this._isBusinessSender(e)) return null;
      return this.getActive();
    });
  }
}

module.exports = { TabManager, isLocalAppRequest };
