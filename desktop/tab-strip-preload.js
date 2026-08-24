// tab-strip-preload.js — 原生标签条的极简 IPC 桥（contextIsolation 安全暴露）
// 安全：通道白名单——仅放行标签条自身需要的 channel，杜绝裸透传（任意 ipcMain handler 皆可调）。
const { contextBridge, ipcRenderer } = require('electron');

// 可发送的事件通道（tab 条 → main）
const SEND_CHANNELS = new Set([
  'tab-strip:new',
  'tab-strip:switch',
  'tab-strip:close',
  'tab-strip:rename',
  'tab-strip:set-workspace',
  'tab-strip:switch-business',
  'tab-strip:request-octop'
]);

// 可 invoke 的请求通道（tab 条 → main，仅只读 list）
const INVOKE_CHANNELS = new Set(['workspace-tabs:list']);

// 可订阅的推送通道（main → tab 条）
const ON_CHANNELS = new Set(['tab-strip:state']);

contextBridge.exposeInMainWorld('tabStrip', {
  // 发送一次性事件给主进程
  send: (channel, ...args) => {
    if (SEND_CHANNELS.has(channel)) ipcRenderer.send(channel, ...args);
  },
  // 请求/响应
  invoke: (channel, ...args) => {
    if (INVOKE_CHANNELS.has(channel)) return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error(`channel not allowed: ${channel}`));
  },
  // 订阅主进程推送（返回取消函数）
  on: (channel, cb) => {
    if (!ON_CHANNELS.has(channel)) return () => {};
    const handler = (_event, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
