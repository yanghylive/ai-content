'use strict';
/**
 * browser-panel-manager.js — 3010 右侧浏览器面板（工作流文档 §3.1 / §4 阶段 2）
 *
 * 布局（与 workspace-tabs 协同）：
 *   ┌────────────────────────┬───────────────┐
 *   │ tab 条（38px，通栏业务区）  │ 控制条(40px)     │
 *   ├────────────────────────┼───────────────┤
 *   │ 业务标签 WebContentsView │ 面板 webContents │
 *   └────────────────────────┴───────────────┘
 *   - 面板打开时业务内容宽度 = window.width - panelWidth（rightInset 注入 TabManager）；
 *   - 控制条是本地受信视图（browser-control-strip.html + preload），面板 webContents
 *     是第三方 web 内容——无 preload、sandbox:true、contextIsolation:true，
 *     不给任何特权 IPC 面（对齐 workspace-tabs 的 Octop 标签姿态）。
 *
 * 会话语义（文档 §3.1）：
 *   - 关闭只隐藏视图，不销毁会话；重开恢复当前 URL；
 *   - partition 按账号持久化（persist:kaypal-browser-<ownerId>-<accountId>）；
 *   - 状态机 starting/ready/needs-human/blocked/stopped/error 全程可观测并广播。
 *
 * 同页控制（阶段 1 结论延续）：面板 webContents 是唯一事实源——resolvePanelTarget
 * 返回 panelId/sessionId/webContentsId 三方绑定，供 Broker/Agent 使用。
 */

const path = require('node:path');
const crypto = require('node:crypto');
// 阶段 6 决策 ③：面板模式开关（Agent 是否通过右侧面板代操作）
const { writeMode, readMode, clearMode } = require('./browser-panel-mode-registry');

const PANEL_MIN_WIDTH = 360;
const PANEL_DEFAULT_WIDTH = 480;
const PANEL_WIDTH_RATIO_MAX = 0.6;
const STRIP_HEIGHT = 40;
const TAB_STRIP_HEIGHT = 38; // 与 workspace-tabs.js 保持一致（顶部通栏高度）

// 阶段 6：审批浮层尺寸（与 browser-approval-overlay.html 的 CSS 保持一致，
// 否则会出现"卡片被裁掉一块"或"底部一大片空白"）
const APPROVAL_MARGIN = 8;
const APPROVAL_MAX_HEIGHT = 220;
const APPROVAL_HEADER_HEIGHT = 34;
const APPROVAL_CARD_HEIGHT = 76;

const ALLOWED_NAVIGATE_PROTOCOLS = new Set(['http:', 'https:']);

function normalizePanelUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw new Error(`浏览器面板地址无效：${rawUrl}`);
  }
  if (!ALLOWED_NAVIGATE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`浏览器面板仅允许 http/https 地址：${parsed.protocol}`);
  }
  return parsed.toString();
}

class BrowserPanelManager {
  /**
   * @param {{
   *   electron: { WebContentsView: any },
   *   store?: { get(k:string):any, set?(k:string,v:any):void },
   *   tabManager?: { rightInset: number, relayout(): void, broadcast(ch:string,...a:any[]):void, sendToBusiness(ch:string,...a:any[]):boolean, isOwnedWebContents(c:any):boolean },
   *   preloadPath?: string,
   *   stripHtmlPath?: string,
   *   approvalPreloadPath?: string,
   *   approvalHtmlPath?: string,
   *   logger?: { warn(...a:any[]):void },
   *   getUserDataDir?: () => string|null,  ③ 开关文件落 userData（Electron app.getPath('userData') 的取法）
   * }} deps
   */
  constructor(deps) {
    this._electron = deps.electron;
    this._store = deps.store || null;
    this._tabManager = deps.tabManager || null;
    this._getUserDataDir = deps.getUserDataDir || null;
    this._preloadPath = deps.preloadPath || path.join(__dirname, 'browser-control-strip-preload.js');
    this._stripHtmlPath = deps.stripHtmlPath || path.join(__dirname, 'browser-control-strip.html');
    // 阶段 6：审批浮层（Agent 写动作的用户批准界面）。本地受信，同控制条姿态。
    this._approvalPreloadPath =
      deps.approvalPreloadPath || path.join(__dirname, 'browser-approval-overlay-preload.js');
    this._approvalHtmlPath = deps.approvalHtmlPath || path.join(__dirname, 'browser-approval-overlay.html');
    this._logger = deps.logger || console;
    this.window = null;
    this.stripView = null;
    this.panelView = null;
    /** 审批浮层视图（本地受信；只在有待批动作时可见） */
    this.approvalView = null;
    /** 当前待批动作条数（决定浮层高度与可见性） */
    this._approvalPendingCount = 0;
    /** @type {null | { panelId:string, sessionId:string, ownerId:string, tenantId:string, accountId?:string, platform:string, partition:string, currentUrl?:string, status:string }} */
    this.session = null;
    this._visible = false;
    this._destroyed = false;
    this._knownWebContents = new Set();
    // 2026-09-03（阶段 3）：会话变更钩子——Broker 接线订阅（open/rebuild/
    // hide/show/close 时同步 Agent 侧会话与 capability token）。
    this._sessionListeners = new Set();
  }

  /**
   * 订阅会话变更（阶段 3 wiring 入口）。回调同步调用，异常互不影响。
   * @param {(event: { type: 'opened'|'account-switched'|'hidden'|'shown'|'destroyed', manager: BrowserPanelManager }) => void} listener
   * @returns {() => void} 取消订阅
   */
  onSessionEvent(listener) {
    if (typeof listener !== 'function') return () => undefined;
    this._sessionListeners.add(listener);
    return () => this._sessionListeners.delete(listener);
  }

  _emitSessionEvent(type) {
    for (const listener of this._sessionListeners) {
      try {
        listener({ type, manager: this });
      } catch {
        /* 订阅方异常不拖垮面板 */
      }
    }
  }

  // ---------- 生命周期 ----------

  attach(window) {
    this.window = window;
    this._ensureViews();
    window.on('resize', () => this.relayout());
    window.on('closed', () => this.destroy());
  }

  _ensureViews() {
    if (this._destroyed) throw new Error('BrowserPanelManager 已销毁');
    const { WebContentsView } = this._electron;
    if (!this.stripView) {
      this.stripView = new WebContentsView({
        webPreferences: {
          preload: this._preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false, // 本地受信控制条（同 tab-strip 姿态）
          partition: 'persist:ai-content-browser-strip',
          backgroundThrottling: false,
        },
      });
      this._knownWebContents.add(this.stripView.webContents);
      this.window.contentView.addChildView(this.stripView);
      this.stripView.webContents.loadFile(this._stripHtmlPath);
      this.stripView.setVisible(false);
    }
    if (!this.approvalView) {
      // 阶段 6：审批浮层。必须 addChildView 在 panelView **之后**——Electron 的
      // 子视图按加入顺序绘制，先加的在下层。控制条就是先加的，所以它的下拉卡片
      // 会被面板盖住；审批卡片同理，故单独建视图并在每次重建面板后置顶。
      this.approvalView = new WebContentsView({
        webPreferences: {
          preload: this._approvalPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false, // 本地受信（同控制条）：需要 invoke 批准/拒绝
          partition: 'persist:ai-content-browser-approval',
          backgroundThrottling: false,
        },
      });
      this._knownWebContents.add(this.approvalView.webContents);
      this.window.contentView.addChildView(this.approvalView);
      this.approvalView.webContents.loadFile(this._approvalHtmlPath);
      this.approvalView.setVisible(false);
    }
    if (!this.panelView) {
      // 面板 webContents 在首次 open 时按账号 partition 创建（见 _createPanelView）
    }
  }

  _panelWidth() {
    const saved = this._store && typeof this._store.get === 'function'
      ? this._store.get('browserPanelWidth')
      : undefined;
    const base = Number.isFinite(saved) && saved >= PANEL_MIN_WIDTH
      ? saved
      : PANEL_DEFAULT_WIDTH;
    return this._clampWidth(base);
  }

  _clampWidth(width) {
    const bounds = this.window && this.window.getContentBounds
      ? this.window.getContentBounds()
      : { width: PANEL_DEFAULT_WIDTH / PANEL_WIDTH_RATIO_MAX };
    const maxWidth = Math.floor(bounds.width * PANEL_WIDTH_RATIO_MAX);
    return Math.max(PANEL_MIN_WIDTH, Math.min(Math.floor(width), maxWidth));
  }

  _createPanelView(partition) {
    const { WebContentsView } = this._electron;
    if (this.panelView && !this.panelView.webContents.isDestroyed()) {
      // 账号/分区变了才重建视图；同分区复用保持登录态
      if (this._partitionOf(this.panelView) === partition) return;
      this._disposePanelView();
    }
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true, // 第三方 web 内容：零特权
        partition,
        backgroundThrottling: false,
      },
    });
    this._panelPartitions = this._panelPartitions || new WeakMap();
    this._panelPartitions.set(view, partition);
    this._knownWebContents.add(view.webContents);
    this.window.contentView.addChildView(view);
    // 面板是新加的子视图 → 会盖在审批浮层之上，必须把浮层重新置顶
    this._bringApprovalToFront();
    this._wirePanelEvents(view);
    this.panelView = view;
    view.setVisible(false);
  }

  /**
   * 把审批浮层提到最上层（移除后重新加入 = 置顶）。
   * 面板视图在账号切换时会重建，每次重建都会把浮层压到下面，故需重新置顶。
   */
  _bringApprovalToFront() {
    if (!this.approvalView || this.approvalView.webContents.isDestroyed()) return;
    if (!this.window || this.window.isDestroyed()) return;
    try {
      this.window.contentView.removeChildView(this.approvalView);
      this.window.contentView.addChildView(this.approvalView);
    } catch {
      /* 视图已销毁时忽略 */
    }
  }

  _partitionOf(view) {
    return (this._panelPartitions && this._panelPartitions.get(view)) || null;
  }

  _disposePanelView() {
    if (!this.panelView) return;
    try {
      if (!this.panelView.webContents.isDestroyed()) {
        this._knownWebContents.delete(this.panelView.webContents);
        this.window.contentView.removeChildView(this.panelView);
        this.panelView.webContents.close();
      }
    } catch (error) {
      this._logger.warn('[browser-panel] 面板视图销毁异常：', error && error.message);
    }
    this.panelView = null;
  }

  _wirePanelEvents(view) {
    const wc = view.webContents;
    const push = (patch) => {
      if (!this.session) return;
      Object.assign(this.session, patch);
      this._emitState();
    };
    wc.on('did-navigate', (_e, url) => push({ currentUrl: url, status: 'ready' }));
    wc.on('did-navigate-in-page', (_e, url) => push({ currentUrl: url }));
    wc.on('did-start-loading', () => push({ status: 'starting' }));
    wc.on('did-finish-load', () => push({ status: 'ready' }));
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame) {
        push({ status: 'error', lastError: { code, description } });
      }
    });
    wc.on('render-process-gone', (_e, details) => {
      push({ status: 'blocked', lastError: { reason: 'render-process-gone', details } });
    });
    wc.on('unresponsive', () => push({ status: 'needs-human' }));
    wc.on('responsive', () => push({ status: 'ready' }));
    // 新窗口一律 deny 并回报（阶段 1 P0 已验证可观测；策略后续走确认外开）
    wc.setWindowOpenHandler((details) => {
      this._sendToPanelOwner('browser-panel:popup-blocked', { url: details.url });
      return { action: 'deny' };
    });
  }

  // ---------- 会话操作（受信 IPC 入口，main.js 校验来源后调用） ----------

  /** 打开（或恢复）浏览器面板并导航到 url */
  open(input) {
    const {
      url,
      ownerId = 'local-desktop',
      tenantId = 'local-tenant',
      accountId,
      platform = 'general-web',
    } = input || {};
    const targetUrl = normalizePanelUrl(url);
    const partition = `persist:kaypal-browser-${ownerId}${accountId ? `-${accountId}` : ''}`;
    let accountSwitched = false;
    if (!this.session) {
      this.session = {
        panelId: `panel-${crypto.randomBytes(6).toString('hex')}`,
        sessionId: `sess-${crypto.randomBytes(8).toString('hex')}`,
        ownerId,
        tenantId,
        accountId,
        platform,
        partition,
        currentUrl: targetUrl,
        status: 'starting',
      };
    } else {
      // 账号/租户变化 = 换一个登录态世界：重算 partition 并销毁旧视图
      //（同账号重开则保留会话与 webContents，登录态不丢）。
      if (this.session.ownerId !== ownerId || this.session.accountId !== accountId) {
        this.session.partition = partition;
        this._disposePanelView();
        accountSwitched = true;
      }
      this.session.status = 'starting';
      this.session.ownerId = ownerId;
      this.session.tenantId = tenantId;
      this.session.accountId = accountId;
      this.session.platform = platform || this.session.platform;
    }
    this._ensureViews();
    this._createPanelView(this.session.partition);
    this._visible = true;
    this.relayout();
    this.panelView.webContents.loadURL(targetUrl);
    this._emitState();
    this._emitSessionEvent(accountSwitched ? 'account-switched' : 'opened');
    return this.publicState();
  }

  /** 面板关闭 = 隐藏视图，保留会话与登录态（文档 §3.1） */
  hide() {
    this._visible = false;
    if (this.panelView) this.panelView.setVisible(false);
    if (this.stripView) this.stripView.setVisible(false);
    // 阶段 6：面板收起 = 没有可操作的页面，待批卡片必须一起清空并隐藏，
    // 否则重开面板会看到一批已经过期（页面目标早变了）的陈旧卡片。
    if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      this.approvalView.setVisible(false);
    }
    this._approvalPendingCount = 0;
    if (this.session) this.session.status = 'stopped';
    if (this._tabManager) {
      this._tabManager.rightInset = 0;
      this._tabManager.relayout();
    }
    this._emitState();
    this._emitSessionEvent('hidden');
    return this.publicState();
  }

  /** 恢复显示（沿用当前会话与 URL） */
  show() {
    if (!this.session || !this.panelView) return null;
    this._visible = true;
    this.relayout();
    if (this.session.status === 'stopped') this.session.status = 'ready';
    this._emitState();
    this._emitSessionEvent('shown');
    return this.publicState();
  }

  navigate(rawUrl) {
    if (!this.session || !this.panelView) throw new Error('浏览器面板未打开');
    const targetUrl = normalizePanelUrl(rawUrl);
    this.session.status = 'starting';
    this._emitState();
    this.panelView.webContents.loadURL(targetUrl);
    return targetUrl;
  }

  goBack() {
    if (this.panelView && this.panelView.webContents.canGoBack()) {
      this.panelView.webContents.goBack();
    }
  }

  goForward() {
    if (this.panelView && this.panelView.webContents.canGoForward()) {
      this.panelView.webContents.goForward();
    }
  }

  reload() {
    if (this.panelView) this.panelView.webContents.reload();
  }

  setWidth(width) {
    const next = this._clampWidth(Number(width));
    if (this._store && typeof this._store.set === 'function') {
      this._store.set('browserPanelWidth', next);
    }
    this._currentWidth = next;
    this.relayout();
    this._emitState();
    return next;
  }

  width() {
    if (this._currentWidth == null) this._currentWidth = this._panelWidth();
    return this._currentWidth;
  }

  /** 同页控制三方绑定事实源（阶段 1 Broker 接线点） */
  resolvePanelTarget() {
    if (!this.session || !this.panelView || this.panelView.webContents.isDestroyed()) {
      return null;
    }
    return {
      panelId: this.session.panelId,
      sessionId: this.session.sessionId,
      webContentsId: this.panelView.webContents.id,
      url: this.panelView.webContents.getURL() || this.session.currentUrl,
    };
  }

  /** 面板 webContents（仅供 main 进程/Broker 内部使用，不经 IPC 暴露） */
  panelWebContents() {
    return this.panelView && !this.panelView.webContents.isDestroyed()
      ? this.panelView.webContents
      : null;
  }

  isStripSender(sender) {
    return !!(
      sender &&
      this.stripView &&
      !this.stripView.webContents.isDestroyed() &&
      this.stripView.webContents.id === sender.id
    );
  }

  /** 阶段 6：审批浮层 sender 校验（只有浮层自己能调批准/拒绝，防第三方页面伪造） */
  isApprovalSender(sender) {
    return !!(
      sender &&
      this.approvalView &&
      !this.approvalView.webContents.isDestroyed() &&
      this.approvalView.webContents.id === sender.id
    );
  }

  /**
   * 阶段 6：刷新审批浮层的待批列表。
   * 由 wiring 的 onPendingChange 回调驱动（Agent 签单 / 用户批准 / 用户拒绝都会触发）。
   * @param {Array<{actionId:string, method:string, summary:any, createdAt:number, binding:any}>} pending
   */
  updateApprovalList(pending) {
    const list = Array.isArray(pending) ? pending : [];
    this._approvalPendingCount = list.length;
    this._sendToApproval('browser-panel:pending-actions', {
      panelId: this.session ? this.session.panelId : null,
      actions: list,
    });
    // 条数变化会改变浮层高度 → 重新定位；为 0 时顺手隐藏
    if (this._visible) this.relayout();
    else if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      this.approvalView.setVisible(false);
    }
  }

  publicState() {
    return {
      visible: this._visible,
      hasSession: !!this.session,
      panelWidth: this._visible ? this.width() : 0,
      session: this.session
        ? { ...this.session, webContentsId: this.resolvePanelTarget()?.webContentsId ?? null }
        : null,
      canGoBack: !!(this.panelView && this.panelView.webContents.canGoBack()),
      canGoForward: !!(this.panelView && this.panelView.webContents.canGoForward()),
      // ③：面板模式开关当前态（读文件，控制条按钮据此高亮）
      agentMode: this.getAgentMode(),
    };
  }

  // ---------- 面板模式开关（阶段 6 决策 ③） ----------

  /** userData 目录取法（取不到 = 开关不可用，读一律 off、写显式报错） */
  _modeDir() {
    try {
      return this._getUserDataDir ? this._getUserDataDir() : null;
    } catch {
      return null;
    }
  }

  /**
   * 读当前开关。文件缺失 / 形状非法 / 老化 / desktop 进程已死 → 'off'（默认 off 铁律）。
   * registry 模块自带 fail-closed 校验，这里只兜一层异常。
   */
  getAgentMode() {
    const dir = this._modeDir();
    if (!dir) return 'off';
    try {
      const mode = readMode({ userDataDir: dir });
      return mode ? mode.mode : 'off';
    } catch {
      return 'off';
    }
  }

  /**
   * 切换开关（0600 文件投递，3011 按需读取，不用重启后端）。
   * @param {boolean} on
   * @returns {'on'|'off'} 切换后的态（回读文件为准，不自说自话）
   */
  setAgentMode(on) {
    const dir = this._modeDir();
    if (!dir) {
      throw new Error('无法定位 userData 目录，面板模式开关不可用');
    }
    if (on) {
      writeMode({ userDataDir: dir, mode: 'on', pid: process.pid });
    } else {
      // 关 = 直接删文件（而非写 'off'）：删掉即回默认 off，不留残留状态
      clearMode({ userDataDir: dir });
    }
    const mode = this.getAgentMode();
    // stage7 冒烟抓到的真 bug：写完不广播，控制条 onState 拿不到新 agentMode，
    // 按钮不高亮、且控制条用陈旧 lastState 算下一次 toggle（点两下=开了两次）。
    this._emitState();
    return mode;
  }

  // ---------- 布局 ----------

  relayout() {
    if (!this.window || this.window.isDestroyed() || !this._visible) return;
    const { width, height } = this.window.getContentBounds();
    // 窗口收窄/重建时重新夹取面板宽度（上限 60%），保证不遮挡 3010 主内容
    this._currentWidth = this._clampWidth(this.width());
    const panelW = this._currentWidth;
    const contentY = TAB_STRIP_HEIGHT;
    const contentH = Math.max(0, height - TAB_STRIP_HEIGHT);
    if (this._tabManager) {
      this._tabManager.rightInset = panelW;
      this._tabManager.relayout();
    }
    const x = Math.max(0, width - panelW);
    if (this.stripView && !this.stripView.webContents.isDestroyed()) {
      this.stripView.setBounds({ x, y: contentY, width: panelW, height: STRIP_HEIGHT });
      this.stripView.setVisible(true);
    }
    if (this.panelView && !this.panelView.webContents.isDestroyed()) {
      this.panelView.setBounds({
        x,
        y: contentY + STRIP_HEIGHT,
        width: panelW,
        height: Math.max(0, contentH - STRIP_HEIGHT),
      });
      this.panelView.setVisible(true);
    }
    if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      // 审批浮层：贴面板底部、左右留白，**只在有待批动作时可见**
      // （可见性由 updateApprovalList 控制，这里只负责定位）
      const h = this._approvalHeight();
      const bottom = contentY + contentH - APPROVAL_MARGIN;
      this.approvalView.setBounds({
        x: x + APPROVAL_MARGIN,
        y: Math.max(contentY + STRIP_HEIGHT, bottom - h),
        width: Math.max(0, panelW - APPROVAL_MARGIN * 2),
        height: h,
      });
      this.approvalView.setVisible(this._approvalPendingCount > 0);
    }
  }

  /** 审批浮层高度：按待批条数算，封顶 220px（超出内部滚动） */
  _approvalHeight() {
    const n = this._approvalPendingCount || 0;
    if (n <= 0) return 0;
    return Math.min(APPROVAL_MAX_HEIGHT, APPROVAL_HEADER_HEIGHT + n * APPROVAL_CARD_HEIGHT);
  }

  // ---------- 事件广播 ----------

  _emitState() {
    const state = this.publicState();
    this._sendToPanelOwner('browser-panel:state', state);
    this._sendToStrip('browser-panel:state', state);
  }

  _sendToPanelOwner(channel, payload) {
    if (this._tabManager && typeof this._tabManager.sendToBusiness === 'function') {
      this._tabManager.sendToBusiness(channel, payload);
    }
  }

  _sendToStrip(channel, payload) {
    if (this.stripView && !this.stripView.webContents.isDestroyed()) {
      try {
        this.stripView.webContents.send(channel, payload);
      } catch {
        /* 控制条未就绪时忽略 */
      }
    }
  }

  /** 阶段 6：推给审批浮层（待批列表变更） */
  _sendToApproval(channel, payload) {
    if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      try {
        this.approvalView.webContents.send(channel, payload);
      } catch {
        /* 浮层未就绪时忽略 */
      }
    }
  }

  // ---------- 销毁 ----------

  destroy() {
    this._destroyed = true;
    this._disposePanelView();
    if (this.stripView && !this.stripView.webContents.isDestroyed()) {
      try {
        this._knownWebContents.delete(this.stripView.webContents);
        this.window && !this.window.isDestroyed() && this.window.contentView.removeChildView(this.stripView);
        this.stripView.webContents.close();
      } catch {
        /* ignore */
      }
    }
    this.stripView = null;
    // 阶段 6：审批浮层随面板一起销毁（否则残留一个孤儿视图浮在窗口上）
    if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      try {
        this._knownWebContents.delete(this.approvalView.webContents);
        this.window && !this.window.isDestroyed() && this.window.contentView.removeChildView(this.approvalView);
        this.approvalView.webContents.close();
      } catch {
        /* ignore */
      }
    }
    this.approvalView = null;
    this._approvalPendingCount = 0;
    // 先通知订阅方（wiring 需在此撤销 broker 会话/token），再清空状态
    this._emitSessionEvent('destroyed');
    this.session = null;
    this._visible = false;
    // ③：面板销毁 = 主动清掉开关文件（registry 注释的"desktop 主动清理"路径；
    // desktop 进程整个退出时有 pid 探活兜底，这里是不留残留的第一道）
    const modeDir = this._modeDir();
    if (modeDir) {
      try {
        clearMode({ userDataDir: modeDir });
      } catch {
        /* 清理失败不影响销毁流程 */
      }
    }
  }
}

module.exports = {
  BrowserPanelManager,
  normalizePanelUrl,
  PANEL_MIN_WIDTH,
  PANEL_DEFAULT_WIDTH,
  STRIP_HEIGHT,
};
