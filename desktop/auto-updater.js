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
let onStateChange = null;
const store = new Store();

function setupAutoUpdater(win, hooks = {}) {
  mainWindow = win;
  onStateChange = typeof hooks.onStateChange === 'function' ? hooks.onStateChange : null;
  updatesConfigured = configureUpdateFeed();

  if (!updatesConfigured) {
    console.warn('[AutoUpdater] Auto update is disabled because no real update feed is configured.');
    if (onStateChange) {
      onStateChange({ configured: false, phase: 'disabled', hasUpdate: false, downloaded: false });
    }
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
    sendToRenderer('update-checking');
    if (onStateChange) onStateChange({ configured: true, phase: 'checking', hasUpdate: false, downloaded: false, error: null });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    isManualCheck = false;

    const skippedVersion = store.get('skippedVersion');
    if (skippedVersion && skippedVersion === info.version) {
      console.log(`[AutoUpdater] Skipping version ${info.version} (user chose to skip)`);
      if (onStateChange) onStateChange({ configured: true, phase: 'idle', hasUpdate: false, downloaded: false, error: null });
      return;
    }

    sendToRenderer('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });

    if (onStateChange) {
      onStateChange({
        configured: true,
        phase: 'available',
        hasUpdate: true,
        downloaded: false,
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
        progress: 0,
        error: null,
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] No updates available, current:', app.getVersion());
    sendToRenderer('update-not-available');

    if (onStateChange) {
      onStateChange({ configured: true, phase: 'idle', hasUpdate: false, downloaded: false, error: null });
    }

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

    if (onStateChange) {
      onStateChange({
        configured: true,
        phase: 'downloaded',
        hasUpdate: true,
        downloaded: true,
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
        progress: 100,
        error: null,
      });
    }
  });

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error.message);
    isManualCheck = false;

    if (mainWindow) {
      mainWindow.setProgressBar(-1);
    }

    sendToRenderer('update-error', { message: error.message });

    if (onStateChange) {
      onStateChange({
        configured: true,
        phase: 'error',
        hasUpdate: false,
        downloaded: false,
        error: error.message || '更新失败',
      });
    }

    isManualCheck = false;
  });

  setTimeout(() => {
    checkForUpdates(false);
  }, 5000);

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

function downloadUpdate() {
  if (!updatesConfigured) {
    console.warn('[AutoUpdater] Cannot download: update feed not configured');
    return false;
  }
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('[AutoUpdater] downloadUpdate failed:', err.message);
  });
  return true;
}

function skipUpdate(version) {
  if (!version) return;
  store.set('skippedVersion', version);
  console.log(`[AutoUpdater] User skipped version ${version}`);
}

function getSkippedVersion() {
  return store.get('skippedVersion') || null;
}

function getUpdateFeedInfo() {
  return {
    configured: updatesConfigured,
    envUrl: process.env.AI_CONTENT_UPDATE_URL || null,
  };
}

module.exports = { setupAutoUpdater, checkForUpdates, quitAndInstall, destroy, downloadUpdate, skipUpdate, getSkippedVersion, getUpdateFeedInfo };
