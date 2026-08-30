const { autoUpdater } = require('electron-updater');
const { dialog, app } = require('electron');
const Store = require('electron-store');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_PATH = process.env.AI_CONTENT_AUTOUPDATE_LOG ||
  path.join(os.tmpdir(), "ai-content-autoupdate.log");
const flog = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  console.log(...args);
};

let mainWindow = null;
let updateCheckInterval = null;
let isManualCheck = false;
let updateDownloaded = false;
let updatesConfigured = false;
let onStateChange = null;
let broadcastToRenderer = null;
const store = new Store();

function setupAutoUpdater(win, hooks = {}) {
  mainWindow = win;
  onStateChange = typeof hooks.onStateChange === 'function' ? hooks.onStateChange : null;
  // 多标签壳：更新进度/状态需广播到各标签内容视图（mainWindow.webContents 已不再承载前端）。
  broadcastToRenderer =
    typeof hooks.broadcastToRenderer === 'function' ? hooks.broadcastToRenderer : null;
  updatesConfigured = configureUpdateFeed();

  if (!updatesConfigured) {
    flog('[AutoUpdater] WARN: Auto update is disabled because no real update feed is configured.');
    if (onStateChange) {
      onStateChange({ configured: false, phase: 'disabled', hasUpdate: false, downloaded: false });
    }
    return;
  }

  // 2026-08-29 v1.1.101（大王拍板）：检查到更新后自动下载（安装仍由用户触发）。
  // 背景：3011 后端起不来的机器上，用户本就面对故障，还需手动点「下载更新」
  // 才能升级到修复版——自动下载让「启动即向新版本靠拢」，配合后端自愈实现
  // 故障机器无人值守恢复。autoInstallOnAppQuit=true 时下载完的版本在退出时即装。
  // v1.1.106（复核 P2-E）：autoDownload 必须 false + 显式 downloadUpdate——
  // electron-updater 在 autoDownload=true 时发出 update-available 事件后内部
  // 仍继续下载（AppUpdater.js 413-423），skipUpdate() 只隐藏 UI 不能阻止下载；
  // 改显式下载后，「跳过版本」分支直接 return 即完全不下载，退出也不会安装。
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    ensureDevAppUpdateConfig();
  }

  autoUpdater.on('checking-for-update', () => {
    flog('[AutoUpdater] Checking for updates...');
    sendToRenderer('update-checking');
    if (onStateChange) onStateChange({ configured: true, phase: 'checking', hasUpdate: false, downloaded: false, error: null });
  });

  autoUpdater.on('update-available', (info) => {
    flog('[AutoUpdater] Update available:', info.version);
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

    // 商用发布包：发现新版本后自动开始下载（autoInstallOnAppQuit 会在退出时安装）
    startUpdateDownload('auto');

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
    flog('[AutoUpdater] No updates available, current:', app.getVersion());
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
    flog('[AutoUpdater] Update downloaded:', info.version);
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
    flog('[AutoUpdater] ERROR: Error:', error.message);
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
    flog('[AutoUpdater] ERROR: checkForUpdates failed:', err.message);
    isManualCheck = false;
  });
}

function quitAndInstall() {
  if (!updateDownloaded) {
    flog('[AutoUpdater] WARN: quitAndInstall called but no update downloaded');
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
  if (typeof broadcastToRenderer === 'function') {
    try {
      broadcastToRenderer(channel, data);
      return;
    } catch {
      /* fall through to legacy path */
    }
  }
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
        flog('[AutoUpdater] WARN: AI_CONTENT_UPDATE_URL must use HTTPS.');
        return false;
      }
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: parsed.toString()
      });
      flog('[AutoUpdater] Using update feed from AI_CONTENT_UPDATE_URL.');
      return true;
    } catch (err) {
      flog('[AutoUpdater] WARN: Invalid AI_CONTENT_UPDATE_URL:', err.message);
      return false;
    }
  }

  const packagedUpdateConfig = app.isPackaged
    ? path.join(process.resourcesPath, 'app-update.yml')
    : null;
  if (!packagedUpdateConfig || !fs.existsSync(packagedUpdateConfig)) {
    return false;
  }

  const packagedUpdateUrl = readGenericUpdateUrl(packagedUpdateConfig);
  if (!packagedUpdateUrl) {
    flog('[AutoUpdater] WARN: packaged app-update.yml has no update URL.');
    return false;
  }

  flog('[AutoUpdater] Using update feed from packaged app-update.yml.');
  try {
    const parsed = new URL(packagedUpdateUrl);
    if (parsed.protocol !== 'https:') {
      flog('[AutoUpdater] WARN: packaged app-update.yml update URL must use HTTPS.');
      return false;
    }
    return true;
  } catch (err) {
    flog('[AutoUpdater] WARN: packaged app-update.yml update URL is invalid:', err.message);
    return false;
  }
}

function readGenericUpdateUrl(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^\s*url:\s*['"]?([^'"\r\n#]*)['"]?\s*$/m);
    return match ? match[1].trim() : '';
  } catch (err) {
    flog('[AutoUpdater] WARN: failed to read app-update.yml:', err.message);
    return '';
  }
}

function destroy() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
}

function downloadUpdate() {
  if (!updatesConfigured) {
    flog('[AutoUpdater] WARN: Cannot download: update feed not configured');
    return false;
  }
  autoUpdater.downloadUpdate().catch((err) => {
    flog('[AutoUpdater] ERROR: downloadUpdate failed:', err.message);
  });
  return true;
}

/**
 * 按模式触发更新下载。
 * - 'auto'：发现新版本后自动下载（商用发布包默认行为，下载完成后退出时安装）
 * - 'manual'：用户手动触发
 */
function startUpdateDownload(mode = 'manual') {
  if (mode === 'auto' && !updatesConfigured) {
    flog('[AutoUpdater] WARN: Cannot auto-download: update feed not configured');
    return false;
  }
  return downloadUpdate();
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

function ensureDevAppUpdateConfig() {
  const devPath = path.join(app.getAppPath(), "dev-app-update.yml");
  if (fs.existsSync(devPath)) return;
  try {
    fs.writeFileSync(
      devPath,
      "provider: generic\nurl: ''\nupdaterCacheDirName: ai-content-desktop-updater\n"
    );
    flog(`[AutoUpdater] Created dev config: ${devPath}`);
  } catch (err) {
    flog(`[AutoUpdater] WARN: failed to create dev-app-update.yml: ${err.message}`);
  }
}

module.exports = { setupAutoUpdater, checkForUpdates, quitAndInstall, destroy, downloadUpdate, startUpdateDownload, skipUpdate, getSkippedVersion, getUpdateFeedInfo };
