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
  // 调宽是布局动作、非导航：控制条与受信前端（3010 dock 全高把手）同权。
  ipcMain.handle('browser-panel:set-width', stripOrTrusted((w) => ({ result: getPanel().setWidth(w) })));

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
      return getWiring().approveActionAsOwner(panelId, actionId, { via: 'approval-overlay' });
    }),
  );
  ipcMain.handle(
    'browser-panel:reject-action',
    approvalOnly((actionId) => {
      const panelId = currentPanelId();
      if (!panelId) throw new Error('面板未打开，无可拒绝的动作');
      return getWiring().rejectActionAsOwner(panelId, actionId, { via: 'approval-overlay' });
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
