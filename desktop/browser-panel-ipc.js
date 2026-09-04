'use strict';
/**
 * browser-panel-ipc.js — 浏览器面板的全部 IPC 通道注册（阶段 6 抽出）
 *
 * 为什么抽成独立模块：
 *  阶段 5 已经踩过一次"E2E 验副本、生产跑另一份"的坑（当时靠把桥生命周期抽成
 *  browser-panel-bridge-runtime 解决）。审批 UI 的 IPC 如果只写在 main.js 里，
 *  端到端冒烟就只能自己复制一份 handler 来测 —— 那测的是副本，main.js 里真正
 *  跑的那份完全没被验证。所以这里做成**唯一实现**，main.js 与 smoke 都调它。
 *
 * 三条 sender 门禁（与 workspace-tabs / 控制条同等级）：
 *  - `strip ∨ trusted`：开面板 / 查状态（控制条和 3010 前端都能发起）；
 *  - `stripOnly`：导航类（只有本地控制条能发，前端不得替用户导航）；
 *  - `approvalOnly`：批准 / 拒绝（**只有审批浮层自己**能发，防第三方页面伪造）。
 *
 * 注意：sender 门禁只是第一层。真正的 owner 校验在 wiring
 * （approveActionAsOwner / rejectActionAsOwner 内部校 owner capability token）。
 */

/**
 * @param {{
 *   ipcMain: { handle(channel: string, handler: (event:any, ...args:any[]) => any): void },
 *   getPanel: () => any,
 *   getWiring: () => any,
 *   isTrustedRendererSender?: (event: any) => boolean,
 * }} deps
 */
function registerBrowserPanelIpc(deps) {
  const { ipcMain, getPanel, getWiring } = deps;
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('registerBrowserPanelIpc 需要 ipcMain');
  }
  const isTrustedRendererSender =
    typeof deps.isTrustedRendererSender === 'function' ? deps.isTrustedRendererSender : null;

  /** 控制条 ∨ 受信前端（3010）：开面板 / 查状态 */
  const stripOrTrusted = (handler) => async (event, ...args) => {
    const panel = getPanel();
    const fromStrip = !!panel && typeof panel.isStripSender === 'function' && panel.isStripSender(event.sender);
    const fromTrusted = !!isTrustedRendererSender && isTrustedRendererSender(event);
    if (!fromStrip && !fromTrusted) {
      return { success: false, error: 'untrusted-sender' };
    }
    try {
      return { success: true, ...(await handler(...args)) };
    } catch (error) {
      return { success: false, error: error && error.message ? error.message : String(error) };
    }
  };

  /** 仅控制条：导航类动作（前端不得替用户导航） */
  const stripOnly = (handler) => async (event, ...args) => {
    const panel = getPanel();
    if (!panel || typeof panel.isStripSender !== 'function' || !panel.isStripSender(event.sender)) {
      return { success: false, error: 'untrusted-sender' };
    }
    try {
      return { success: true, result: await handler(...args) };
    } catch (error) {
      return { success: false, error: error && error.message ? error.message : String(error) };
    }
  };

  /** 仅审批浮层：列出待批 / 批准 / 拒绝 */
  const approvalOnly = (handler) => async (event, ...args) => {
    const panel = getPanel();
    if (!panel || typeof panel.isApprovalSender !== 'function' || !panel.isApprovalSender(event.sender)) {
      return { success: false, error: 'untrusted-sender' };
    }
    try {
      return { success: true, result: await handler(...args) };
    } catch (error) {
      return { success: false, error: error && error.message ? error.message : String(error) };
    }
  };

  const currentPanelId = () => {
    const panel = getPanel();
    return panel && panel.session ? panel.session.panelId : null;
  };

  ipcMain.handle('browser-panel:open', stripOrTrusted(async (input) => ({
    state: getPanel().open(input || {}),
  })));
  ipcMain.handle('browser-panel:state', stripOrTrusted(async () => ({
    state: getPanel().publicState(),
  })));

  ipcMain.handle('browser-panel:navigate', stripOnly((url) => getPanel().navigate(url)));
  ipcMain.handle('browser-panel:back', stripOnly(() => getPanel().goBack()));
  ipcMain.handle('browser-panel:forward', stripOnly(() => getPanel().goForward()));
  ipcMain.handle('browser-panel:reload', stripOnly(() => getPanel().reload()));
  ipcMain.handle('browser-panel:hide', stripOnly(() => getPanel().hide()));
  ipcMain.handle('browser-panel:show', stripOnly(() => getPanel().show()));
  ipcMain.handle('browser-panel:set-width', stripOnly((w) => getPanel().setWidth(w)));
  // 地址栏聚焦时的快捷跳转行（控制条/沟槽视图展开自己的高度）
  ipcMain.handle('browser-panel:expand-strip', stripOnly((on, height) => getPanel().setStripExpanded(on, height)));
  // 活动条「清除」：清空面板活动日志（控制条 stripOnly）
  ipcMain.handle('browser-panel:clear-activity', stripOnly(() => { getPanel().clearActivity(); return true; }));
  // 拖拽调宽会话：沟槽 pointerdown 开始 / pointerup 结束。视图只有 10px 宽，
  // 光标一出视图就断流，所以拖拽由主进程轮询系统光标驱动（见 manager.beginResize）。
  ipcMain.handle('browser-panel:begin-resize', stripOnly(() => getPanel().beginResize()));
  ipcMain.handle('browser-panel:end-resize', stripOnly(() => getPanel().endResize()));

  // 阶段 6 决策 ③：面板模式开关（只有控制条按钮能切；写/删 userData 下的 0600 文件）
  ipcMain.handle(
    'browser-panel:toggle-agent-mode',
    stripOnly((on) => getPanel().setAgentMode(!!on)),
  );

  // round15：用户手动切/关 tab（只有控制条 tab 条能发；用户自家操作不走 Agent
  // 审批闸门，与后退/刷新同权；manager 侧错误转 {ok:false} 不抛）
  ipcMain.handle(
    'browser-panel:switch-tab',
    stripOnly((index) => getPanel().switchTabByUser(Number(index))),
  );
  ipcMain.handle(
    'browser-panel:close-tab',
    stripOnly((index) => getPanel().closeTabByUser(Number(index))),
  );

  // 阶段 6：审批浮层三通道
  ipcMain.handle(
    'browser-panel:list-pending-actions',
    approvalOnly(() => {
      const panelId = currentPanelId();
      return panelId ? getWiring().listPendingActions(panelId) : [];
    }),
  );
  ipcMain.handle(
    'browser-panel:approve-action',
    approvalOnly((actionId) => {
      const panelId = currentPanelId();
      if (!panelId) throw new Error('面板未打开，无可批准的动作');
      const result = getWiring().approveActionAsOwner(panelId, actionId, { via: 'approval-overlay' });
      getPanel().recordActivity('approve', `批准面板操作 a-${String(actionId).slice(0, 8)}`);
      return result;
    }),
  );
  ipcMain.handle(
    'browser-panel:reject-action',
    approvalOnly((actionId) => {
      const panelId = currentPanelId();
      if (!panelId) throw new Error('面板未打开，无可拒绝的动作');
      const result = getWiring().rejectActionAsOwner(panelId, actionId, { via: 'approval-overlay' });
      getPanel().recordActivity('reject', `拒绝面板操作 a-${String(actionId).slice(0, 8)}`);
      return result;
    }),
  );

  return {
    channels: [
      'browser-panel:open',
      'browser-panel:state',
      'browser-panel:navigate',
      'browser-panel:back',
      'browser-panel:forward',
      'browser-panel:reload',
      'browser-panel:hide',
      'browser-panel:show',
      'browser-panel:set-width',
      'browser-panel:expand-strip',
      'browser-panel:clear-activity',
      'browser-panel:begin-resize',
      'browser-panel:end-resize',
      'browser-panel:toggle-agent-mode',
      'browser-panel:switch-tab',
      'browser-panel:close-tab',
      'browser-panel:list-pending-actions',
      'browser-panel:approve-action',
      'browser-panel:reject-action',
    ],
  };
}

module.exports = { registerBrowserPanelIpc };
