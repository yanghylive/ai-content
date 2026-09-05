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

const { BrowserPanelBroker, redactUrlForEvidence } = require('./browser-panel-broker');

const DEFAULT_OWNER = 'local-desktop';
const DEFAULT_TENANT = 'local-tenant';

/**
 * 引擎（3011 local-engine）的固定 agent 身份（2026-09-05 复核 P1）：
 * panel-state / panel-open 与 /execute 的 handleFor(panelId, actor) 同一强度——
 * actor 必须精确匹配此身份才可访问面板路由，跨 owner/跨租户 fail-closed。
 * 引擎侧（agent-panel-bridge.service.ts）发送的 actor 与此对齐。
 */
const ENGINE_AGENT_ACTOR = Object.freeze({
  ownerId: 'local-engine',
  tenantId: 'local-tenant',
});

function assertEngineAgentActor(actor) {
  if (
    !actor ||
    typeof actor !== 'object' ||
    actor.ownerId !== ENGINE_AGENT_ACTOR.ownerId ||
    actor.tenantId !== ENGINE_AGENT_ACTOR.tenantId
  ) {
    throw new Error(
      '面板路由 actor 身份不一致（仅允许 local-engine 引擎身份，fail-closed）',
    );
  }
}

/**
 * panel-open 允许的域名白名单（2026-09-05 阶段 P1：引擎「内置面板优先」通道）。
 * 3011 引擎请求打开面板时，URL 必须命中已知平台域——防止桥被当成通用
 * 导航器（代理任意浏览）。子域自动放行（endsWith '.' + host）。
 */
const PANEL_OPEN_ALLOWED_HOSTS = [
  'douyin.com',
  'weixin.qq.com',
  'xiaohongshu.com',
  'kuaishou.com',
  'bilibili.com',
  'weibo.com',
  'zhihu.com',
  'toutiao.com',
];

/**
 * @param {{
 *   manager: import('./browser-panel-manager').BrowserPanelManager,
 *   broker?: BrowserPanelBroker,
 *   brokerDeps?: object,
 *   allowSelfApprove?: boolean,
 *   onPendingChange?: (panelId: string, pending: unknown[]) => void,
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
  /**
   * 待批列表变更回调（阶段 6 审批 UI 的实时源）。
   * Agent 签新单 / 用户批准 / 用户拒绝都会触发，主进程据此刷新审批浮层。
   * 回调抛错绝不能影响签单/批准本身（UI 是旁路，不是业务链路）。
   */
  const notifyPendingChange = (panelId) => {
    if (typeof deps.onPendingChange !== 'function') return;
    let pending = [];
    try {
      pending = handles.has(panelId) ? broker.listPendingActions(panelId, handles.get(panelId).capabilityToken) : [];
    } catch {
      pending = [];
    }
    try {
      deps.onPendingChange(panelId, pending);
    } catch {
      /* UI 旁路失败不阻断业务 */
    }
  };
  const broker =
    deps.broker ||
    new BrowserPanelBroker({
      ...deps.brokerDeps,
      // 视图事实源唯一：manager 当前面板 webContents（多 tab 下 = active tab）
      webContentsResolver: () => manager.panelWebContents(),
      // 阶段 7 round11：tabs 主进程实现——broker 的 Panel.tabs 伪 method 经此
      // 回调 manager 原生台账（new/switch/close），审批闸门在 broker 侧先行。
      tabsHandler: (operation, index) => manager.tabsOperation(operation, index),
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
    // token 已被 broker 过期删除时 destroyPanel 恒 no-op（panel.tokens 里查无
    // 此 token）→ dropPanel 兜底清残留（正常路径 panel 已删，幂等 no-op）。
    try {
      broker.dropPanel(panelId);
    } catch {
      /* broker 实例可能已销毁 */
    }
    handles.delete(panelId);
  }

  function reconcile({ forceTokenRefresh = false } = {}) {
    if (disposed) return;
    const session = manager.session;
    if (!session) {
      // manager 无会话（未 open 或已 destroy）→ 全部句柄撤销
      for (const panelId of [...handles.keys()]) revokeHandle(panelId);
      return;
    }
    const signature = sessionSignature(session);
    const existing = handles.get(session.panelId);
    if (existing && existing.signature === signature && !forceTokenRefresh) {
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
  // 2026-09-04（阶段 5 只读校准 E2E 抓获）：opened/shown = 用户明确要用面板，
  // **强制重铸 capability token**。否则面板闲置超 TTL 后 token 已被 broker
  // 过期删除（_authorize fail-closed），而 open 复用会话 signature 不变 →
  // reconcile「token 保持」早退 → 永远 TOKEN_INVALID（错误提示说「重新打开
  // 浏览器面板后重试」，重开却愈不了——承诺与实现脱节）。重铸只发生在主进程
  // 内存（token 不出本模块），不松安全语义；登录态在 partition，不受影响。
  const unsubscribe = manager.onSessionEvent((event) => {
    if (event && event.type === 'destroyed') {
      for (const panelId of [...handles.keys()]) revokeHandle(panelId);
      return;
    }
    const type = event && event.type;
    reconcile({
      forceTokenRefresh: type === 'opened' || type === 'shown',
    });
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

  /**
   * owner 批准的无提示实现：broker.approveAction + owner token 双写。
   * 用户点批（approveActionAsOwner）和系统控制自动批准共用这段，
   * 审计语义一致（channel 都是 owner-ui，via 字段区分来源）。
   */
  function approveOwnerSide(panelId, actionId, context) {
    const handle = handles.get(panelId);
    if (!handle) {
      throw new Error('面板会话未登记（无主可批）');
    }
    if (!actionId) throw new Error('缺少 actionId');
    broker.approveAction(actionId, handle.capabilityToken, handle.capabilityToken, {
      channel: 'owner-ui',
      ...(context || {}),
    });
  }

  // TraeWork 控制权模型 · 交还放行：control 切回 'system' 时批量批准排队单。
  // 接管期间 AI 签的单保持 pending（AI 走现有 defer 路径自然暂停）；用户点
  // 「交还」= 把决定权还给系统，队里的单逐张经 owner 通道批准，loop 的下一次
  // 重试经 actionState=approved 正常执行（executor 带票路径，审计照常落库）。
  const unsubscribeControl =
    typeof manager.onControlChange === 'function'
      ? manager.onControlChange((control) => {
          if (control !== 'system') return;
          let released = 0;
          for (const [panelId, handle] of [...handles.entries()]) {
            let pending = [];
            try {
              pending = broker.listPendingActions(panelId, handle.capabilityToken);
            } catch {
              continue;
            }
            for (const item of pending) {
              try {
                approveOwnerSide(panelId, item.actionId, { via: 'auto-release-control' });
                released += 1;
              } catch {
                /* 单可能已被消费/收口，跳过（对账路径兜底） */
              }
            }
            notifyPendingChange(panelId);
          }
          if (released > 0 && typeof manager.recordActivity === 'function') {
            manager.recordActivity('control', '已放行 ' + released + ' 个排队操作', true);
          }
        })
      : null;

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
    /**
     * 2026-09-05 复核 P0-1（账号强绑定）：面板当前会话事实（脱敏）。
     * 引擎复用/请求面板前必须先核对本口径的 accountId——
     * partition 归属以 manager 会话台账为唯一事实源，禁止按平台/URL 猜。
     */
    panelStateForAgent(actor) {
      // 2026-09-05 复核 P1：与 /execute 同强度——先断言引擎身份，再读台账。
      assertEngineAgentActor(actor);
      if (typeof manager.publicState !== 'function') {
        throw new Error('panel-state: manager.publicState 不可用');
      }
      const state = manager.publicState();
      const session = state && state.session;
      if (!session) {
        return { hasSession: false, accountId: null, partition: null };
      }
      return {
        hasSession: true,
        panelId: session.panelId || null,
        // sessionId 不是 URL，不走 URL 脱敏（误标 [unparseable-url] 反而丢证据信息）；
        // URL 敏感信息（query token 等）只对 currentUrl 脱敏。
        sessionId: String(session.sessionId || '') || null,
        accountId: session.accountId != null ? String(session.accountId) : null,
        platform: session.platform || null,
        partition: session.partition || null,
        url: redactUrlForEvidence(String(session.currentUrl || '')),
        visible: state.visible === true,
        status: session.status || null,
      };
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
      const ticket = broker.requestAction(panelId, handle.capabilityToken, method, summary);
      // TraeWork 控制权模型：系统控制（默认）→ 新单立即经 owner 通道自动批准，
      // 响应带 autoApproved，executor 据此直接执行（不再"每步弹卡等你点批"）。
      // 用户接管（control='user'）时保持 pending 排队，审批浮层回归逐条确认。
      // fail-safe：自动批准抛错 → 维持人工审批路径，绝不升权。
      let autoApproved = false;
      if (typeof manager.getControl === 'function' && manager.getControl() === 'system') {
        try {
          approveOwnerSide(panelId, ticket.actionId, { via: 'auto-system-control' });
          autoApproved = true;
        } catch {
          autoApproved = false;
        }
      }
      notifyPendingChange(panelId);
      return Object.assign({}, ticket, { autoApproved });
    },
    /**
     * 2026-09-05（引擎「内置面板优先」通道）：3011 引擎经本方法请求打开面板，
     * 替代"spawn 独立可见 Chromium（被当成外部浏览器）"的兜底路径。
     * 边界：
     *  - 只开面板 + 加载 URL（经 manager.open 的 normalizePanelUrl 校验），
     *    不读取/返回任何页面内容；页面后续操作仍走 broker CDP 闸门 / 引擎
     *    connectOverCDP（按 partition 找 context）；
     *  - URL 域名白名单（PANEL_OPEN_ALLOWED_HOSTS），防通用导航器滥用；
     *  - actor 必须精确匹配引擎身份（assertEngineAgentActor，与 /execute 同强度，
     *    2026-09-05 复核 P1）；面板 owner 仍固定 local-desktop 引擎身份，
     *    不借用户身份开面板。
     */
    openPanelForAgent(input) {
      const { url, accountId, platform, actor } = input || {};
      assertEngineAgentActor(actor);
      if (!url || typeof url !== 'string') {
        throw new Error('panel-open: url 必填');
      }
      let host = null;
      try {
        host = new URL(url).host;
      } catch {
        host = null;
      }
      const allowed =
        host &&
        PANEL_OPEN_ALLOWED_HOSTS.some(
          (h) => host === h || host.endsWith('.' + h),
        );
      if (!allowed) {
        throw new Error(`panel-open 仅允许已知平台域名（命中: ${String(host)}）`);
      }
      if (typeof manager.open !== 'function') {
        throw new Error('panel-open: manager.open 不可用');
      }
      const state = manager.open({
        url,
        ownerId: DEFAULT_OWNER,
        tenantId: DEFAULT_TENANT,
        accountId,
        platform,
      });
      // 真实 manager.open 返回 publicState（session 挂在 .session）；
      // 测试假实现可能直接返回 session 形态——两者都兼容。
      const sess = (state && state.session) || state || null;
      return {
        panelId: (sess && sess.panelId) || null,
        accountId: (sess && sess.accountId) ?? accountId ?? null,
        platform: (sess && sess.platform) ?? platform ?? null,
        partition: (sess && sess.partition) || null,
        url: (sess && sess.currentUrl) || url,
      };
    },
    /**
     * **用户（面板所有者）批准通道** —— 阶段 4 审批 UI 的主进程接缝。
     *
     * 与 Agent 通道严格分离：
     *  - 走这条路的调用方**必须**是主进程里代表用户的那一侧（面板审批 UI 经 IPC
     *    进来），它持有 owner capability token；
     *  - Agent 侧永远走 approveActionForAgent，默认无条件抛错（硬约束 5）；
     *  - 批准只认 actionId，不认"谁在问"，因此 Agent 无法靠换 actor 绕过。
     *
     * @param {string} panelId
     * @param {string} actionId 由 Agent 侧 requestActionForAgent 签出的确认单
     * @param {{reason?: string}} [context] 审计留痕用（谁点批、为什么）
     */
    approveActionAsOwner(panelId, actionId, context = {}) {
      approveOwnerSide(panelId, actionId, context);
      notifyPendingChange(panelId);
      return { actionId, panelId, approved: true };
    },
    /**
     * **用户（面板所有者）拒绝通道** —— 阶段 6 审批 UI 的"拒绝"按钮。
     * 与 approveActionAsOwner 对称，同样校验 owner；拒绝是终态，执行闸门直接拦掉。
     */
    rejectActionAsOwner(panelId, actionId, context = {}) {
      const handle = handles.get(panelId);
      if (!handle) {
        throw new Error('面板会话未登记（无主可拒）');
      }
      if (!actionId) throw new Error('缺少 actionId');
      broker.rejectAction(actionId, handle.capabilityToken, handle.capabilityToken, {
        channel: 'owner-ui',
        ...context,
      });
      notifyPendingChange(panelId);
      return { actionId, panelId, rejected: true };
    },
    /** 确认单状态（pending/approved/none）；查询不消费，消费仍由审批闸门完成 */
    actionStateForAgent(panelId, actor, actionId) {
      const handle = handleFor(panelId, actor);
      return broker.actionState(actionId, handle.capabilityToken);
    },
    /** 当前待批确认单（供审批 UI 列表；不含 token） */
    listPendingActions(panelId) {
      const handle = handles.get(panelId);
      if (!handle) return [];
      return broker.listPendingActions(panelId, handle.capabilityToken);
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
        { channel: 'self-approve-harness', actor },
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
      if (unsubscribeControl) unsubscribeControl();
      for (const panelId of [...handles.keys()]) revokeHandle(panelId);
    },
  };
}

module.exports = { wireBrowserPanel, DEFAULT_OWNER, DEFAULT_TENANT };
