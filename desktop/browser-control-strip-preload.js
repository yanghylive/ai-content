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
