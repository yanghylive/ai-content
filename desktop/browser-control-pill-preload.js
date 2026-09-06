// browser-control-pill-preload.js — AI 控制权浮条的极简 IPC 桥
// 安全（对齐 strip/approval preload）：通道白名单，只暴露接管/交还/停用三个动作
// 与状态推送订阅，不透传任意 channel。
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'browser-panel:take-control',
  'browser-panel:release-control',
  'browser-panel:toggle-agent-mode',
]);

const ON_CHANNELS = new Set(['browser-pill:state']);

contextBridge.exposeInMainWorld('browserPill', {
  invoke: (channel, ...args) => {
    if (INVOKE_CHANNELS.has(channel)) return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error(`channel not allowed: ${channel}`));
  },
  onState: (callback) => {
    if (typeof callback !== 'function') return () => undefined;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('browser-pill:state', listener);
    return () => ipcRenderer.removeListener('browser-pill:state', listener);
  },
});
