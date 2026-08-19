const { contextBridge, ipcRenderer } = require('electron');

// 悬浮球（hover-ball）专用最小 preload：
// 只暴露 hover-ball.html 实际用到的两个通道（拖拽 + AI 网页代操作），
// 不暴露 electronAPI（secure-store / config:set / installUpdate 等）以缩小攻击面。
contextBridge.exposeInMainWorld('hoverBallAPI', {
  runAction: (data) => ipcRenderer.invoke('hover-ball:ai-action', data),
  drag: (delta) => ipcRenderer.send('hover-ball:drag', delta)
});
