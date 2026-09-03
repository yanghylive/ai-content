// browser-approval-overlay-preload.js — 浏览器面板「审批浮层」的极简 IPC 桥
//
// 阶段 6：Agent 想在面板上执行写动作（点击/输入/导航）时，必须先在**这个界面**
// 由用户点「批准」。批准权永远在用户手上，Agent 侧通道默认无条件抛错。
//
// 安全 posture（对齐 browser-control-strip-preload）：
//  - 通道白名单，不透传任意 channel；
//  - 只暴露「读待批列表 + 批准 + 拒绝」三个动作，不给面板内容任何特权 IPC 面；
//  - 真正的 owner 校验在主进程（manager.isApprovalSender + wiring 的 owner token），
//    这里不做校验——preload 不可信，校验必须落在主进程。

const { contextBridge, ipcRenderer } = require('electron');

// 浮层 → main（invoke 请求通道）
const INVOKE_CHANNELS = new Set([
  'browser-panel:list-pending-actions',
  'browser-panel:approve-action',
  'browser-panel:reject-action',
]);

// main → 浮层（事件推送通道）
const ON_CHANNELS = new Set(['browser-panel:pending-actions']);

contextBridge.exposeInMainWorld('browserApproval', {
  invoke: (channel, ...args) => {
    if (INVOKE_CHANNELS.has(channel)) return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error(`channel not allowed: ${channel}`));
  },
  onPendingActions: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('browser-panel:pending-actions', listener);
    return () => ipcRenderer.removeListener('browser-panel:pending-actions', listener);
  },
});

void ON_CHANNELS;
