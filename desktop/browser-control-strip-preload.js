// browser-control-strip-preload.js — 浏览器面板控制条的极简 IPC 桥
// 安全（对齐 tab-strip-preload）：通道白名单，只暴露地址栏/导航/面板状态最小 API，
// 不透传任意 channel，不给第三方页面的控制条任何特权 IPC 面。
const { contextBridge, ipcRenderer } = require('electron');

// 控制条 → main（invoke 请求通道）
const INVOKE_CHANNELS = new Set([
  'browser-panel:navigate',
  'browser-panel:back',
  'browser-panel:forward',
  'browser-panel:reload',
  'browser-panel:hide',
  'browser-panel:set-width',
  'browser-panel:expand-strip',
  'browser-panel:clear-activity',
  // 活动日志展开全部（视图按上报高度加高）
  'browser-panel:expand-activity',
  // 分区沟槽（复用本 preload）：拖拽调宽会话
  'browser-panel:begin-resize',
  'browser-panel:end-resize',
  // ③：面板模式开关（Agent 是否通过面板代操作）
  'browser-panel:toggle-agent-mode',
  // TraeWork 控制权模型：接管 / 交还
  'browser-panel:take-control',
  'browser-panel:release-control',
  // round15：用户手动切/关 tab（控制条 tab 条）
  'browser-panel:switch-tab',
  'browser-panel:close-tab',
]);

// main → 控制条（事件推送通道）
const ON_CHANNELS = new Set(['browser-panel:state']);

contextBridge.exposeInMainWorld('browserControl', {
  invoke: (channel, ...args) => {
    if (INVOKE_CHANNELS.has(channel)) return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error(`channel not allowed: ${channel}`));
  },
  onState: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('browser-panel:state', listener);
    return () => ipcRenderer.removeListener('browser-panel:state', listener);
  },
});
