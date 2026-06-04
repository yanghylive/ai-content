const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kaypalInstaller', {
  detect: () => ipcRenderer.invoke('detect'),
  installMissing: () => ipcRenderer.invoke('install-missing'),
  runMainInstaller: () => ipcRenderer.invoke('run-main-installer'),
  openLog: () => ipcRenderer.invoke('open-log'),
  onEvent: (callback) => {
    ipcRenderer.on('installer-event', (_event, payload) => callback(payload));
  },
});
