'use strict';
/**
 * browser-panel-broker.js — 3010 右侧浏览器面板的桌面侧会话/策略/事件中枢（阶段 1 最小契约版）
 *
 * 职责（对齐工作流文档 §3.2）：
 *  - panelId -> webContents -> browserSession 三方映射（同页控制的唯一事实源）；
 *  - capability token 鉴权（创建时签发、错 token/错 owner/错租户 fail-closed）；
 *  - 统一操作事件流：observe.started / action.requested / action.approved /
 *    action.completed / blocked（阶段 4 接 3011 证据链）；
 *  - CDP 命令白名单（只放行受控域；对上层不暴露裸 CDP）。
 *
 * 不依赖 electron（构造注入 viewFactory / 运行时注入 webContents），
 * 因此 browser-panel-broker.spec.js 可以纯 node 跑契约与负向用例；
 * 真实同页控制验证由 scripts/browser-panel-smoke.mjs 在 Electron 内驱动本模块。
 */

const crypto = require('node:crypto');

const CDP_WHITELIST = new Set([
  // 观察类
  'Page.getFrameTree',
  'Page.captureScreenshot',
  'Runtime.evaluate',
  'DOM.getDocument',
  'DOM.getOuterHTML',
  // 动作类（仍受审批闸门约束）
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  // 2026-09-03（阶段 5）：导航——走 CDP 而非 wc.loadURL，保证"用户看到的
  // 那一次导航"与 Agent 触发的是同一条命令，且受同一审批闸门与事件流约束。
  'Page.navigate',
  // 2026-09-03（阶段 7 round11）tabs：主进程伪 method——不走 CDP debugger，
  // 经 tabsHandler 回调 manager.tabsOperation（台账原生多 tab 管理）。归入
  // MUTATION（new/switch/close 都改变用户看到的页面），审批闸门与事件流全复用。
  'Panel.tabs',
]);

const READONLY_METHODS = new Set([
  'Page.getFrameTree',
  'Page.captureScreenshot',
  'Runtime.evaluate',
  'DOM.getDocument',
  'DOM.getOuterHTML',
]);

/**
 * 2026-09-03（阶段 5）：占位身份——desktop 主进程不知道"当前登录的是谁"
 * （登录态在 3010/3011 侧），面板会话的 ownerId/tenantId 建成时只能是占位值。
 * 在此身份下，面板视为「待绑定」：第一个带完整 actor 的访问者把它绑走，
 * 之后只认这一个 actor（防跨会话漂移）。真实身份一旦注入则按真实身份比对。
 */
const PLACEHOLDER_OWNER_ID = 'local-desktop';
const PLACEHOLDER_TENANT_ID = 'local-tenant';

/**
 * 2026-09-03（阶段 3）：证据文本 URL 脱敏——事件流/日志不得带查询串里的
 * 凭据类参数（token/code/key/secret 等常见命名），路径与域名保留可读性。
 */
const SENSITIVE_QUERY_KEYS = /(^|[_.-])(token|access[_-]?token|auth|apikey|api[_-]key|secret|password|passwd|pwd|code|sid|session[_-]?id)(?:[_.-]|$)/i;

function redactUrlForEvidence(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  try {
    const url = new URL(rawUrl);
    const redacted = [];
    for (const [key] of url.searchParams.entries()) {
      if (SENSITIVE_QUERY_KEYS.test(key)) redacted.push(`${key}=***`);
    }
    for (const pair of redacted) {
      const [key] = pair.split('=');
      url.searchParams.set(key, '***');
    }
    return url.toString();
  } catch {
    return '[unparseable-url]';
  }
}

const MUTATION_METHODS = new Set([
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Page.navigate',
  // 阶段 7 round11：tabs 三种 operation 都改变用户所见的页面 → 一律按写动作审批
  'Panel.tabs',
]);

/**
 * 2026-09-03（阶段 5）：导航 origin 允许表。
 * - 空白名单（默认）＝**任何** Agent 发起的导航都要走确认单；
 * - 命中白名单的 origin 视为低风险，可免确认（但仍进 MUTATION 事件流留痕）。
 * 配置：构造注入 `allowedOrigins`（数组或逗号分隔字符串）。
 * 注意：白名单只跳过"确认单"，不跳过协议校验——非 http(s) 一律拒绝。
 */
function normalizeOrigins(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  return new Set(
    list
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
      .map((v) => v.replace(/\/+$/, '')),
  );
}

/**
 * 导航目标校验（fail-closed）。非 http(s)、或 origin 不在允许表 → 抛错。
 * @returns {{url: string, origin: string}}
 */
function assertNavigable(url, allowedOrigins) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    throw new Error('导航目标不是合法 URL（拒绝执行）');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`导航协议只允许 http/https，收到：${parsed.protocol}`);
  }
  const origin = parsed.origin.toLowerCase();
  if (allowedOrigins && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
    throw new Error(`导航目标 origin 不在允许表：${origin}`);
  }
  return { url: parsed.toString(), origin };
}

/**
 * 会话契约（工作流文档 §3.3 / 阶段 3 的超集字段，阶段 1 先立形状）
 * @typedef {object} BrowserPanelSession
 * @property {string} panelId
 * @property {string} sessionId
 * @property {string} ownerId
 * @property {string} tenantId
 * @property {string} [accountId]
 * @property {string} platform
 * @property {string} partition
 * @property {string} [currentUrl]
 * @property {string} status
 */

class BrowserPanelBroker {
  /**
   * @param {{
   *   webContentsResolver?: (panelId: string) => { id: number, url: string, debugger: { attach: Function, isAttached: Function, sendCommand: Function, detach: Function }, on: Function, setWindowOpenHandler: Function } | null,
   *   now?: () => number,
   *   tokenTtlMs?: number,
   *   tabsHandler?: (operation: string, index: number|undefined) => { tabs: number, activeIndex: number, url: string|null },
   * }} [deps]
   */
  constructor(deps = {}) {
    /** @type {Map<string, { session: BrowserPanelSession, tokens: Map<string, {expiresAt: number, ownerId: string, tenantId: string} }>} */
    this._panels = new Map();
    /** @type {Map<string, Array<object>>} */
    this._events = new Map();
    /** @type {Map<string, string>} 待审批动作 -> panelId */
    this._pendingApprovals = new Map();
    // 阶段 7（开发推进）：一次批准 = 一次逻辑动作。第一步 CDP（mousePressed /
    // keyDown）消耗确认单后记录配对信息，配对的续作（mouseReleased / keyUp /
    // insertText）放行一次——同面板、坐标 ≤4px（鼠标）/ 键位一致（按键）、
    // 10s 内、一次性。否则一次点击/按键要弹两张审批卡片，用户会疯。
    // fail-closed：配对一次性（用即焚）、不匹配烧单、超时烧单。
    this._clickPairs = new Map();
    this._resolveWebContents = deps.webContentsResolver || (() => null);
    this._now = deps.now || Date.now;
    this._tokenTtlMs = deps.tokenTtlMs || 15 * 60 * 1000;
    /** 导航 origin 允许表（空白＝全部需确认单） */
    this._allowedOrigins = normalizeOrigins(deps.allowedOrigins);
    // 阶段 7 round11：tabs 主进程实现回调（wiring 注入 manager.tabsOperation）。
    // 未注入 = Panel.tabs fail-closed 拒绝（不静默降级为 no-op）。
    this._tabsHandler = typeof deps.tabsHandler === 'function' ? deps.tabsHandler : null;
  }

  /** 当前导航 origin 允许表（只读副本，供上层展示/测试） */
  allowedOrigins() {
    return [...this._allowedOrigins];
  }

  /** 创建面板会话；返回 capability token（只此一次交付给面板所有者） */
  createPanel(input) {
    const {
      panelId,
      sessionId,
      ownerId,
      tenantId,
      accountId,
      platform = 'general-web',
      partition,
    } = input || {};
    for (const [field, value] of Object.entries({
      panelId,
      sessionId,
      ownerId,
      tenantId,
    })) {
      if (!value || typeof value !== 'string') {
        throw new Error(`createPanel 缺少必填字段：${field}`);
      }
    }
    if (this._panels.has(panelId)) {
      throw new Error(`panelId 已存在：${panelId}`);
    }
    const resolvedPartition = partition || `persist:kaypal-browser-${ownerId}`;
    if (!resolvedPartition.startsWith('persist:')) {
      throw new Error(`partition 必须是持久化分区（persist: 前缀）：${resolvedPartition}`);
    }
    const token = crypto.randomBytes(24).toString('hex');
    const panel = {
      session: {
        panelId,
        sessionId,
        ownerId,
        tenantId,
        accountId,
        platform,
        partition: resolvedPartition,
        currentUrl: undefined,
        status: 'starting',
      },
      tokens: new Map([[token, {
        expiresAt: this._now() + this._tokenTtlMs,
        ownerId,
        tenantId,
      }]]),
    };
    this._panels.set(panelId, panel);
    this._emit(panelId, 'panel.created', { sessionId, partition: resolvedPartition });
    return { panelId, sessionId, capabilityToken: token };
  }

  /** 面板关闭只标记隐藏，不默认销毁会话（文档 §3.1） */
  hidePanel(panelId, capabilityToken) {
    const session = this._authorize(panelId, capabilityToken).session;
    session.status = 'stopped';
    this._emit(panelId, 'panel.hidden', {});
  }

  destroyPanel(panelId, capabilityToken) {
    const panel = this._panels.get(panelId);
    if (!panel) return;
    if (panel.tokens.has(capabilityToken)) {
      this._panels.delete(panelId);
      this._events.delete(panelId);
      for (const [actionId, owner] of this._pendingApprovals.entries()) {
        if (owner === panelId) this._pendingApprovals.delete(actionId);
      }
      this._emit(panelId, 'panel.destroyed', {});
    }
  }

  /**
   * 鉴权 + 目标解析：返回 panelId/sessionId/webContentsId 三方绑定。
   * 这一步是"同页控制"的事实源：任何动作前必须拿到同一 webContentsId。
   * 兼容 Electron webContents（getURL()）与测试替身（.url 字段）。
   */
  resolveTarget(panelId, capabilityToken) {
    const { session } = this._authorize(panelId, capabilityToken);
    const wc = this._resolveWebContents(panelId);
    if (!wc || typeof wc.id !== 'number') {
      session.status = 'blocked';
      this._emit(panelId, 'blocked', { reason: 'web-content-target-missing' });
      throw new Error('浏览器面板页面目标丢失（needs-human），拒绝执行');
    }
    const wcUrl =
      typeof wc.getURL === 'function' ? wc.getURL() : wc.url;
    session.currentUrl = wcUrl || session.currentUrl;
    return {
      panelId,
      sessionId: session.sessionId,
      webContentsId: wc.id,
      url: session.currentUrl,
    };
  }

  markStatus(panelId, capabilityToken, status) {
    const { session } = this._authorize(panelId, capabilityToken);
    session.status = status;
    this._emit(panelId, `panel.status.${status}`, {});
  }

  /**
   * CDP 通道：白名单 + 动作审批闸门 + 事件留痕。
   * @returns {Promise<{ result: object, target: object }>}
   */
  async sendCDP(panelId, capabilityToken, method, params = {}, opts = {}) {
    const { session } = this._authorize(panelId, capabilityToken);
    const target = this.resolveTarget(panelId, capabilityToken);
    const wc = this._resolveWebContents(panelId);

    if (!CDP_WHITELIST.has(method)) {
      this._emit(panelId, 'blocked', { reason: 'cdp-method-not-allowed', method, ...this._redactTarget(target) });
      throw new Error(`CDP 方法不在白名单：${method}`);
    }
    // 2026-09-03（阶段 5）：导航目标单独校验——非 http(s) / 不在 origin 允许表
    // 一律拒绝，且**先于**审批闸门（不合规的导航连确认单都不该签）。
    if (method === 'Page.navigate') {
      let navigable;
      try {
        navigable = assertNavigable(params && params.url, this._allowedOrigins);
      } catch (error) {
        this._emit(panelId, 'blocked', {
          reason: 'navigate-target-denied',
          method,
          message: error.message,
          ...this._redactTarget(target),
        });
        throw error;
      }
      params = { ...params, url: navigable.url };
    }
    const isMutation = MUTATION_METHODS.has(method);
    if (isMutation) {
      // 已被用户拒绝的单：明确报"已拒绝"，别混进"需要审批"——否则用户看到一个
      // 自己已经点过拒绝的动作还在提示"待审批"，会以为 UI 坏了。
      if (opts.approvedActionId && this._isRejected(opts.approvedActionId, panelId)) {
        this._emit(panelId, 'blocked', {
          reason: 'action-rejected',
          method,
          actionId: opts.approvedActionId,
          ...this._redactTarget(target),
        });
        throw new Error(`该动作已被用户拒绝（确认单 ${opts.approvedActionId}）：${method}`);
      }
      let approved = opts.approvedActionId && this._consumeApproval(opts.approvedActionId, panelId, method, target, params);
      // 一次批准 = 一次逻辑动作：确认单已被第一步 CDP 消耗时，配对的续作
      // （click 的 mouseReleased / 输入的 Input.insertText / 按键的 keyUp）
      // 走配对通道（一次性、同面板、坐标 ≤4px / 键位一致、10s 内）
      let pairAllowed = false;
      const isPairableFollowUp =
        (method === 'Input.dispatchMouseEvent' &&
          params && params.type === 'mouseReleased') ||
        method === 'Input.insertText' ||
        (method === 'Input.dispatchKeyEvent' &&
          params && params.type === 'keyUp');
      if (!approved && opts.approvedActionId && isPairableFollowUp) {
        pairAllowed = this._consumeClickPair(opts.approvedActionId, panelId, params);
      }
      if (!approved && !pairAllowed && !READONLY_AUTO_APPROVE_MUTATIONS) {
        // 写动作必须先经 requestAction -> approve 拿 actionId；未带/已消耗一律拒绝
        this._emit(panelId, 'blocked', { reason: 'approval-required', method, ...this._redactTarget(target) });
        throw new Error(`动作需要审批（先 requestAction 再携带 approvedActionId）：${method}`);
      }
    }
    const kind = isMutation ? 'action' : 'observe';
    this._emit(panelId, `${kind}.started`, { method, ...this._redactTarget(target) });
    try {
      // 阶段 7 round11：tabs 主进程伪 method——不走 CDP debugger（broker 的
      // debugger 是 target 级 session，Target.createTarget 等 browser 级命令
      // 根本发不出去），改经 wiring 注入的 tabsHandler 回调 manager 原生台账。
      // 审批单已在上方 mutation 闸门消耗（语义与 CDP 命令一致：单已耗、动作
      // 失败 = Agent 收到错误，重试需重新签单）。
      if (method === 'Panel.tabs') {
        const operation = params && params.operation;
        if (operation !== 'new' && operation !== 'switch' && operation !== 'close') {
          throw new Error(
            `Panel.tabs 参数非法：operation 必须是 new/switch/close，收到 ${String(operation)}`,
          );
        }
        if (!this._tabsHandler) {
          throw new Error('面板 tab 操作未接线（tabsHandler 未注入，fail-closed）');
        }
        const index = params && params.index != null ? Number(params.index) : undefined;
        const outcome = await this._tabsHandler(operation, index);
        // switch/new 后 active tab 已变：binding 必须重新解析——webContentsId/url
        // 拿当前 active 的（旧 target 是切前的，直接回传会制造自相矛盾证据）。
        const freshTarget = this.resolveTarget(panelId, capabilityToken);
        const afterUrl = freshTarget ? freshTarget.url : target.url;
        this._emit(panelId, `${kind}.completed`, {
          method,
          ...this._redactTarget(freshTarget || target),
          afterUrl: redactUrlForEvidence(afterUrl),
        });
        return { result: outcome, target: freshTarget || target };
      }
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3');
      }
      const result = await wc.debugger.sendCommand(method, params);
      // 一次批准 = 一次逻辑点击：mousePressed 执行成功后登记配对（10s 内有效）
      if (
        opts.approvedActionId &&
        method === 'Input.dispatchMouseEvent' &&
        params && params.type === 'mousePressed'
      ) {
        this._clickPairs.set(opts.approvedActionId, {
          panelId,
          x: Number(params.x) || 0,
          y: Number(params.y) || 0,
          expiresAt: this._now() + 10_000,
        });
      }
      // 一次批准 = 一次逻辑按键：keyDown 执行成功后登记配对（10s 内有效）。
      // 键位必须是非空字符串才登记——空键位不给配对（fail-closed）。
      if (
        opts.approvedActionId &&
        method === 'Input.dispatchKeyEvent' &&
        params && params.type === 'keyDown' &&
        typeof params.key === 'string' && params.key.length > 0
      ) {
        this._clickPairs.set(opts.approvedActionId, {
          panelId,
          kind: 'key',
          key: params.key,
          expiresAt: this._now() + 10_000,
        });
      }
      const afterWcUrl =
        typeof wc.getURL === 'function' ? wc.getURL() : wc.url;
      this._emit(panelId, `${kind}.completed`, {
        method,
        ...this._redactTarget(target),
        ...(isMutation ? { afterUrl: redactUrlForEvidence(afterWcUrl) } : {}),
      });
      return { result, target };
    } catch (error) {
      this._emit(panelId, 'blocked', {
        reason: 'cdp-command-failed',
        method,
        message: error && error.message ? String(error.message).slice(0, 200) : String(error),
        ...this._redactTarget(target),
      });
      throw error;
    }
  }

  /** 写动作申请：生成绑定 target 的确认单（阶段 4 接 UI 审批后由用户点批） */
  requestAction(panelId, capabilityToken, method, summary) {
    const { session } = this._authorize(panelId, capabilityToken);
    const target = this.resolveTarget(panelId, capabilityToken);
    if (!MUTATION_METHODS.has(method)) {
      throw new Error(`只有写动作需要确认单：${method}`);
    }
    const actionId = crypto.randomBytes(12).toString('hex');
    this._pendingApprovals.set(actionId, panelId);
    /** @type {Map<string, object>} */
    this._pendingApprovalsDetail = this._pendingApprovalsDetail || new Map();
    this._pendingApprovalsDetail.set(actionId, {
      panelId,
      method,
      // 2026-09-03 修：summary 必须挂在 detail 顶层——listPendingActions /
      // actionState / 审批 UI 读的都是 detail.summary。原来只塞进 binding 里，
      // 导致摘要永远是 null（审批卡片会显示空白，后端也拿不到动作描述）。
      summary: summary || null,
      binding: { sessionId: session.sessionId, ...target, summary: summary || null },
      createdAt: this._now(),
    });
    this._emit(panelId, 'action.requested', { actionId, method, ...this._redactTarget(target) });
    return { actionId, binding: target };
  }

  /**
   * 批准确认单（阶段 1 由 smoke 脚本代表用户调用；阶段 4 起走真实用户审批 UI）。
   * 批准人必须与会话 owner 一致。
   */
  approveAction(actionId, capabilityToken, approverToken, context = {}) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    if (!detail) throw new Error('确认单不存在或已过期');
    const panel = this._authorize(detail.panelId, capabilityToken);
    const approver = panel.tokens.get(approverToken);
    if (!approver || approver.ownerId !== panel.session.ownerId) {
      this._emit(detail.panelId, 'blocked', { reason: 'approver-mismatch', actionId });
      throw new Error('批准人必须是面板所有者');
    }
    detail.approved = true;
    detail.approvedAt = this._now();
    detail.approvalContext = { ...(context || {}), channel: (context && context.channel) || 'owner' };
    this._emit(detail.panelId, 'action.approved', { actionId, method: detail.method });
  }

  /**
   * **拒绝**确认单（阶段 6 审批 UI 的"拒绝"按钮）。
   *
   * 与批准对称：拒绝人也必须是面板 owner（Agent 无法靠这条路把别人的单搅黄，
   * 也无法自我批准）。拒绝是**终态**——拒绝后不可再批准、执行闸门直接拦掉。
   * 没有拒绝能力的话，用户不点的卡片会一直堆在审批浮层里。
   */
  rejectAction(actionId, capabilityToken, rejecterToken, context = {}) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    // 注意：确认单一旦被执行消费即从表里删除（_consumeApproval），所以"已执行"
    // 在这里表现为"不存在" —— 事后反悔拒绝是不可能的，这正是我们要的语义。
    if (!detail) throw new Error('确认单不存在或已过期');
    const panel = this._authorize(detail.panelId, capabilityToken);
    const rejecter = panel.tokens.get(rejecterToken);
    if (!rejecter || rejecter.ownerId !== panel.session.ownerId) {
      this._emit(detail.panelId, 'blocked', { reason: 'rejecter-mismatch', actionId });
      throw new Error('拒绝人必须是面板所有者');
    }
    detail.rejected = true;
    detail.rejectedAt = this._now();
    detail.rejectionContext = { ...(context || {}), channel: (context && context.channel) || 'owner-ui' };
    this._emit(detail.panelId, 'action.rejected', { actionId, method: detail.method });
    return { actionId, panelId: detail.panelId, rejected: true };
  }

  /**
   * 待批确认单列表（阶段 4 审批 UI 用）。只暴露描述信息，**不含 token**。
   * @returns {Array<{actionId: string, method: string, summary: object|null, createdAt: number, binding: object}>}
   */
  listPendingActions(panelId, capabilityToken) {
    this._authorize(panelId, capabilityToken);
    const details = this._pendingApprovalsDetail || new Map();
    const out = [];
    for (const [actionId, detail] of details.entries()) {
      if (detail.panelId !== panelId) continue;
      // 已批准 / 已拒绝 / 已消费 都不再属于"待批"
      if (detail.approved || detail.rejected || detail.consumed) continue;
      out.push({
        actionId,
        method: detail.method,
        summary: detail.summary || null,
        createdAt: detail.createdAt,
        binding: detail.binding,
      });
    }
    return out;
  }

  /**
   * 确认单状态查询（阶段 5 后端接入缝）。
   * 后端驱动写动作前必须先看这里：只有 `approved` 才允许带单执行，
   * `pending` = 用户还没点头，`none` = 不存在/已消费（一次性）。
   * 注意：查询**不消费**确认单（消费仍由 sendCDP 的审批闸门完成）。
   */
  actionState(actionId, capabilityToken) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    if (!detail) {
      return { actionId, state: 'none', panelId: null, method: null, approvedAt: null };
    }
    this._authorize(detail.panelId, capabilityToken);
    const target = this.resolveTarget(detail.panelId, capabilityToken);
    let state = 'pending';
    if (detail.consumed) state = 'none';
    else if (detail.rejected) state = 'rejected';
    else if (detail.approved) state = 'approved';
    return {
      actionId,
      state,
      panelId: detail.panelId,
      method: detail.method,
      approvedAt: detail.approvedAt ?? null,
      rejectedAt: detail.rejectedAt ?? null,
      binding: {
        sessionId: target.sessionId,
        webContentsId: target.webContentsId,
        url: target.url,
      },
      summary: detail.summary || null,
    };
  }

  /** 审批 UI 落审计上下文（谁点的批准、来自哪个界面），只增不改已批状态 */
  noteActionApprovalContext(actionId, context = {}) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    if (!detail) return false;
    detail.approvalContext = {
      ...(detail.approvalContext || {}),
      ...context,
      notedAt: this._now(),
    };
    return true;
  }

  listEvents(panelId, capabilityToken) {
    const { session } = this._authorize(panelId, capabilityToken);
    void session;
    return (this._events.get(panelId) || []).map((event) => ({ ...event }));
  }

  /**
   * 2026-09-03（阶段 5）**首次绑定**语义：
   * desktop 主进程拿不到"当前登录用户"（登录态在 3010/3011 侧），面板会话建成时
   * ownerId/tenantId 只能是占位值 `local-desktop`/`local-tenant`。要求调用方
   * actor 与占位值相等是不现实的——那会让 3011 的每一次调用都被 403。
   *
   * 真实的安全不变量其实是"**一个面板只能被一个身份驱动**"（防跨会话漂移），
   * 而不是"面板预先知道租户"。因此：
   *   - 身份为占位值 → 面板待绑定，第一个带完整 actor 的访问者把它绑走；
   *   - 已有绑定或真实身份 → actor 必须**完全一致**（ownerId+tenantId 全等）；
   *   - 绑定关系随会话销毁而释放，且全程进事件流留痕（审计可查）。
   */
  assertActor(panelId, capabilityToken, actor) {
    const { session } = this._authorize(panelId, capabilityToken);
    const ownerId = actor && actor.ownerId;
    const tenantId = actor && actor.tenantId;
    if (!ownerId || !tenantId) {
      this._emit(panelId, 'blocked', { reason: 'actor-missing-identity' });
      throw new Error('actor 必须携带 ownerId/tenantId（fail-closed）');
    }

    const isPlaceholder =
      session.ownerId === PLACEHOLDER_OWNER_ID && session.tenantId === PLACEHOLDER_TENANT_ID;
    const bound = session.boundActor || null;

    if (bound) {
      if (bound.ownerId !== ownerId || bound.tenantId !== tenantId) {
        this._emit(panelId, 'blocked', {
          reason: 'actor-tenant-mismatch',
          sessionId: session.sessionId,
          boundOwnerId: bound.ownerId,
          actorOwnerId: ownerId,
        });
        throw new Error('面板已绑定到其他身份，拒绝访问（防跨会话漂移）');
      }
      return { sessionId: session.sessionId, panelId };
    }

    if (!isPlaceholder) {
      if (ownerId !== session.ownerId || tenantId !== session.tenantId) {
        this._emit(panelId, 'blocked', {
          reason: 'actor-tenant-mismatch',
          sessionId: session.sessionId,
        });
        throw new Error('actor 与面板会话 owner/tenant 不一致，拒绝访问');
      }
    }

    // 首次绑定：占位身份与真实身份都在此落定绑定关系
    session.boundActor = { ownerId, tenantId, boundAt: this._now() };
    this._emit(panelId, 'actor.bound', {
      sessionId: session.sessionId,
      ownerId,
      tenantId,
      fromPlaceholder: isPlaceholder,
    });
    return { sessionId: session.sessionId, panelId };
  }

  /** 当前绑定身份（未绑定返回 null） */
  boundActor(panelId, capabilityToken) {
    const { session } = this._authorize(panelId, capabilityToken);
    return session.boundActor ? { ...session.boundActor } : null;
  }

  /**
   * 2026-09-03（阶段 3）：Broker 重启语义 = 实例已换新——旧实例发出的所有
   * actionId/句柄在新实例里天然不存在，一切旧动作失效（wiring 层丢弃旧 token
   * 并重建会话即此语义的显式实现）。
   */
  hasPendingHandle(handleId) {
    return (
      this._pendingApprovalsDetail?.has(handleId) === true ||
      Array.from(this._panels.values()).some((panel) => panel.tokens.has(handleId))
    );
  }

  // ---- 内部 ----

  /** 确认单是否已被用户拒绝（终态，不可翻案） */
  _isRejected(actionId, panelId) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    return !!(detail && detail.panelId === panelId && detail.rejected && !detail.consumed);
  }

  _consumeApproval(actionId, panelId, method, target, params) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    if (!detail || detail.panelId !== panelId || !detail.approved) return false;
    // 一次批准 = 一次逻辑动作：输入型确认单（method=Input.insertText）覆盖
    // 聚焦点击 + 插入文本两步 CDP——只允许**聚焦半步**（mousePressed）消耗，
    // mouseReleased 等 dispatchMouseEvent 续作不许借输入单放行（fail-closed）。
    // 其余 method 仍严格相等。
    const isFocusHalfStep =
      method === 'Input.dispatchMouseEvent' &&
      !!(params && params.type === 'mousePressed');
    const methodMatches =
      detail.method === method ||
      (detail.method === 'Input.insertText' && isFocusHalfStep);
    if (!methodMatches) return false;
    if (detail.binding.webContentsId !== target.webContentsId) {
      // 页面目标变了，确认单作废（防换页后放行旧动作）
      return false;
    }
    this._pendingApprovals.delete(actionId);
    this._pendingApprovalsDetail.delete(actionId);
    return true;
  }

  /**
   * 配对通道：mousePressed 消耗确认单后，配对的 mouseReleased 由此放行一次。
   * fail-closed：先烧单再校验（一次性）、面板不匹配/超时/坐标偏移 >4px 一律拒绝。
   */
  /**
   * 配对通道：第一步 CDP 消耗确认单后，配对的续作由此放行一次。
   * fail-closed：先烧单再校验（一次性）、面板不匹配/超时一律拒绝；
   * 坐标校验只对**带数值坐标**的续作生效（click 的 mouseReleased 必须带，
   * 且与登记坐标偏移 ≤4px；输入的 Input.insertText 无坐标，免校验）。
   * 按键配对（kind='key'）：只认 keyUp 续作，且键位必须与 keyDown 一致——
   * insertText / mouseReleased 没有 key 字段天然不匹配；反向 keyUp 也不许
   * 借鼠标/输入配对放行（各自通道互不串门，fail-closed）。
   */
  _consumeClickPair(actionId, panelId, params) {
    const pair = this._clickPairs && this._clickPairs.get(actionId);
    if (!pair) return false;
    this._clickPairs.delete(actionId);
    if (pair.panelId !== panelId) return false;
    if (pair.expiresAt < this._now()) return false;
    const type = params && params.type;
    if (type === 'keyUp') {
      // 按键续作：只认按键配对 + 键位一致
      return pair.kind === 'key' && params.key === pair.key;
    }
    // 鼠标/输入续作不许借按键配对放行
    if (pair.kind === 'key') return false;
    const px = Number(params && params.x);
    const py = Number(params && params.y);
    const hasCoords = Number.isFinite(px) && Number.isFinite(py);
    // click 的续作（mouseReleased）必须带坐标；不带 = fail-closed 拒绝
    if (!hasCoords && params && params.type === 'mouseReleased') return false;
    if (hasCoords) {
      const dx = Math.abs(px - pair.x);
      const dy = Math.abs(py - pair.y);
      if (dx > 4 || dy > 4) return false;
    }
    return true;
  }

  _authorize(panelId, capabilityToken) {
    const panel = this._panels.get(panelId);
    if (!panel) throw new Error('面板不存在');
    const token = panel.tokens.get(capabilityToken);
    if (!token) {
      this._emit(panelId, 'blocked', { reason: 'invalid-token' });
      throw new Error('capability token 无效（fail-closed）');
    }
    if (token.expiresAt < this._now()) {
      panel.tokens.delete(capabilityToken);
      this._emit(panelId, 'blocked', { reason: 'token-expired' });
      throw new Error('capability token 已过期（fail-closed）');
    }
    return panel;
  }

  _emit(panelId, type, payload) {
    const list = this._events.get(panelId) || [];
    list.push({
      seq: list.length + 1,
      at: this._now(),
      type,
      ...payload,
    });
    this._events.set(panelId, list);
  }

  /** 事件流里的 target：URL 一律脱敏（凭据类 query 参数 → ***） */
  _redactTarget(target) {
    return { ...target, url: redactUrlForEvidence(target.url) };
  }
}

// 阶段 1 smoke 开关：真实产品路径必须保持 false（写动作走审批）。
const READONLY_AUTO_APPROVE_MUTATIONS = false;

module.exports = {
  BrowserPanelBroker,
  CDP_WHITELIST,
  MUTATION_METHODS,
  READONLY_METHODS,
  redactUrlForEvidence,
};
