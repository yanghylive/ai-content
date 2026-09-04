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
 *   面板与业务区之间留 PANEL_GUTTER(12px) 背景沟（browser-panel-gutter.html 视图）：
 *   分区靠"空隙 + 面板 1px 卡片边 + 落在沟里的投影"读出来，沟本身即全高调宽热区。
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
// TraeWork 分区语义：业务区与面板之间留一条背景色沟（而非分割线），
// 边界靠"两块卡片之间的空隙 + 卡片 1px 边 + 落在沟里的投影"读出来。
const PANEL_GUTTER = 12;
/** 拖拽会话看门狗：光标静止超过该时长 = 判定已松手（松手点常在别的视图上） */
const RESIZE_IDLE_MS = 1200;
/** 拖拽轮询间隔（ms）——主进程跟随系统光标，不受视图边界断流影响 */
const RESIZE_POLL_MS = 16;
/** round15：tab 条行高（多 tab 时控制条两行；单 tab 不显示，零干扰） */
const TABBAR_HEIGHT = 26;
// 地址栏聚焦时的快捷跳转行（TraeWork 地址行语义：聚焦即出建议）。
// 控制条是独立视图，下拉会被视图边界裁掉——所以聚焦时把视图加高一行。
const STRIP_EXPAND_HEIGHT = 30;
const TAB_STRIP_HEIGHT = 38; // 与 workspace-tabs.js 保持一致（顶部通栏高度）

// 阶段 6：审批浮层尺寸（与 browser-approval-overlay.html 的 CSS 保持一致，
// 否则会出现"卡片被裁掉一块"或"底部一大片空白"）
const APPROVAL_MARGIN = 8;

/**
 * 2026-09-04：面板 UA 清洗——去掉 Electron 默认 UA 里的 `appName/version` 与
 * `Electron/x.y.z` 两段，保留标准 Chrome 形态。
 * 真机实证：微信视频号对 Electron UA 风控（空壳渲染白屏）；Chrome 版本号从
 * 运行时 UA 提取（升级自适应，不硬编码）；平台段按 OS 生成（win 打包对齐）。
 * @param {string} ua 原始（Electron 默认）UA
 * @returns {string} 清洗后的标准 Chrome UA
 */
function sanitizePanelUserAgent(ua) {
  const raw = String(ua || '');
  const chrome = (raw.match(/Chrome\/[\d.]+/) || [])[0] || 'Chrome/128.0.0.0';
  const platform =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'Macintosh; Intel Mac OS X 10_15_7';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`;
}
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
    // 分区沟槽（本地受信，复用控制条 preload：只需要 set-width / begin / end 三个通道）
    this._gutterHtmlPath = deps.gutterHtmlPath || path.join(__dirname, 'browser-panel-gutter.html');
    this._logger = deps.logger || console;
    this.window = null;
    this.stripView = null;
    /** 分区沟槽视图（面板左缘全高，拖拽热区 + 卡片边线） */
    this.gutterView = null;
    this.panelView = null;
    /** 拖拽调宽会话（主进程轮询系统光标驱动） */
    this._resizeTimer = null;
    this._resizeLastX = null;
    this._resizeLastMove = 0;
    this._resizeGrabOffset = 0;
    // 阶段 7（round11）tabs：面板 tab 台账。panelView 恒等于 active tab 的视图
    // （既有 resolvePanelTarget/panelWebContents/navigate 等方法因此零改动自动
    // 作用于当前 tab）；台账项为 { view }，下标即 AiBrowserAction tabs.index。
    /** @type {Array<{view: any}>} */
    this._panelTabs = [];
    this._activeTabIndex = 0;
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
    /** 面板状态订阅（顶部标签条 chip 用；_emitState 时同步回调） */
    this._stateListeners = new Set();
    /** 控制条快捷跳转行是否展开（参与 _stripHeight） */
    this._stripExpanded = false;
  }

  /** 顶部标签条订阅面板状态广播（返回取消函数） */
  onStateChange(cb) {
    if (typeof cb !== 'function') return () => undefined;
    this._stateListeners.add(cb);
    return () => this._stateListeners.delete(cb);
  }

  /** 地址栏聚焦→控制条加高一行的快捷跳转行；失焦收起 */
  setStripExpanded(on) {
    const next = !!on;
    if (this._stripExpanded === next) return this._stripHeight();
    this._stripExpanded = next;
    this.relayout();
    this._emitState();
    return this._stripHeight();
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

  /**
   * 判断给定 webContents（或其 id）是否属于面板体系（面板/控制条/审批浮层）。
   *
   * 2026-09-04（微信登录卡死修复）：main.js 全局 will-navigate 导航守卫此前
   * 对所有 webContents 生效，面板视图内任何跨域导航（微信 oauth 从
   * open.weixin.qq.com 跳回 channels 域 callback、用户点平台页外链）都被
   * preventDefault → ERR_ABORTED，表现为扫码确认后永远卡「登录中...」。
   * 面板视图的产品语义就是浏览第三方平台，导航自由是预期行为；该守卫本意
   * 是保护主窗/3010 内容。故守卫经此方法对面板体系 webContents 豁免。
   *
   * @param {Electron.WebContents | number} webContentsOrId webContents 实例或 id
   * @returns {boolean} 是否属于面板体系
   */
  ownsWebContents(webContentsOrId) {
    if (this._destroyed) return false;
    let id = null;
    if (typeof webContentsOrId === 'number') {
      id = webContentsOrId;
    } else if (webContentsOrId && typeof webContentsOrId === 'object') {
      // 真实 Electron webContents 走 getId()；测试 fake/鸭子类型实例兜底读 .id
      if (typeof webContentsOrId.getId === 'function') id = webContentsOrId.getId();
      else if (typeof webContentsOrId.id === 'number') id = webContentsOrId.id;
    }
    if (id === null || id === undefined) return false;
    for (const wc of this._knownWebContents) {
      try {
        if (wc.isDestroyed()) continue;
        const wcId = typeof wc.getId === 'function' ? wc.getId() : wc.id;
        if (wcId === id) return true;
      } catch {
        /* 已销毁的 webContents 跳过 */
      }
    }
    return false;
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
    if (!this.gutterView) {
      // 分区沟槽：本地受信视图（与控制条同一 preload 姿态），全高贴面板左缘。
      this.gutterView = new WebContentsView({
        webPreferences: {
          preload: this._preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          partition: 'persist:ai-content-browser-gutter',
          backgroundThrottling: false,
        },
      });
      this._knownWebContents.add(this.gutterView.webContents);
      this.window.contentView.addChildView(this.gutterView);
      this.gutterView.webContents.loadFile(this._gutterHtmlPath);
      this.gutterView.setVisible(false);
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

  /**
   * 创建一个面板 tab 视图（阶段 7 tabs 抽取：tab[0] 与 tabs.new 共用）。
   * 只创建与接线，不动台账/panelView——调用方负责登记台账与置 active。
   */
  _spawnTabView(partition) {
    const { WebContentsView } = this._electron;
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true, // 第三方 web 内容：零特权
        partition,
        backgroundThrottling: false,
      },
    });
    // 2026-09-04（真机实证）：Electron 默认 UA 带 `appName/version`（ai-content-desktop/
    // x.y.z）+ `Electron/32.x` 两段，微信视频号（channels.weixin.qq.com）风控识别后
    // **空壳渲染**（HTML 193KB 在、视觉全白、innerText 为空）；抖音/小红书宽容未暴露。
    // 面板是用户登录/操作第三方平台的面——UA 清洗为标准 Chrome 形态（版本号从运行时
    // 提取，不硬编码；平台段按 OS 生成）。只动面板 webContents，主窗/3010 不受影响。
    try {
      view.webContents.setUserAgent(sanitizePanelUserAgent(view.webContents.getUserAgent()));
    } catch (e) {
      this._logger.warn('[browser-panel] UA 清洗失败（保留默认 UA）：', e && e.message);
    }
    this._panelPartitions = this._panelPartitions || new WeakMap();
    this._panelPartitions.set(view, partition);
    this._knownWebContents.add(view.webContents);
    this.window.contentView.addChildView(view);
    // 面板是新加的子视图 → 会盖在审批浮层之上，必须把浮层重新置顶
    this._bringApprovalToFront();
    this._wirePanelEvents(view);
    view.setVisible(false);
    return view;
  }

  _createPanelView(partition) {
    if (this.panelView && !this.panelView.webContents.isDestroyed()) {
      // 账号/分区变了才重建视图；同分区复用保持登录态
      if (this._partitionOf(this.panelView) === partition) return;
      this._disposePanelView();
    }
    const view = this._spawnTabView(partition);
    this._panelTabs = [{ view }];
    this._activeTabIndex = 0;
    this.panelView = view;
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

  /** 销毁全部面板 tab 视图（阶段 7 tabs：账号切换/destroy 必须清台账，不留幽灵 view） */
  _disposePanelView() {
    const views =
      this._panelTabs && this._panelTabs.length
        ? this._panelTabs.map((t) => t.view)
        : this.panelView
          ? [this.panelView]
          : [];
    for (const view of views) {
      try {
        if (!view.webContents.isDestroyed()) {
          this._knownWebContents.delete(view.webContents);
          this.window.contentView.removeChildView(view);
          view.webContents.close();
        }
      } catch (error) {
        this._logger.warn('[browser-panel] 面板视图销毁异常：', error && error.message);
      }
    }
    this._panelTabs = [];
    this._activeTabIndex = 0;
    this.panelView = null;
  }

  _wirePanelEvents(view) {
    const wc = view.webContents;
    const push = (patch) => {
      if (!this.session) return;
      // 阶段 7（round11）tabs：只有 active tab 的事件才更新会话状态——后台
      // tab 的导航/加载不得污染 currentUrl/status（switch 后自然跟踪新 active）。
      if (this.panelView && wc.id !== this.panelView.webContents.id) return;
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
    // round15：标题变化 → tab 条明细刷新（不 merge session，只广播）。
    // 沿用 active-only 判断：后台 tab 标题变化不打扰状态流。
    wc.on('page-title-updated', (_e, title) => {
      if (!this.session) return;
      if (this.panelView && wc.id !== this.panelView.webContents.id) return;
      this._emitState();
    });
    // round17（对齐文档 3.1 第一选项）：新窗口进受控 tab——原 popup 一律 deny，
    // 目标 URL 在面板内自动开新 tab 加载（受控：同 partition、Agent 审批链与
    // 用户关闭权同等管辖，不外逃系统浏览器）。文档的「经明确确认后外开」
    // 未实现前**不提供外开路径**（宁 deny 不外逃）。异常兜底回 popup-blocked。
    wc.setWindowOpenHandler((details) => {
      const url = details.url || '';
      try {
        const snapshot = this.tabsOperation('new');
        const activeView = this.panelView;
        if (!activeView || activeView.webContents.isDestroyed()) {
          throw new Error('新 tab 视图不可用');
        }
        activeView.webContents.loadURL(url);
        this._sendToPanelOwner('browser-panel:popup-opened-in-tab', {
          url,
          tabs: snapshot.tabs,
          activeIndex: snapshot.activeIndex,
        });
      } catch (error) {
        this._logger.warn('[browser-panel] popup 转受控 tab 失败：', error && error.message);
        this._sendToPanelOwner('browser-panel:popup-blocked', { url, error: error && error.message });
      }
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
    // 阶段 5（2026-09-04）：点名「在面板中打开」= 明确使用面板的意图——
    // agent mode 开关未开时自动补开（写 0600 mode 文件，backend 即时读到 on，
    // login-state / 面板动作链才通）。用户仍可在控制条手动关；hide 不动 mode 文件
    // （关面板 ≠ 关授权，登录态引导还要用）。失败不阻断 open，backend 会显式报未开启。
    try {
      if (this.getAgentMode() !== 'on') this.setAgentMode(true);
    } catch (e) {
      console.warn('[BrowserPanel] 自动补开 agent mode 失败（不阻断 open）:', e?.message || e);
    }
    this.relayout();
    this.panelView.webContents.loadURL(targetUrl);
    this._emitState();
    this._emitSessionEvent(accountSwitched ? 'account-switched' : 'opened');
    return this.publicState();
  }

  /** 面板关闭 = 隐藏视图，保留会话与登录态（文档 §3.1） */
  hide() {
    this._visible = false;
    // 阶段 7 tabs：隐藏全部 tab 视图（不能只藏 active，否则后台 tab 残影）
    for (const tab of this._panelTabs) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.setVisible(false);
    }
    if (this.stripView) this.stripView.setVisible(false);
    this.endResize();
    if (this.gutterView && !this.gutterView.webContents.isDestroyed()) this.gutterView.setVisible(false);
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

  // ---------- 面板 tabs（阶段 7 round11：AiBrowserAction tabs 桥接） ----------

  /**
   * tabs 动作主进程实现（Broker 的 Panel.tabs 伪 method 经 wiring 回调到这里）。
   *
   * 语义对齐旧无头路径（ai-browser-action.service.ts case 'tabs'）+ 两点收紧：
   *  - new：新 tab = 空白页并置为 active（对齐 newPage()+bringToFront）；
   *  - switch：index 越界**显式失败**（旧无头 fallback pages[0] 是静默降级，
   *    面板模式 fail-closed）；
   *  - close：index 缺省 = 关当前 active；越界显式失败；**最后一个 tab 不可关**
   *    （对齐旧无头 pages[0] 保护的动机——面板永远保留一个页面；差异交底：
   *    多 tab 时面板允许关最早开的 tab[0]，旧无头不允许）。
   *
   * @returns {{tabs:number, activeIndex:number, url:string|null}} 台账快照
   * @throws 面板未打开 / 未知 operation / index 越界 / 关最后一个
   */
  tabsOperation(operation, index) {
    if (!this.session || !this.panelView || this.panelView.webContents.isDestroyed()) {
      throw new Error('浏览器面板未打开，tab 操作不可用');
    }
    const partition = this._partitionOf(this.panelView);
    if (operation === 'new') {
      const view = this._spawnTabView(partition);
      // 立即加载 about:blank（对齐旧无头 newPage 的初始 URL）：新 view 不加载时
      // getURL() 返回空串，broker resolveTarget 会回落到陈旧的 session.currentUrl
      // （其他 tab 的 URL）——binding 直接撒谎。加载后 getURL()='about:blank' 自洽。
      view.webContents.loadURL('about:blank');
      this._panelTabs.push({ view });
      this._setActiveTab(this._panelTabs.length - 1);
      return this._tabSnapshot();
    }
    if (operation === 'switch') {
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= this._panelTabs.length) {
        throw new Error(
          `切换目标标签页不存在：index=${String(index)}（当前共 ${this._panelTabs.length} 个）`,
        );
      }
      this._setActiveTab(i);
      return this._tabSnapshot();
    }
    if (operation === 'close') {
      const n = this._panelTabs.length;
      if (n <= 1) throw new Error('不能关闭最后一个标签页（面板至少保留一个页面）');
      const i = index == null ? this._activeTabIndex : Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= n) {
        throw new Error(`关闭目标标签页不存在：index=${String(index)}（当前共 ${n} 个）`);
      }
      const closed = this._panelTabs[i];
      this._panelTabs.splice(i, 1);
      try {
        this._knownWebContents.delete(closed.view.webContents);
        this.window.contentView.removeChildView(closed.view);
        closed.view.webContents.close();
      } catch (error) {
        this._logger.warn('[browser-panel] 标签页关闭异常：', error && error.message);
      }
      if (closed.view === this.panelView) {
        // 关的是 active：active 落到相邻 tab（优先原位，末端则前移）
        this._setActiveTab(Math.min(i, this._panelTabs.length - 1));
      } else {
        // 关的是后台 tab：panelView 不变，仅修正 active 下标。
        // round15：tab 数变化会改变控制条高度（tab 条出现/消失），必须 relayout。
        this._activeTabIndex = this._panelTabs.findIndex((t) => t.view === this.panelView);
        this.relayout();
        this._emitState();
      }
      return this._tabSnapshot();
    }
    throw new Error(`未知的标签页操作：${String(operation)}`);
  }

  /** 置第 i 个 tab 为 active：切 panelView 引用 + 视图层级 + 会话 URL 同步 */
  _setActiveTab(i) {
    const prev = this.panelView;
    this._activeTabIndex = i;
    this.panelView = this._panelTabs[i].view;
    if (prev && prev !== this.panelView && !prev.webContents.isDestroyed()) {
      prev.setVisible(false);
    }
    // 层级：active tab 提到业务子视图顶端，审批浮层最后重新置顶
    try {
      this.window.contentView.removeChildView(this.panelView);
      this.window.contentView.addChildView(this.panelView);
    } catch {
      /* 视图已销毁时忽略 */
    }
    this._bringApprovalToFront();
    // 会话 URL 必须跟 active tab 走：新开/切到未加载的 tab 时 getURL() 为空，
    // 回退 about:blank（否则 resolvePanelTarget 的 url 是旧 tab 的——自相矛盾证据）
    if (this.session) {
      this.session.currentUrl =
        this.panelView.webContents.getURL() || 'about:blank';
    }
    this.relayout();
    this._emitState();
  }

  _tabSnapshot() {
    return {
      tabs: this._panelTabs.length,
      activeIndex: this._activeTabIndex,
      url:
        this.panelView && !this.panelView.webContents.isDestroyed()
          ? this.panelView.webContents.getURL() || 'about:blank'
          : null,
    };
  }

  /** round15：tab 条明细（title/url），publicState.tabList 供控制条渲染 */
  _tabList() {
    return this._panelTabs.map((t) => {
      const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
      const title = wc && typeof wc.getTitle === 'function' ? wc.getTitle() : '';
      return {
        title: String(title || '').slice(0, 40),
        url: wc ? wc.getURL() || 'about:blank' : 'about:blank',
      };
    });
  }

  /**
   * round15：用户经控制条手动切/关 tab（tabsOperation 复用语义与校验）。
   * **用户操作不走 Agent 审批闸门**——审批只约束 Agent 动作；用户在自家面板
   * 点 tab 与点后退/刷新同权（stripOnly 通道 + isStripSender 门禁已在 IPC 层）。
   * UI 通道不抛异常：错误转 {ok:false, error} 交给控制条状态刷新。
   */
  switchTabByUser(index) {
    try {
      return { ok: true, snapshot: this.tabsOperation('switch', index) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  closeTabByUser(index) {
    try {
      return { ok: true, snapshot: this.tabsOperation('close', index) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  setWidth(width) {
    this.endResize();
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
    // "strip" = 本地受信 chrome 视图（控制条 / 分区沟槽），第三方面板页永不命中。
    return !!(
      sender &&
      ((this.stripView && !this.stripView.webContents.isDestroyed() && this.stripView.webContents.id === sender.id) ||
        (this.gutterView && !this.gutterView.webContents.isDestroyed() && this.gutterView.webContents.id === sender.id))
    );
  }

  /**
   * 拖拽调宽会话开始（沟槽 pointerdown 触发）。
   * 为什么不在渲染层算 delta：沟槽只有 10px 宽，光标一移出视图就收不到
   * pointermove（Electron 子视图各自吃鼠标事件），拖到一半就断。改成主进程
   * 轮询系统光标（原生分割条做法），全程跟手。
   */
  beginResize() {
    if (this._destroyed || !this._visible || this._resizeTimer) return false;
    const localX = this._cursorLocalX();
    if (localX == null) return false;
    // 按下点与面板左缘的相对偏移：拖拽全程保持，避免"一按下去就跳 10px"
    this._resizeGrabOffset = localX - (this.window.getContentBounds().width - this.width());
    this._resizeLastX = localX;
    this._resizeLastMove = Date.now();
    this._resizeTimer = setInterval(() => this._pollResize(), RESIZE_POLL_MS);
    return true;
  }

  /** 系统光标 → 窗口内容坐标（取不到返回 null，调用方据此放弃会话） */
  _cursorLocalX() {
    try {
      const cursor = this._electron.screen.getCursorScreenPoint();
      const bounds = this.window.getContentBounds();
      return cursor.x - (bounds.x || 0);
    } catch (error) {
      return null;
    }
  }

  _pollResize() {
    const localX = this._cursorLocalX();
    if (localX == null) {
      this.endResize();
      return;
    }
    const bounds = this.window.getContentBounds();
    if (this._resizeLastX != null && Math.abs(localX - this._resizeLastX) > 1) {
      this._resizeLastMove = Date.now();
    }
    this._resizeLastX = localX;
    const next = this._clampWidth(bounds.width - (localX - (this._resizeGrabOffset || 0)));
    if (next !== this._currentWidth) {
      this._currentWidth = next;
      this.relayout();
      this._emitState();
    }
    if (Date.now() - this._resizeLastMove > RESIZE_IDLE_MS) this.endResize();
  }

  /** 会话结束：electron-store 是同步落盘，拖拽中不逐帧写，松手一次性持久化 */
  endResize() {
    if (!this._resizeTimer) return false;
    clearInterval(this._resizeTimer);
    this._resizeTimer = null;
    this._resizeLastX = null;
    this._resizeGrabOffset = 0;
    if (this._store && typeof this._store.set === 'function' && this._currentWidth != null) {
      try {
        this._store.set('browserPanelWidth', this._currentWidth);
      } catch {
        /* 持久化失败不影响本次会话宽度 */
      }
    }
    return true;
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
      // 阶段 7 tabs：台账规模与 active 下标（冒烟/排障断言用）
      tabCount: this._panelTabs.length,
      tabActiveIndex: this._activeTabIndex,
      // round15：tab 条明细（title/url），控制条 tab 条渲染用。
      // 本地面板显示完整 url（与地址栏同权，非对外证据流）。
      tabList: this._tabList(),
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

  /** 控制条总高：多 tab 时加 tab 条行（round15；单 tab 零干扰不变高） */
  _stripHeight() {
    const base = this._panelTabs.length > 1 ? STRIP_HEIGHT + TABBAR_HEIGHT : STRIP_HEIGHT;
    return base + (this._stripExpanded ? STRIP_EXPAND_HEIGHT : 0);
  }

  relayout() {
    if (!this.window || this.window.isDestroyed() || !this._visible) return;
    const { width, height } = this.window.getContentBounds();
    // 窗口收窄/重建时重新夹取面板宽度（上限 60%），保证不遮挡 3010 主内容
    this._currentWidth = this._clampWidth(this.width());
    const panelW = this._currentWidth;
    const contentY = TAB_STRIP_HEIGHT;
    const contentH = Math.max(0, height - TAB_STRIP_HEIGHT);
    const stripH = this._stripHeight();
    const x = Math.max(0, width - panelW);
    const gutter = Math.min(PANEL_GUTTER, x);
    if (this._tabManager) {
      // 业务区多让出 gutter 像素，沟槽才有背景色可露（否则两视图贴边=一条线）
      this._tabManager.rightInset = panelW + gutter;
      this._tabManager.relayout();
    }
    if (this.gutterView && !this.gutterView.webContents.isDestroyed()) {
      this.gutterView.setBounds({ x: x - gutter, y: contentY, width: gutter, height: contentH });
      this.gutterView.setVisible(gutter > 0);
    }
    if (this.stripView && !this.stripView.webContents.isDestroyed()) {
      this.stripView.setBounds({ x, y: contentY, width: panelW, height: stripH });
      this.stripView.setVisible(true);
    }
    if (this.panelView && !this.panelView.webContents.isDestroyed()) {
      this.panelView.setBounds({
        x,
        y: contentY + stripH,
        width: panelW,
        height: Math.max(0, contentH - stripH),
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
        y: Math.max(contentY + stripH, bottom - h),
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
    // 顶部标签条（浏览器 chip / 宽度预设按钮）订阅同一状态流
    for (const cb of this._stateListeners) {
      try { cb(state); } catch { /* 单个订阅方异常互不影响 */ }
    }
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
    this.endResize();
    if (this.gutterView && !this.gutterView.webContents.isDestroyed()) {
      try {
        this._knownWebContents.delete(this.gutterView.webContents);
        this.window && !this.window.isDestroyed() && this.window.contentView.removeChildView(this.gutterView);
        this.gutterView.webContents.close();
      } catch {
        /* ignore */
      }
    }
    this.gutterView = null;
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
  sanitizePanelUserAgent,
  PANEL_MIN_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_GUTTER,
  STRIP_HEIGHT,
};
