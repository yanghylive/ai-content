const { contextBridge, ipcRenderer } = require('electron');
const {
  buildError,
  createNonceCache,
  sanitizeResponse,
  validateRequest,
} = require('./local-bridge');

const nonceCache = createNonceCache();

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data;
  const now = Date.now();
  if (!validateRequest(request, now) || !nonceCache.accept(event.origin, request.nonce, now)) return;

  let response;
  try {
    const candidate = await ipcRenderer.invoke('local-bridge:request', request);
    response = sanitizeResponse(candidate, request)
      || buildError(request, 'INTERNAL_ERROR', '本地桥接响应无效', 500);
  } catch {
    response = buildError(request, 'INTERNAL_ERROR', '本地桥接调用失败', 500);
  }
  window.postMessage(response, window.location.origin);
});

// 事件监听器注册表，用于清理
const listenerRegistry = new Map();

function addManagedListener(channel, callback) {
  const key = `${channel}:${listenerRegistry.size}`;
  const handler = (event, ...args) => callback(...args);
  ipcRenderer.on(channel, handler);
  listenerRegistry.set(key, { channel, handler });
  return key;
}

function removeManagedListener(key) {
  const entry = listenerRegistry.get(key);
  if (entry) {
    ipcRenderer.removeListener(entry.channel, entry.handler);
    listenerRegistry.delete(key);
  }
}

function removeAllManagedListeners() {
  for (const [key, entry] of listenerRegistry) {
    ipcRenderer.removeListener(entry.channel, entry.handler);
  }
  listenerRegistry.clear();
}

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 系统能力（v1.1.65 修复）：外部链接/剪贴板/安全凭据存储
  system: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    writeClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),
    secureStoreGet: (key) => ipcRenderer.invoke('secure-store:get', key),
    secureStoreSet: (key, value) => ipcRenderer.invoke('secure-store:set', key, value),
    secureStoreDelete: (key) => ipcRenderer.invoke('secure-store:delete', key)
  },

  // 云端 API
  cloudAPI: {
    generateReply: (data) => ipcRenderer.invoke('cloud-api:generate-reply', data),
    checkContent: (data) => ipcRenderer.invoke('cloud-api:check-content', data),
    checkDedup: (data) => ipcRenderer.invoke('cloud-api:check-dedup', data),
    markSent: (data) => ipcRenderer.invoke('cloud-api:mark-sent', data)
  },

  // 配置管理
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value)
  },

  // 服务管理
  service: {
    restart: () => ipcRenderer.invoke('service:restart'),
    status: () => ipcRenderer.invoke('service:status')
  },

  // 应用控制
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    getPlatform: () => ipcRenderer.invoke('app:get-platform'),
    getDataPath: () => ipcRenderer.invoke('app:get-data-path'),
    getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
    downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
    skipUpdate: (version) => ipcRenderer.invoke('app:skip-update', version),
    getUpdateFeedInfo: () => ipcRenderer.invoke('app:get-update-feed-info'),
  },

  // 系统功能
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
    showItemInFolder: (fullPath) => ipcRenderer.invoke('shell:show-item-in-folder', fullPath)
  },

  // 事件监听（带清理机制）
  onUpdateChecking: (callback) => {
    return addManagedListener('update-checking', callback);
  },

  onUpdateAvailable: (callback) => {
    return addManagedListener('update-available', callback);
  },

  onUpdateNotAvailable: (callback) => {
    return addManagedListener('update-not-available', callback);
  },

  onUpdateDownloadProgress: (callback) => {
    return addManagedListener('update-download-progress', callback);
  },

  onUpdateDownloaded: (callback) => {
    return addManagedListener('update-downloaded', callback);
  },

  onUpdateError: (callback) => {
    return addManagedListener('update-error', callback);
  },

  onUpdateState: (callback) => {
    return addManagedListener('update-state', callback);
  },

  onServiceStatus: (callback) => {
    return addManagedListener('service-status', callback);
  },

  // 移除指定监听器
  removeListener: (key) => {
    removeManagedListener(key);
  },

  // 移除所有监听器
  removeAllListeners: () => {
    removeAllManagedListeners();
  }
});

// 暴露环境信息
// 悬浮球（hoverBall）专用 API
contextBridge.exposeInMainWorld('hoverBallAPI', {
  runAction: (data) => ipcRenderer.invoke('hover-ball:ai-action', data),
  drag: (delta) => ipcRenderer.send('hover-ball:drag', delta)
});

contextBridge.exposeInMainWorld('electronEnv', {
  platform: process.platform,
  isElectron: true,
  get version() {
    try {
      return require('electron').app.getVersion();
    } catch {
      return '1.0.0';
    }
  }
});
