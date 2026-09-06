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

// 面板最小宽：不再是固定 360，而是「手机视口比例」动态值（见 _phoneMinWidth）——
// 往左滑到最窄时，面板页面区正好是一块主流手机屏。
// 此常量退居两层用途：比例异常时的兜底下限 + 记忆宽度合法性校验。
const PANEL_MIN_WIDTH = 320;
/**
 * 手机视口比例（宽/高）= 20:9——当下主流全面屏标准：小米/华为/三星旗舰
 * （1080×2400、1440×3200）、Pixel 412×915 都是这个比例；比 iPhone 的
 * 19.5:9（393×852）更窄长，观感更接近"真手机"。
 */
const PHONE_VIEWPORT_RATIO = 9 / 20;
/** 动态手机宽上限：再高也不把业务区挤过头（小窗时比例让位于可用宽） */
const PANEL_PHONE_WIDTH_MAX = 560;
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
/** 面板开合动画：时长/步进（WebContentsView 没有 CSS 过渡，主进程逐帧 setBounds 补间） */
const PANEL_ANIM_MS = 150;
const PANEL_ANIM_STEP_MS = 16;
// 面板平台识别（快捷打开/地址栏**手动**导航时）：命中即广播
// browser-panel:platform-focus 给左侧业务视图，系统功能页跟着切到该平台的
// 获客工作台（TraeWork 式"看哪干哪"）。只挂 manager.navigate——AI 执行走
// broker.sendCDP 不经过这里，Agent 自动导航不会劫持用户左侧页面。
// 公众号/百度无对应获客页 → 不在表内 = 不联动（不硬凑跳转）。
const PANEL_PLATFORM_HOSTS = [
  [/douyin\.com$/i, 'douyin'],
  [/(^|\.)xiaohongshu\.com$/i, 'xiaohongshu'],
  [/^channels\.weixin\.qq\.com$/i, 'wechat-channel'],
  [/(^|\.)kuaishou\.com$/i, 'kuaishou'],
];
function matchPanelPlatform(rawUrl) {
  try {
    const host = new URL(String(rawUrl)).hostname;
    for (const [re, platform] of PANEL_PLATFORM_HOSTS) {
      if (re.test(host)) return platform;
    }
  } catch (e) { /* 非法 URL 不参与联动 */ }
  return null;
}

/** 拖拽磁吸：距半宽/最大/最小宽该像素内自动吸附（呼应顶栏宽度预设） */
const RESIZE_SNAP_PX = 14;
/** round15：tab 条行高（多 tab 时控制条两行；单 tab 不显示，零干扰） */
const TABBAR_HEIGHT = 26;
// 地址栏聚焦时的快捷跳转行（TraeWork 地址行语义：聚焦即出建议）。
// 控制条是独立视图，下拉会被视图边界裁掉——所以聚焦时把视图加高一行。
const STRIP_EXPAND_HEIGHT = 30;
// Agent 活动条行高：面板有活动记录时常驻在控制条底部（TraeWork「控制台日志」语义）
const ACTIVITY_ROW_HEIGHT = 30;
/** 活动日志「展开全部」区高度上限（控制条视图按此加高，超出内部滚动） */
const ACTIVITY_FULL_MAX_HEIGHT = 170;
/** 活动日志容量：内存环形，够回看即可 */
const ACTIVITY_CAP = 30;
/** publicState 下发的活动条数（最新在前） */
const ACTIVITY_EXPOSE = 15;
const TAB_STRIP_HEIGHT = 38; // 与 workspace-tabs.js 保持一致（顶部通栏高度）

// TRAE 对齐：AI 控制权悬浮胶囊（页面底部居中，agentMode=on 才出现）
const PILL_WIDTH = 380;
const PILL_HEIGHT = 56;

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
    this._pillPreloadPath = deps.pillPreloadPath || path.join(__dirname, 'browser-control-pill-preload.js');
    this._pillHtmlPath = deps.pillHtmlPath || path.join(__dirname, 'browser-control-pill.html');
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
    /** 开合动画（deps.animatePanels=false 可关，spec 同步断言用） */
    this._animate = deps.animatePanels !== false;
    this._animTimer = null;
    /** 动画期渲染宽（null = 无动画，relayout 用逻辑宽）；逻辑宽 _currentWidth 不受动画影响 */
    this._animWidth = null;
    // 阶段 7（round11）tabs：面板 tab 台账。panelView 恒等于 active tab 的视图
    // （既有 resolvePanelTarget/panelWebContents/navigate 等方法因此零改动自动
    // 作用于当前 tab）；台账项为 { view }，下标即 AiBrowserAction tabs.index。
    /** @type {Array<{view: any}>} */
    this._panelTabs = [];
    this._activeTabIndex = 0;
    /** 审批浮层视图（本地受信；只在有待批动作时可见） */
    this.approvalView = null;
    /** TRAE 对齐：AI 控制权悬浮胶囊视图（透明背景，agentMode=on 才可见） */
    this.pillView = null;
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
    /** 展开部分当前高度（快捷行 30 / 建议下拉按需加高） */
    this._stripExpandH = STRIP_EXPAND_HEIGHT;
    /** Agent/面板活动日志（时间戳记录，供控制条底部活动条回看） */
    this._activityLog = [];
    /** 活动日志是否展开为完整列表（参与 _stripHeight，与快捷行展开互不冲突） */
    this._activityExpanded = false;
    /** 展开区当前实际高度（由控制条上报，夹取到 ACTIVITY_FULL_MAX_HEIGHT） */
    this._activityExpandH = 0;
    /** 当前待批高亮的目标 selector（审批浮层"批准前看到点哪里"；导航后重注入） */
    this._highlightSelector = null;
    // ---- TraeWork 控制权模型 ----
    /** 控制权归属：'system'=AI 直接执行（默认）；'user'=用户接管（新签单排队） */
    this._control = 'system';
    /** 控制权变更订阅（wiring 据此在交还时批量放行排队单） */
    this._controlListeners = new Set();
    /** 最近一次下发给审批浮层的待批列表（控制权切换时重推，浮层横幅跟随） */
    this._lastApprovalPending = [];
  }

  /** 顶部标签条订阅面板状态广播（返回取消函数） */
  onStateChange(cb) {
    if (typeof cb !== 'function') return () => undefined;
    this._stateListeners.add(cb);
    return () => this._stateListeners.delete(cb);
  }

  // ---------- 控制权模型（TraeWork：默认系统控制，用户可随时接管） ----------

  /** 当前控制权归属（'system' | 'user'；非法值一律回落 'system'） */
  getControl() {
    return this._control === 'user' ? 'user' : 'system';
  }

  /** 订阅控制权变更（返回取消函数）；wiring 用它在交还时批量放行排队单 */
  onControlChange(cb) {
    if (typeof cb !== 'function') return () => undefined;
    this._controlListeners.add(cb);
    return () => this._controlListeners.delete(cb);
  }

  /** 接管：control='user'，AI 新签单保持排队（浮层可见可逐条处理），用户手动操作页面 */
  takeControl() {
    if (this._control === 'user') return this.publicState();
    this._control = 'user';
    this.recordActivity('control', '你已接管页面，AI 代操作暂停', true);
    this._emitControlChange();
    return this.publicState();
  }

  /** 交还：control='system'，排队中的待批单由 wiring 订阅批量放行，AI 继续代操作 */
  releaseControl() {
    if (this._control === 'system') return this.publicState();
    this._control = 'system';
    this.recordActivity('control', '已交还 AI，继续代操作', true);
    this._emitControlChange();
    return this.publicState();
  }

  _emitControlChange() {
    for (const cb of this._controlListeners) {
      try {
        cb(this._control);
      } catch {
        /* 单个订阅方异常不拖垮控制权切换 */
      }
    }
    this._emitState();
    // 浮层横幅跟随 control 态：重推最近的待批列表（幂等，高亮重注入可接受）
    this.updateApprovalList(this._lastApprovalPending);
  }

  /**
   * 地址栏聚焦→控制条加高，露出快捷跳转行/建议下拉；失焦收起。
   * @param {number} [height] 展开区需要的像素高（快捷行 30；建议下拉按需
   *   30 + 建议条数*24）。视图只有此高度，内容区溢出会被裁掉，故高度要量准。
   */
  setStripExpanded(on, height) {
    const next = !!on;
    // 面板收起时拒绝展开请求（视图本来就藏着一行空白，还会泄漏到下次打开）；
    // 收起请求照常放行（复位状态）
    if (next && !this._visible) return this._stripHeight();
    let h = this._stripExpandH;
    if (on) {
      h = Math.max(30, Math.min(160, Math.floor(Number(height) || STRIP_EXPAND_HEIGHT)));
    }
    // 只改高度也要重排（建议下拉从 1 行长到 4 行时视图必须跟着长）
    const changed = next !== this._stripExpanded || h !== this._stripExpandH;
    this._stripExpanded = next;
    this._stripExpandH = h;
    if (changed) {
      this.relayout();
      this._emitState();
    }
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
    if (!this.pillView) {
      // TRAE 对齐：AI 控制权悬浮胶囊。透明背景视图，只有胶囊本体可点。
      this.pillView = new WebContentsView({
        webPreferences: {
          preload: this._pillPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false, // 本地受信（同控制条/审批浮层）
          partition: 'persist:ai-content-browser-pill',
          backgroundThrottling: false,
        },
      });
      try {
        this.pillView.setBackgroundColor('#00000000');
      } catch { /* 老版本 View 无此 API：透明靠页面 CSS 兜底 */ }
      this._knownWebContents.add(this.pillView.webContents);
      this.window.contentView.addChildView(this.pillView);
      this.pillView.webContents.loadFile(this._pillHtmlPath);
      this.pillView.setVisible(false);
    }
    if (!this.panelView) {
      // 面板 webContents 在首次 open 时按账号 partition 创建（见 _createPanelView）
    }
  }

  _panelWidth() {
    if (!this._store || typeof this._store.get !== 'function') return PANEL_DEFAULT_WIDTH;
    // 有工作区 scope 时优先读 scoped 键，无值回落全局键；都没有用默认宽
    const scope = this._activeBusinessId();
    const scoped = scope ? this._store.get(`browserPanelWidth.${scope}`) : undefined;
    const global = this._store.get('browserPanelWidth');
    const base = Number.isFinite(scoped) && scoped >= PANEL_MIN_WIDTH ? scoped : global;
    return this._clampWidth(Number.isFinite(base) && base >= PANEL_MIN_WIDTH ? base : PANEL_DEFAULT_WIDTH);
  }

  /** 当前业务标签 ID（宽度按工作区记忆的 scope；无标签时空 = 全局默认键） */
  _activeBusinessId() {
    try {
      const tm = this._tabManager;
      if (!tm) return '';
      const tab = tm.tabs && tm.tabs.get(tm.activeId);
      return tab && tab.kind !== 'octop' && tab.workspaceId ? tab.workspaceId : '';
    } catch (e) {
      return '';
    }
  }

  _saveWidth() {
    if (!this._store || typeof this._store.set !== 'function' || this._currentWidth == null) return;
    const scope = this._activeBusinessId();
    try {
      this._store.set(scope ? `browserPanelWidth.${scope}` : 'browserPanelWidth', this._currentWidth);
    } catch (e) {
      /* 持久化失败不影响本次会话宽度 */
    }
  }

  /**
   * 最窄 = 手机比例宽：面板页面区高 ≈ 窗口内容高 − 顶部通栏 − 控制条基准高，
   * 乘 20:9 即得「这块屏是主流手机」的像素宽。窗口越高，滑到最窄越宽——
   * 与真手机竖屏比例始终一致，而不是固定 360 在高屏上显得过窄。
   */
  _phoneMinWidth() {
    let bounds = { width: 0, height: 0 };
    try {
      // 与 _clampWidth 同一取值面：attach 后即可用；取不到回 {0,0} 走兜底
      if (this.window && typeof this.window.getContentBounds === 'function') {
        bounds = this.window.getContentBounds() || bounds;
      }
    } catch (e) { /* 窗口销毁竞态：回落兜底 */ }
    // 页面区高 = relayout 真实几何：窗口高 − 顶部通栏 − 控制条当前行高
    //（tab 条/活动条占位一并扣除——地址栏聚焦展开是临时态，不锁存进宽度）
    const pageH = Math.max(0, (bounds.height || 0) - TAB_STRIP_HEIGHT - this._stripHeight());
    const ideal = Math.round(pageH * PHONE_VIEWPORT_RATIO);
    if (!Number.isFinite(ideal) || ideal <= 0) return PANEL_MIN_WIDTH;
    const avail = Math.max(0, Math.floor((bounds.width || 0) * PANEL_WIDTH_RATIO_MAX) - PANEL_GUTTER);
    return Math.max(PANEL_MIN_WIDTH, Math.min(ideal, PANEL_PHONE_WIDTH_MAX, avail));
  }

  _clampWidth(width) {
    const bounds = this.window && this.window.getContentBounds
      ? this.window.getContentBounds()
      : { width: PANEL_DEFAULT_WIDTH / PANEL_WIDTH_RATIO_MAX };
    const maxWidth = Math.floor(bounds.width * PANEL_WIDTH_RATIO_MAX);
    return Math.max(this._phoneMinWidth(), Math.min(Math.floor(width), maxWidth));
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
    this._bringPillToFront();
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

  /** 悬浮胶囊同样要压在面板视图之上（面板账号切换重建后重新置顶） */
  _bringPillToFront() {
    if (!this.pillView || this.pillView.webContents.isDestroyed()) return;
    if (!this.window || this.window.isDestroyed()) return;
    try {
      this.window.contentView.removeChildView(this.pillView);
      this.window.contentView.addChildView(this.pillView);
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
    wc.on('did-finish-load', () => {
      push({ status: 'ready' });
      // 页面换了，高亮标记随之消失——还有待批动作时重注入
      if (this._highlightSelector) this._applyPendingHighlight();
      // 2026-09-05 复核 P0-1（页面级账号绑定）：跨文档导航会重置 JS 全局，
      // 每次加载完成后重注入绑定标记，引擎据此精确核对「这个 page 属于哪个账号」。
      this._injectPanelBindingMarker();
    });
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

  /**
   * 2026-09-05 复核 P0-1（页面级账号绑定）：把「面板当前归属」写进页面全局
   * （__kaypalPanelBinding），作为 engine 取页时的**页面级事实源**——
   * 台账核验（panel-state）与取页之间存在竞态窗口（A/B 并发切换时 A 可能
   * 核验通过后拿到 B 的 page），页面自带绑定标记后，任何 page 归属错位都会
   * 被 engine evaluate 校验拦下（mismatch → 拒收 → 兜底 spawn），不再可能
   * 「核验 A、登记 B」。注入失败静默（页面可能正在导航，did-finish-load 会补）。
   */
  _injectPanelBindingMarker() {
    const view = this.panelView;
    if (!view || !view.webContents || view.webContents.isDestroyed() || !this.session) {
      return;
    }
    const marker = {
      panelId: this.session.panelId,
      sessionId: this.session.sessionId,
      accountId:
        this.session.accountId != null ? String(this.session.accountId) : null,
      partition: this.session.partition,
      injectedAt: new Date().toISOString(),
    };
    try {
      view.webContents
        .executeJavaScript(
          `window.__kaypalPanelBinding = ${JSON.stringify(marker)};`,
        )
        .catch(() => {});
    } catch {
      /* 渲染进程不可用时不阻断 open，did-finish-load/下次 open 会补 */
    }
  }

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
    if (this._animate) this._animWidth = 0;
    this.relayout();
    this._animateWidthTo(this._currentWidth);
    this.panelView.webContents.loadURL(targetUrl);
    // 2026-09-05 复核 P0-1（页面级账号绑定）：open 后立即注入（复用已加载页面
    // 时无新导航，did-finish-load 不会再触发）；新导航由 did-finish-load 重注入。
    this._injectPanelBindingMarker();
    this._emitState();
    this._emitSessionEvent(accountSwitched ? 'account-switched' : 'opened');
    this.recordActivity('open', '打开浏览器面板', true);
    return this.publicState();
  }

  /** 面板关闭 = 隐藏视图，保留会话与登录态（文档 §3.1）。带动画时先收拢再拆 */
  hide() {
    if (!this._visible) return this.publicState();
    if (!this._animate) return this._hideNow();
    // 收起动画：渲染宽补间到 0 才 setVisible(false)——业务区跟着补间回弹，
    // 而不是"视图瞬间消失 + rightInset 一步置 0"的硬切
    this._animateWidthTo(0, () => this._hideNow());
    return this.publicState();
  }

  _hideNow() {
    this._visible = false;
    this._stripExpanded = false;
    this._activityExpanded = false;
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
    this.recordActivity('hide', '收起浏览器面板', true);
    return this.publicState();
  }

  /** 恢复显示（沿用当前会话与 URL） */
  show() {
    if (!this.session || !this.panelView) return null;
    this._visible = true;
    if (this._animate) this._animWidth = 0;
    this.relayout();
    this._animateWidthTo(this._currentWidth);
    if (this.session.status === 'stopped') this.session.status = 'ready';
    this._emitState();
    this._emitSessionEvent('shown');
    this.recordActivity('show', '恢复浏览器面板', true);
    return this.publicState();
  }

  navigate(rawUrl) {
    if (!this.session || !this.panelView) throw new Error('浏览器面板未打开');
    const targetUrl = normalizePanelUrl(rawUrl);
    this.session.status = 'starting';
    this._emitState();
    this.panelView.webContents.loadURL(targetUrl);
    this.recordActivity('nav', `打开 ${targetUrl}`, true);
    // 左侧联动：面板打开的是哪个平台，业务页就切到该平台的获客工作台
    const focus = matchPanelPlatform(targetUrl);
    if (
      focus &&
      this._tabManager &&
      typeof this._tabManager.sendToBusiness === 'function'
    ) {
      try {
        this._tabManager.sendToBusiness('browser-panel:platform-focus', {
          platform: focus,
          url: targetUrl,
        });
      } catch (e) {
        /* 业务视图未就绪：联动是锦上添花，不阻断导航 */
      }
    }
    return targetUrl;
  }

  goBack() {
    if (this.panelView && this.panelView.webContents.canGoBack()) {
      this.panelView.webContents.goBack();
      this.recordActivity('nav', '后退', true);
    }
  }

  goForward() {
    if (this.panelView && this.panelView.webContents.canGoForward()) {
      this.panelView.webContents.goForward();
      this.recordActivity('nav', '前进', true);
    }
  }

  reload() {
    if (this.panelView) {
      this.panelView.webContents.reload();
      this.recordActivity('nav', '刷新', true);
    }
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
    this._bringPillToFront();
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
      this.recordActivity('tab', `切换标签页 ${Number(index) + 1}`, true);
      return { ok: true, snapshot: this.tabsOperation('switch', index) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  closeTabByUser(index) {
    try {
      this.recordActivity('tab', '关闭标签页', true);
      return { ok: true, snapshot: this.tabsOperation('close', index) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  /** TRAE 对齐：控制条「+」新建面板标签页 */
  newTabByUser() {
    try {
      this.recordActivity('tab', '新建标签页', true);
      return { ok: true, snapshot: this.tabsOperation('new') };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  /** TRAE 对齐：加载中 reload 变 ✕ 停止 */
  stop() {
    if (this.panelView && !this.panelView.webContents.isDestroyed()) {
      this.panelView.webContents.stop();
    }
  }

  setWidth(width) {
    this.endResize();
    const next = this._clampWidth(Number(width));
    this._currentWidth = next;
    this._saveWidth();
    this.relayout();
    this._emitState();
    return next;
  }

  width() {
    if (this._currentWidth == null) this._currentWidth = this._panelWidth();
    return this._currentWidth;
  }

  /**
   * 业务标签切换后由外部调用（main.js 订阅 tabManager.onActiveChange）：
   * 按新工作区 scope 重读记忆宽度并重排。无持久化差异时数值不变、不抖动。
   */
  recalcWidthForContext() {
    if (this._destroyed) return;
    const next = this._panelWidth();
    if (next !== this._currentWidth) {
      this._currentWidth = next;
      if (this._visible) this.relayout();
      this._emitState();
    }
    return next;
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
    const raw = bounds.width - (localX - (this._resizeGrabOffset || 0));
    const next = this._clampWidth(this._snapWidth(raw, bounds.width));
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
    this._saveWidth();
    return true;
  }

  _cancelAnim() {
    if (this._animTimer) {
      clearInterval(this._animTimer);
      this._animTimer = null;
    }
  }

  /**
   * 渲染宽补间（easeOutCubic）。只动 _animWidth（relayout 的显示宽度），
   * 逻辑宽 _currentWidth/持久化/宽度记忆都不受影响；done 在收尾帧后执行。
   * 重复调用互斥（新动画顶掉旧的及其 done——hide 动画中途 open 不会误拆视图）。
   */
  _animateWidthTo(to, done) {
    this._cancelAnim();
    const from = this._animWidth != null ? this._animWidth : this._currentWidth;
    if (!this._animate || from === to || this._destroyed) {
      this._animWidth = null;
      if (this._visible) this.relayout();
      if (done) done();
      return;
    }
    const start = Date.now();
    this._animWidth = from;
    this._animTimer = setInterval(() => {
      if (this._destroyed || !this.window || this.window.isDestroyed()) {
        this._cancelAnim();
        return;
      }
      const t = Math.min(1, (Date.now() - start) / PANEL_ANIM_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      this._animWidth = Math.round(from + (to - from) * eased);
      if (this._visible) this.relayout();
      if (t >= 1) {
        clearInterval(this._animTimer);
        this._animTimer = null;
        if (this._visible) this.relayout();
        if (done) done();
        this._animWidth = null;
      }
    }, PANEL_ANIM_STEP_MS);
  }

  /** 拖拽磁吸：raw 距半宽/最大/手机比例最窄 ≤RESIZE_SNAP_PX 时吸附 */
  _snapWidth(raw, windowWidth) {
    const half = Math.floor(windowWidth * 0.5);
    const max = Math.floor(windowWidth * PANEL_WIDTH_RATIO_MAX);
    for (const c of [half, max, this._phoneMinWidth()]) {
      if (Math.abs(raw - c) <= RESIZE_SNAP_PX) return c;
    }
    return raw;
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
    this._lastApprovalPending = list;
    this._sendToApproval('browser-panel:pending-actions', {
      panelId: this.session ? this.session.panelId : null,
      actions: list,
      // 接管横幅：用户接管时浮层要说明这些卡在排队、交还后自动执行
      control: this.getControl(),
    });
    // 条数变化会改变浮层高度 → 重新定位；为 0 时顺手隐藏
    if (this._visible) this.relayout();
    else if (this.approvalView && !this.approvalView.webContents.isDestroyed()) {
      this.approvalView.setVisible(false);
    }
    // 审批高亮：有待批动作时在面板页面里标出"要点哪里"（最早的待批优先），
    // 清空则移除标记。导航类动作没有元素目标，跳过。
    const target = list.find((a) => a && a.summary && typeof a.summary.selector === 'string' && a.summary.selector);
    this.setPendingHighlight(target ? target.summary.selector : null);
  }

  /**
   * 在面板页面里给待批动作的目标元素叠一个描边脉冲标记（主进程 CDP 注入，
   * 与 Agent 执行链共用同一 debugger 通道，第三方页面零特权姿态不变）。
   * 记下的 selector 在页面导航完成后自动重注入；失败静默（高亮是辅助反馈）。
   */
  async setPendingHighlight(selector) {
    const next = typeof selector === 'string' && selector ? selector : null;
    this._highlightSelector = next;
    await this._applyPendingHighlight();
  }

  async _applyPendingHighlight() {
    const wc = this.panelView && !this.panelView.webContents.isDestroyed() ? this.panelView.webContents : null;
    if (!wc) return;
    if (!this._highlightSelector) {
      // 清除：只动我们自己挂的节点，不碰页面
      try {
        if (wc.debugger.isAttached()) {
          await wc.debugger.sendCommand('Runtime.evaluate', {
            expression: "(function(){var n=document.getElementById('__kaypal_hl__');if(n)n.remove();return 1;})()",
          });
        }
      } catch (e) { /* ignore */ }
      return;
    }
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      const sel = JSON.stringify(this._highlightSelector);
      const expression = `(function(){
        try {
          var old = document.getElementById('__kaypal_hl__'); if (old) old.remove();
          var el = document.querySelector(${sel});
          if (!el) return false;
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          var box = document.createElement('div');
          box.id = '__kaypal_hl__';
          var st = document.createElement('style');
          st.textContent = '@keyframes kaypal-hl-pulse{0%,100%{box-shadow:0 0 0 4px rgba(114,46,209,.28)}50%{box-shadow:0 0 0 12px rgba(114,46,209,.06)}}';
          box.appendChild(st);
          var place = function(){
            if (!document.getElementById('__kaypal_hl__')) return;
            var r = el.getBoundingClientRect();
            var s = box.style;
            s.position='fixed'; s.left=(r.left-5)+'px'; s.top=(r.top-5)+'px';
            s.width=(r.width+10)+'px'; s.height=(r.height+10)+'px';
            s.border='2px solid #722ed1'; s.borderRadius='8px';
            s.zIndex='2147483000'; s.pointerEvents='none';
            s.animation='kaypal-hl-pulse 1.4s ease-in-out infinite';
            s.background='rgba(114,46,209,.06)';
          };
          box.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0';
          (document.body || document.documentElement).appendChild(box);
          place();
          window.addEventListener('scroll', place, true);
          window.addEventListener('resize', place, true);
          return true;
        } catch (e) { return false; }
      })()`;
      await wc.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true });
    } catch (e) {
      /* 高亮失败不干扰审批流程 */
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
      // TraeWork 控制权模型：'system'（默认，AI 直接执行）| 'user'（用户接管）
      control: this.getControl(),
      // 面板/Agent 活动日志（最新在前，控制条底部活动条消费）
      activity: this._activityLog.slice(-ACTIVITY_EXPOSE).reverse(),
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
    if (this._visible) this.relayout(); // 悬浮胶囊可见性跟随开关
    return mode;
  }

  // ---------- 布局 ----------

  /** 控制条总高：多 tab 时加 tab 条行（round15；单 tab 零干扰不变高） */
  _stripHeight() {
    const base = this._panelTabs.length > 1 ? STRIP_HEIGHT + TABBAR_HEIGHT : STRIP_HEIGHT;
    const extra =
      (this._stripExpanded ? this._stripExpandH : 0) +
      (this._activityLog.length ? ACTIVITY_ROW_HEIGHT : 0) +
      (this._activityExpanded ? this._activityExpandH : 0);
    return base + extra;
  }

  /**
   * 记录一条面板活动（打开/导航/批准/拒绝…），控制条底部活动条与顶部标签条
   * 都经 publicState.activity 消费。环形上限 ACTIVITY_CAP；有记录时控制条
   * 视图加高一行（ACTIVITY_ROW_HEIGHT），清空后复原。
   */
  /**
   * @param {boolean} [silent] 内部操作（open/hide/nav/tab…）本来就要广播状态，
   *   传 true 只 push + 重排视图高度，不再次广播避免重复推送。
   */
  recordActivity(type, text, silent) {
    const entry = { t: Date.now(), type, text: String(text || '').slice(0, 120) };
    this._activityLog.push(entry);
    if (this._activityLog.length > ACTIVITY_CAP) this._activityLog.shift();
    if (this._visible) this.relayout();
    if (!silent) this._emitState();
  }

  clearActivity() {
    if (!this._activityLog.length) return;
    this._activityLog = [];
    this._activityExpanded = false;
    this._activityExpandH = 0;
    if (this._visible) this.relayout();
    this._emitState();
  }

  /**
   * 活动日志「展开全部」：控制条是独立 WebContentsView，展开区超出视图高度
   * 会被直接裁掉（真机实证：点了活动行毫无反应）。所以展开态必须由控制条
   * 上报高度、主进程据此给视图加高——与地址栏快捷行展开同一套机制。
   * @param {boolean} on
   * @param {number} [height] 展开区需要的高度（条数*行高，封顶 170）
   */
  setActivityExpanded(on, height) {
    const next = !!on && this._activityLog.length > 0;
    if (next && !this._visible) return this._stripHeight();
    let h = this._activityExpandH;
    if (next) {
      h = Math.max(30, Math.min(ACTIVITY_FULL_MAX_HEIGHT, Math.floor(Number(height) || 60)));
    }
    // 只改高度也要重排：列表从 1 条变 8 条时视图必须跟着长（早退=展开区被裁）
    const changed = next !== this._activityExpanded || h !== this._activityExpandH;
    this._activityExpanded = next;
    this._activityExpandH = h;
    if (changed) {
      this.relayout();
      this._emitState();
    }
    return this._stripHeight();
  }

  relayout() {
    if (!this.window || this.window.isDestroyed() || !this._visible) return;
    const { width, height } = this.window.getContentBounds();
    // 窗口收窄/重建时重新夹取面板宽度（上限 60%），保证不遮挡 3010 主内容
    this._currentWidth = this._clampWidth(this.width());
    // 动画期用补间渲染宽（不夹最小值——滑入起点就是 0）；静止期 = 逻辑宽
    const panelW = this._animWidth != null
      ? Math.max(0, Math.min(Math.floor(this._animWidth), this._currentWidth))
      : this._currentWidth;
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
      // 置顶：业务视图在 switchTo 时被重新 addChildView 到最上层，会盖住
      // 与其右缘重叠的沟槽（面板越宽重叠越必然）——沟槽被盖 = 拖不回面板。
      // Electron 对已存在子视图重复 addChildView 即移到最上层，幂等。
      try {
        this.window.contentView.addChildView(this.gutterView);
      } catch { /* 视图竞态：下次 relayout 自愈 */ }
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
    if (this.pillView && !this.pillView.webContents.isDestroyed()) {
      // TRAE 对齐：AI 控制权胶囊——面板底部居中；审批卡出现时上移避让
      const approvalH = this._approvalPendingCount > 0 ? this._approvalHeight() + 8 : 0;
      const pillW = Math.min(PILL_WIDTH, Math.max(0, panelW - 24));
      const bottom = contentY + contentH - APPROVAL_MARGIN - approvalH;
      this.pillView.setBounds({
        x: x + Math.round((panelW - pillW) / 2),
        y: Math.max(contentY + stripH, bottom - PILL_HEIGHT),
        width: pillW,
        height: PILL_HEIGHT,
      });
      this.pillView.setVisible(this._visible && this.getAgentMode() === 'on');
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
    // TRAE 对齐：悬浮胶囊订阅精简状态流（可见性/agentMode/control）
    this._sendToPill('browser-pill:state', {
      visible: this._visible,
      agentMode: state.agentMode,
      control: state.control,
    });
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

  /** TRAE 对齐：悬浮胶囊 sender 校验（只有浮层自己能调接管/交还/停用） */
  isPillSender(sender) {
    return !!(
      sender &&
      this.pillView &&
      !this.pillView.webContents.isDestroyed() &&
      this.pillView.webContents.id === sender.id
    );
  }

  _sendToPill(channel, payload) {
    if (this.pillView && !this.pillView.webContents.isDestroyed()) {
      try {
        this.pillView.webContents.send(channel, payload);
      } catch {
        /* 浮层未就绪时忽略 */
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
    this._cancelAnim();
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
    if (this.pillView) {
      try {
        this.window && !this.window.isDestroyed() && this.window.contentView.removeChildView(this.pillView);
        this.pillView.webContents.close();
      } catch {
        /* ignore */
      }
    }
    this.pillView = null;
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
  matchPanelPlatform,
  sanitizePanelUserAgent,
  PANEL_MIN_WIDTH,
  PANEL_PHONE_WIDTH_MAX,
  PHONE_VIEWPORT_RATIO,
  PANEL_DEFAULT_WIDTH,
  PANEL_GUTTER,
  STRIP_HEIGHT,
};
