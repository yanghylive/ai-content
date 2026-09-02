'use strict';
/**
 * browser-broker-wiring.js — BrowserPanelManager × BrowserPanelBroker 接线（阶段 3）
 *
 * 职责（工作流文档 §3.2 / 阶段 3）：
 *  - 订阅 manager 会话事件，把面板的 panelId/sessionId/owner/tenant/partition
 *    同步成 Broker 会话；账号切换 / 面板销毁 → 撤销旧 capability token、
 *    重建会话（旧 token 立即失效，即"重启句柄失效"语义）；
 *  - **capability token 只存活在本模块（主进程内存）**，publicState/IPC 永不
 *    携带——阶段 4 的 3011 Agent 桥经 authenticated local IPC 让主进程代为
 *    执行（本模块是唯一持有权），杜绝 token 外泄；
 *  - agent 侧入口一律带 actor {ownerId, tenantId} 断言（Broker.assertActor），
 *    跨 owner/跨租户 fail-closed 并留痕。
 */

const { BrowserPanelBroker } = require('./browser-panel-broker');

const DEFAULT_OWNER = 'local-desktop';
const DEFAULT_TENANT = 'local-tenant';

/**
 * @param {{
 *   manager: import('./browser-panel-manager').BrowserPanelManager,
 *   broker?: BrowserPanelBroker,
 *   brokerDeps?: object,
 * }} deps
 */
function wireBrowserPanel(deps) {
  const manager = deps.manager;
  if (!manager || typeof manager.onSessionEvent !== 'function') {
    throw new Error('wireBrowserPanel 需要 manager（含 onSessionEvent）');
  }
  // 2026-09-03（阶段 3 硬约束 5）：Agent 不得自我批准写动作——批准必须来自
  // 用户通道（面板 owner 经 UI/确认单点批）。仅测试 harness 显式开启。
  const allowSelfApprove = deps.allowSelfApprove === true;
  const broker =
    deps.broker ||
    new BrowserPanelBroker({
      ...deps.brokerDeps,
      // 视图事实源唯一：manager 当前面板 webContents
      webContentsResolver: () => manager.panelWebContents(),
    });

  /** @type {Map<string, {capabilityToken: string, ownerId: string, tenantId: string, signature: string}>} */
  const handles = new Map();
  let disposed = false;

  function sessionSignature(session) {
    return [
      session.panelId,
      session.sessionId,
      session.ownerId || DEFAULT_OWNER,
      session.tenantId || DEFAULT_TENANT,
    ].join('|');
  }

  function revokeHandle(panelId) {
    const handle = handles.get(panelId);
    if (!handle) return;
    try {
      broker.destroyPanel(panelId, handle.capabilityToken);
    } catch {
      /* 会话可能已随 broker 实例销毁 */
    }
    handles.delete(panelId);
  }

  function reconcile() {
    if (disposed) return;
    const session = manager.session;
    if (!session) {
      // manager 无会话（未 open 或已 destroy）→ 全部句柄撤销
      for (const panelId of [...handles.keys()]) revokeHandle(panelId);
      return;
    }
    const signature = sessionSignature(session);
    const existing = handles.get(session.panelId);
    if (existing && existing.signature === signature) {
      return; // 同面板同归属：token 保持（面板 hide/show 不重置登录态）
    }
    // 新面板 / 账号切换 / 会话换绑：撤销旧 token，重建 Broker 会话
    if (existing) revokeHandle(session.panelId);
    for (const panelId of [...handles.keys()]) {
      if (panelId !== session.panelId) revokeHandle(panelId);
    }
    const created = broker.createPanel({
      panelId: session.panelId,
      sessionId: session.sessionId,
      ownerId: session.ownerId || DEFAULT_OWNER,
      tenantId: session.tenantId || DEFAULT_TENANT,
      accountId: session.accountId,
      platform: session.platform,
      partition: session.partition,
    });
    handles.set(session.panelId, {
      capabilityToken: created.capabilityToken,
      ownerId: session.ownerId || DEFAULT_OWNER,
      tenantId: session.tenantId || DEFAULT_TENANT,
      signature,
    });
  }

  // 2026-09-03（阶段 3）：manager.destroy() 先发 destroyed 事件后置空会话
  //（订阅方需在会话还在时撤销），因此 destroyed 必须显式全撤，不能走 reconcile。
  const unsubscribe = manager.onSessionEvent((event) => {
    if (event && event.type === 'destroyed') {
      for (const panelId of [...handles.keys()]) revokeHandle(panelId);
      return;
    }
    reconcile();
  });

  function handleFor(panelId, actor) {
    const handle = handles.get(panelId);
    if (!handle) {
      throw new Error('面板会话未登记（Agent 桥仅可访问已打开的面板）');
    }
    // actor 断言（跨 owner/跨租户 fail-closed；token 由主进程代持不外泄）
    broker.assertActor(panelId, handle.capabilityToken, actor);
    return handle;
  }

  return {
    broker,
    handles() {
      return Array.from(handles.entries()).map(([panelId, h]) => ({
        panelId,
        ownerId: h.ownerId,
        tenantId: h.tenantId,
        // 注意：不回传 capabilityToken（token 不出本模块）
      }));
    },
    hasHandle(panelId) {
      return handles.has(panelId);
    },
    /** 三方绑定事实源（阶段 1 P0 延续）：agent 带 actor 访问 */
    resolveTargetForAgent(panelId, actor) {
      const handle = handleFor(panelId, actor);
      return broker.resolveTarget(panelId, handle.capabilityToken);
    },
    /** 观察类 CDP（只读域走白名单，写域仍需确认单） */
    async sendCDPForAgent(panelId, actor, method, params, opts) {
      const handle = handleFor(panelId, actor);
      return broker.sendCDP(panelId, handle.capabilityToken, method, params, {
        ...opts,
        // 审批确认单签发方 = 面板 owner（阶段 4 起由用户 UI 点批）
        approvedActionId: opts && opts.approvedActionId,
      });
    },
    requestActionForAgent(panelId, actor, method, summary) {
      const handle = handleFor(panelId, actor);
      return broker.requestAction(panelId, handle.capabilityToken, method, summary);
    },
    /**
     * 用户批准通道（阶段 4 由面板审批 UI 调用）。默认拒绝：Agent 通道不得
     * 自我批准写动作（硬约束 5）——仅测试 harness allowSelfApprove 可放行。
     */
    approveActionForAgent(panelId, actor, actionId) {
      if (!allowSelfApprove) {
        const handle = handleFor(panelId, actor);
        broker.assertActor(panelId, handle.capabilityToken, actor);
        throw new Error(
          '批准必须由用户通道发起（阶段 4 接审批 UI）；Agent 不得自我批准（fail-closed）',
        );
      }
      const handle = handleFor(panelId, actor);
      broker.approveAction(
        actionId,
        handle.capabilityToken,
        handle.capabilityToken,
      );
    },
    listEventsForAgent(panelId, actor) {
      const handle = handleFor(panelId, actor);
      return broker.listEvents(panelId, handle.capabilityToken);
    },
    /** Broker 重启演练：换新 broker 实例后旧句柄全部失效（wiring dispose） */
    dispose() {
      disposed = true;
      unsubscribe();
      for (const panelId of [...handles.keys()]) revokeHandle(panelId);
    },
  };
}

module.exports = { wireBrowserPanel, DEFAULT_OWNER, DEFAULT_TENANT };
