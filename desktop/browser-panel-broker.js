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
]);

const READONLY_METHODS = new Set([
  'Page.getFrameTree',
  'Page.captureScreenshot',
  'Runtime.evaluate',
  'DOM.getDocument',
  'DOM.getOuterHTML',
]);

const MUTATION_METHODS = new Set([
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
]);

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
   * }} [deps]
   */
  constructor(deps = {}) {
    /** @type {Map<string, { session: BrowserPanelSession, tokens: Map<string, {expiresAt: number, ownerId: string, tenantId: string} }>} */
    this._panels = new Map();
    /** @type {Map<string, Array<object>>} */
    this._events = new Map();
    /** @type {Map<string, string>} 待审批动作 -> panelId */
    this._pendingApprovals = new Map();
    this._resolveWebContents = deps.webContentsResolver || (() => null);
    this._now = deps.now || Date.now;
    this._tokenTtlMs = deps.tokenTtlMs || 15 * 60 * 1000;
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
      this._emit(panelId, 'blocked', { reason: 'cdp-method-not-allowed', method, ...target });
      throw new Error(`CDP 方法不在白名单：${method}`);
    }
    const isMutation = MUTATION_METHODS.has(method);
    if (isMutation) {
      const approved = opts.approvedActionId && this._consumeApproval(opts.approvedActionId, panelId, method, target);
      if (!approved && !READONLY_AUTO_APPROVE_MUTATIONS) {
        // 写动作必须先经 requestAction -> approve 拿 actionId；未带/已消耗一律拒绝
        this._emit(panelId, 'blocked', { reason: 'approval-required', method, ...target });
        throw new Error(`动作需要审批（先 requestAction 再携带 approvedActionId）：${method}`);
      }
    }
    const kind = isMutation ? 'action' : 'observe';
    this._emit(panelId, `${kind}.started`, { method, ...target });
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3');
      }
      const result = await wc.debugger.sendCommand(method, params);
      this._emit(panelId, `${kind}.completed`, {
        method,
        ...target,
        ...(isMutation ? { afterUrl: wc.url } : {}),
      });
      return { result, target };
    } catch (error) {
      this._emit(panelId, 'blocked', {
        reason: 'cdp-command-failed',
        method,
        message: error && error.message ? String(error.message).slice(0, 200) : String(error),
        ...target,
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
      binding: { sessionId: session.sessionId, ...target, summary: summary || null },
      createdAt: this._now(),
    });
    this._emit(panelId, 'action.requested', { actionId, method, ...target });
    return { actionId, binding: target };
  }

  /**
   * 批准确认单（阶段 1 由 smoke 脚本代表用户调用；阶段 4 起走真实用户审批 UI）。
   * 批准人必须与会话 owner 一致。
   */
  approveAction(actionId, capabilityToken, approverToken) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    if (!detail) throw new Error('确认单不存在或已过期');
    const panel = this._authorize(detail.panelId, capabilityToken);
    const approver = panel.tokens.get(approverToken);
    if (!approver || approver.ownerId !== panel.session.ownerId) {
      this._emit(detail.panelId, 'blocked', { reason: 'approver-mismatch', actionId });
      throw new Error('批准人必须是面板所有者');
    }
    detail.approved = true;
    this._emit(detail.panelId, 'action.approved', { actionId, method: detail.method });
  }

  listEvents(panelId, capabilityToken) {
    const { session } = this._authorize(panelId, capabilityToken);
    void session;
    return (this._events.get(panelId) || []).map((event) => ({ ...event }));
  }

  // ---- 内部 ----

  _consumeApproval(actionId, panelId, method, target) {
    const detail = this._pendingApprovalsDetail && this._pendingApprovalsDetail.get(actionId);
    if (!detail || detail.panelId !== panelId || !detail.approved) return false;
    if (detail.method !== method) return false;
    if (detail.binding.webContentsId !== target.webContentsId) {
      // 页面目标变了，确认单作废（防换页后放行旧动作）
      return false;
    }
    this._pendingApprovals.delete(actionId);
    this._pendingApprovalsDetail.delete(actionId);
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
}

// 阶段 1 smoke 开关：真实产品路径必须保持 false（写动作走审批）。
const READONLY_AUTO_APPROVE_MUTATIONS = false;

module.exports = { BrowserPanelBroker, CDP_WHITELIST, MUTATION_METHODS, READONLY_METHODS };
