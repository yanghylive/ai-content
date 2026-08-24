// tab-strip-preload.js — 原生标签条的极简 IPC 桥（contextIsolation 安全暴露）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabStrip', {
  // 发送一次性事件给主进程
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  // 请求/响应
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // 订阅主进程推送（返回取消函数）
  on: (channel, cb) => {
    const handler = (_event, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
