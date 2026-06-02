const { autoUpdater } = require('electron-updater');
const { dialog, app } = require('electron');
const Store = require('electron-store');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let updateCheckInterval = null;
let isManualCheck = false;
let updateDownloaded = false;
let updatesConfigured = false;
const store = new Store();

function setupAutoUpdater(win) {
  mainWindow = win;
  updatesConfigured = configureUpdateFeed();

  if (!updatesConfigured) {
    console.warn('[AutoUpdater] Auto update is disabled because no real update feed is configured.');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
    sendToRenderer('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    isManualCheck = false; // reset after use

    // 检查是否是被跳过的版本
    const skippedVersion = store.get('skippedVersion');
    if (skippedVersion && skippedVersion === info.version && !isManualCheck) {
      console.log(`[AutoUpdater] Skipping version ${info.version} (user chose to skip)`);
      return;
    }

    sendToRenderer('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });

    if (!mainWindow) return;

    // 后台检查时不弹窗，只在手动检查时弹窗
    if (!isManualCheck) {
      sendToRenderer('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes,
        silent: true
      });
      return;
    }

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${info.version}`,
      detail: typeof info.releaseNotes === 'string'
        ? info.releaseNotes.slice(0, 500)
        : `当前版本 v${app.getVersion()}，是否立即下载更新？`,
      buttons: ['立即下载', '稍后提醒', '跳过此版本'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      } else if (response === 2) {
        store.set('skippedVersion', info.version);
        console.log(`[AutoUpdater] User skipped version ${info.version}`);
      }
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] No updates available, current:', app.getVersion());
    sendToRenderer('update-not-available');

    if (isManualCheck && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '已是最新',
        message: `当前已是最新版本 v${app.getVersion()}`,
        buttons: ['确定']
      });
    }
    isManualCheck = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    console.log(`[AutoUpdater] Download: ${percent}% (${formatBytes(progress.bytesPerSecond)}/s)`);

    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100);
    }

    sendToRenderer('update-download-progress', {
      percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    updateDownloaded = true;

    if (mainWindow) {
      mainWindow.setProgressBar(-1);
    }

    sendToRenderer('update-downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });

    if (!mainWindow) return;

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已就绪',
      message: `新版本 v${info.version} 已下载完成`,
      detail: '是否立即重启应用以安装更新？未保存的数据可能会丢失。',
      buttons: ['立即重启', '稍后重启'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error.message);
    isManualCheck = false;

    if (mainWindow) {
      mainWindow.setProgressBar(-1);
    }

    sendToRenderer('update-error', { message: error.message });

    if (isManualCheck && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '更新失败',
        message: '检查更新时出错',
        detail: error.message || '请检查网络连接后重试。',
        buttons: ['确定']
      });
    }
    isManualCheck = false;
  });

  // 启动后延迟 5 秒自动检查
  setTimeout(() => {
    checkForUpdates(false);
  }, 5000);

  // 每 2 小时自动检查
  updateCheckInterval = setInterval(() => {
    checkForUpdates(false);
  }, 2 * 60 * 60 * 1000);
}

function checkForUpdates(manual = false) {
  isManualCheck = manual;

  if (!updatesConfigured) {
    const message = '自动更新未配置：商用发布包需要配置真实可用的 AI_CONTENT_UPDATE_URL 或 app-update.yml。';
    console.warn('[AutoUpdater]', message);
    sendToRenderer('update-error', { message });

    if (manual && mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '自动更新未配置',
        message: '当前安装包未配置自动更新地址',
        detail: message,
        buttons: ['确定']
      });
    }
    isManualCheck = false;
    return;
  }

  // 手动检查时清除跳过的版本
  if (manual) {
    store.delete('skippedVersion');
  }

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdater] checkForUpdates failed:', err.message);
    isManualCheck = false;
  });
}

function quitAndInstall() {
  if (!updateDownloaded) {
    console.warn('[AutoUpdater] quitAndInstall called but no update downloaded');
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '无可用更新',
        message: '尚未下载任何更新，请先检查并下载更新。',
        buttons: ['确定']
      });
    }
    return;
  }
  autoUpdater.quitAndInstall(false, true);
}

function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function configureUpdateFeed() {
  const updateUrl = process.env.AI_CONTENT_UPDATE_URL;
  if (updateUrl) {
    try {
      const parsed = new URL(updateUrl);
      if (parsed.protocol !== 'https:') {
        console.warn('[AutoUpdater] AI_CONTENT_UPDATE_URL must use HTTPS.');
        return false;
      }
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: parsed.toString()
      });
      console.log('[AutoUpdater] Using update feed from AI_CONTENT_UPDATE_URL.');
      return true;
    } catch (err) {
      console.warn('[AutoUpdater] Invalid AI_CONTENT_UPDATE_URL:', err.message);
      return false;
    }
  }

  const packagedUpdateConfig = app.isPackaged
    ? path.join(process.resourcesPath, 'app-update.yml')
    : null;
  return Boolean(packagedUpdateConfig && fs.existsSync(packagedUpdateConfig));
}

function destroy() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
}

module.exports = { setupAutoUpdater, checkForUpdates, quitAndInstall, destroy };
