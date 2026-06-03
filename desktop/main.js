const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const Store = require('electron-store');
const fixPath = require('fix-path');
const CloudAPI = require('./cloud-api');
const { setupAutoUpdater, checkForUpdates, quitAndInstall, destroy: destroyUpdater, downloadUpdate, skipUpdate, getSkippedVersion, getUpdateFeedInfo } = require('./auto-updater');

// 修复 macOS PATH 问题
fixPath();

// 配置持久化存储
const store = new Store({
  defaults: {
    windowBounds: { width: 1400, height: 900 },
    cloudApiEndpoint: 'https://enterprise-test.kaypal.cn/cloud-api',
    apiToken: '',
    autoStartService: true,
    lastLoginUser: ''
  }
});

let mainWindow = null;
let tray = null;
let pythonService = null;
let backendService = null;
let cloudAPI = null;
let isQuitting = false;
let isManualRestart = false;
let pythonRestartCount = 0;
let pythonRestartTimer = null;
let backendRestartCount = 0;
let backendRestartTimer = null;
const PYTHON_MAX_RESTARTS = 5;
const PYTHON_RESTART_RESET_MINUTES = 10;
const BACKEND_MAX_RESTARTS = 5;
const BACKEND_RESTART_RESET_MINUTES = 10;
const BACKEND_PORT = 3011;
const PYTHON_PORT = 5409;

let pendingUpdate = {
  configured: false,
  phase: 'idle',
  hasUpdate: false,
  downloaded: false,
  version: null,
  releaseDate: null,
  releaseNotes: null,
  progress: 0,
  error: null,
  envUrl: null,
};

// 获取资源路径（开发/生产环境不同）
function getResourcePath(relativePath) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  }
  if (process.env.AUTO_UPLOAD_DIR && relativePath === 'auto-upload') {
    return process.env.AUTO_UPLOAD_DIR;
  }
  return path.join(__dirname, '..', relativePath);
}

// 创建主窗口
function createWindow() {
  const { width, height } = store.get('windowBounds');
  
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1200,
    minHeight: 700,
    title: 'KaypalAI内容创作平台',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 加载前端
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3010');
    mainWindow.webContents.openDevTools();
  } else {
    const frontendPath = getResourcePath('frontend/index.html');
    mainWindow.loadFile(frontendPath);
  }

  // 保存窗口大小
  mainWindow.on('resize', () => {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', { width: bounds.width, height: bounds.height });
  });

  // 外部链接在浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 确保 Python 虚拟环境存在
function ensurePythonVenv(autoUploadPath) {
  const venvPath = process.platform === 'win32'
    ? path.join(autoUploadPath, '.venv', 'Scripts', 'python.exe')
    : path.join(autoUploadPath, '.venv', 'bin', 'python');

  if (fs.existsSync(venvPath)) {
    return venvPath;
  }

  console.log('[Python] Virtual environment not found, creating...');
  const pythonBin = process.platform === 'win32' ? 'python' : 'python3';

  try {
    execSync(`${pythonBin} -m venv "${path.join(autoUploadPath, '.venv')}"`, {
      cwd: autoUploadPath,
      timeout: 60000,
      stdio: 'pipe'
    });
    console.log('[Python] Virtual environment created');

    // 安装依赖
    const pipPath = process.platform === 'win32'
      ? path.join(autoUploadPath, '.venv', 'Scripts', 'pip.exe')
      : path.join(autoUploadPath, '.venv', 'bin', 'pip');
    const requirementsPath = path.join(autoUploadPath, 'requirements.txt');

    if (fs.existsSync(requirementsPath)) {
      console.log('[Python] Installing dependencies...');
      execSync(`"${pipPath}" install -r "${requirementsPath}"`, {
        cwd: autoUploadPath,
        timeout: 300000,
        stdio: 'pipe'
      });
      console.log('[Python] Dependencies installed');
    }
  } catch (err) {
    console.error('[Python] Failed to create virtual environment:', err.message);
    return null;
  }

  return venvPath;
}

// 启动 Python 服务
async function startPythonService() {
  const portInUse = await isPortInUse(PYTHON_PORT);
  if (portInUse) {
    console.log(`[Python] Port ${PYTHON_PORT} already in use, skipping start (assuming external local-engine)`);
    return;
  }

  const autoUploadPath = getResourcePath('auto-upload');
  const serviceEntry = path.join(autoUploadPath, 'main.py');
  const requirementsPath = path.join(autoUploadPath, 'requirements.txt');

  if (!fs.existsSync(serviceEntry) || !fs.existsSync(requirementsPath)) {
    const missing = !fs.existsSync(serviceEntry) ? serviceEntry : requirementsPath;
    if (app.isPackaged) {
      dialog.showErrorBox('服务资源缺失',
        `auto-upload 服务未打包或未配置，无法启动商用执行器。\n\n缺失路径：${missing}`);
    } else {
      console.warn(`[Python] Skipped (dev mode): auto-upload not found at ${missing}`);
      console.warn('[Python] Set AUTO_UPLOAD_DIR to enable. e.g. AUTO_UPLOAD_DIR=/Users/yanghy/auto-upload npm run dev');
    }
    return;
  }

  const pythonPath = ensurePythonVenv(autoUploadPath);

  if (!pythonPath) {
    dialog.showErrorBox('服务启动失败',
      '无法创建 Python 虚拟环境。请确保已安装 Python 3.12+。');
    return;
  }

  console.log('[Python] Starting service from:', autoUploadPath);
  console.log('[Python] Using Python at:', pythonPath);

  pythonService = spawn(pythonPath, ['-u', 'main.py'], {
    cwd: autoUploadPath,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PORT: '5409'
    }
  });

  pythonService.stdout.on('data', (data) => {
    console.log('[Python]', data.toString());
  });

  pythonService.stderr.on('data', (data) => {
    console.error('[Python Error]', data.toString());
  });

  pythonService.on('close', (code) => {
    console.log(`[Python] Service exited with code ${code}`);
    pythonService = null;

    // 手动重启时不由 close 事件触发重启
    if (isManualRestart) {
      isManualRestart = false;
      return;
    }

    // 退出时不重启
    if (isQuitting) return;

    // 自动重启：带退避和重试限制
    if (store.get('autoStartService')) {
      pythonRestartCount++;

      // 10 分钟后重置计数
      if (pythonRestartTimer) clearTimeout(pythonRestartTimer);
      pythonRestartTimer = setTimeout(() => {
        pythonRestartCount = 0;
      }, PYTHON_RESTART_RESET_MINUTES * 60 * 1000);

      if (pythonRestartCount > PYTHON_MAX_RESTARTS) {
        console.error(`[Python] Service crashed ${PYTHON_MAX_RESTARTS} times in ${PYTHON_RESTART_RESET_MINUTES} minutes, stopping auto-restart`);
        if (mainWindow) {
          dialog.showErrorBox('服务异常',
            `Python 服务在 ${PYTHON_RESTART_RESET_MINUTES} 分钟内崩溃了 ${PYTHON_MAX_RESTARTS} 次，已停止自动重启。请检查日志或手动重启。`);
        }
        return;
      }

      const delay = Math.min(3000 * pythonRestartCount, 30000);
      console.log(`[Python] Restarting service in ${delay / 1000} seconds (attempt ${pythonRestartCount}/${PYTHON_MAX_RESTARTS})...`);
      setTimeout(startPythonService, delay);
    }
  });

  pythonService.on('error', (err) => {
    console.error('[Python] Failed to start service:', err);
    dialog.showErrorBox('服务启动失败',
      `Python 服务启动失败: ${err.message}\n\n请确保已安装 Python 3.12+ 并运行过 pip install。`);
  });
}

// 停止 Python 服务
function stopPythonService() {
  if (pythonService) {
    console.log('[Python] Stopping service...');
    pythonService.kill('SIGTERM');
    setTimeout(() => {
      if (pythonService && !pythonService.killed) {
        pythonService.kill('SIGKILL');
      }
    }, 5000);
  }
}

// 检查端口是否被占用（用 0.0.0.0 避免漏掉 bound-on-all-interfaces 的进程）
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '0.0.0.0');
  });
}

// 启动后端服务
async function startBackendService() {
  const portInUse = await isPortInUse(BACKEND_PORT);
  if (portInUse) {
    console.log(`[Backend] Port ${BACKEND_PORT} already in use, skipping start`);
    return;
  }

  const backendPath = getResourcePath('backend');
  const mainJsPath = path.join(backendPath, 'index.js');

  if (!fs.existsSync(mainJsPath)) {
    console.warn('[Backend] dist/main.js not found, backend will not be started');
    return;
  }

  console.log('[Backend] Starting service from:', backendPath);

  const envFile = path.join(backendPath, '.env');
  const envVars = { ...process.env, PORT: String(BACKEND_PORT), NODE_ENV: 'production' };

  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!envVars[key]) {
          envVars[key] = value;
        }
      }
    }
  }

  const dbPath = path.join(backendPath, 'prisma', 'dev.db');
  envVars.DATABASE_URL = `file:${dbPath}`;

  const nodeBin = process.platform === 'win32' ? 'node' : execSync('which node').toString().trim();

  backendService = spawn(nodeBin, ['index.js'], {
    cwd: backendPath,
    env: envVars,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendService.stdout.on('data', (data) => {
    console.log('[Backend]', data.toString().trim());
  });

  backendService.stderr.on('data', (data) => {
    console.error('[Backend Error]', data.toString().trim());
  });

  backendService.on('close', (code) => {
    console.log(`[Backend] Service exited with code ${code}`);
    backendService = null;

    if (isQuitting) return;

    if (store.get('autoStartService')) {
      backendRestartCount++;

      if (backendRestartTimer) clearTimeout(backendRestartTimer);
      backendRestartTimer = setTimeout(() => {
        backendRestartCount = 0;
      }, BACKEND_RESTART_RESET_MINUTES * 60 * 1000);

      if (backendRestartCount > BACKEND_MAX_RESTARTS) {
        console.error(`[Backend] Service crashed ${BACKEND_MAX_RESTARTS} times, stopping auto-restart`);
        return;
      }

      const delay = Math.min(3000 * backendRestartCount, 30000);
      console.log(`[Backend] Restarting in ${delay / 1000}s (attempt ${backendRestartCount}/${BACKEND_MAX_RESTARTS})...`);
      setTimeout(startBackendService, delay);
    }
  });

  backendService.on('error', (err) => {
    console.error('[Backend] Failed to start:', err.message);
  });
}

// 停止后端服务
function stopBackendService() {
  if (backendService) {
    console.log('[Backend] Stopping service...');
    backendService.kill('SIGTERM');
    setTimeout(() => {
      if (backendService && !backendService.killed) {
        backendService.kill('SIGKILL');
      }
    }, 5000);
  }
}

// 创建系统托盘
function createTray() {
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  tray = new Tray(iconPath);

  refreshTray();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function buildTrayMenu() {
  const items = [
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' }
  ];

  if (pendingUpdate.configured === false) {
    items.push({ label: '自动更新未配置', enabled: false });
  } else if (pendingUpdate.hasUpdate && !pendingUpdate.downloaded) {
    items.push({
      label: `🆕 下载更新 v${pendingUpdate.version}`,
      click: () => downloadUpdate()
    });
  } else if (pendingUpdate.downloaded) {
    items.push({
      label: `✅ 重启安装 v${pendingUpdate.version}`,
      click: () => quitAndInstall()
    });
  }

  if (pendingUpdate.hasUpdate || pendingUpdate.downloaded || pendingUpdate.phase === 'error') {
    items.push({ type: 'separator' });
  }

  items.push({
    label: pendingUpdate.phase === 'checking' ? '正在检查更新...' : '检查更新',
    enabled: pendingUpdate.phase !== 'checking',
    click: () => checkForUpdates(true)
  });
  items.push({ type: 'separator' });
  items.push({
    label: '重启 Python 服务',
    click: () => {
      isManualRestart = true;
      stopPythonService();
      setTimeout(startPythonService, 1000);
    }
  });
  items.push({
    label: '重启后端服务',
    click: () => {
      stopBackendService();
      setTimeout(startBackendService, 1000);
    }
  });
  items.push({ type: 'separator' });
  items.push({
    label: '退出',
    click: () => {
      isQuitting = true;
      app.quit();
    }
  });

  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;

  let tooltip = 'KaypalAI内容创作平台';
  if (pendingUpdate.downloaded) {
    tooltip = `KaypalAI · v${pendingUpdate.version} 已下载，下次启动安装`;
  } else if (pendingUpdate.hasUpdate) {
    tooltip = `KaypalAI · 新版本 v${pendingUpdate.version} 可更新`;
  } else if (pendingUpdate.phase === 'error') {
    tooltip = `KaypalAI · 更新检查失败`;
  } else if (pendingUpdate.configured === false) {
    tooltip = 'KaypalAI · 自动更新未配置';
  }
  tray.setToolTip(tooltip);
  tray.setContextMenu(buildTrayMenu());

  if (process.platform === 'darwin' && tray.setTitle) {
    tray.setTitle(pendingUpdate.hasUpdate || pendingUpdate.downloaded ? '🆕' : '');
  }
}

function setPendingUpdate(partial) {
  pendingUpdate = { ...pendingUpdate, ...partial };
  refreshTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-state', pendingUpdate);
  }
}

// 设置 IPC 通信
function setupIPC() {
  // 云端 API 调用
  ipcMain.handle('cloud-api:generate-reply', async (event, data) => {
    return await cloudAPI.generateReply(data);
  });

  ipcMain.handle('cloud-api:check-content', async (event, data) => {
    return await cloudAPI.checkContent(data);
  });

  ipcMain.handle('cloud-api:check-dedup', async (event, data) => {
    return await cloudAPI.checkDedup(data);
  });

  ipcMain.handle('cloud-api:mark-sent', async (event, data) => {
    return await cloudAPI.markSent(data);
  });

  // 配置管理
  ipcMain.handle('config:get', (event, key) => {
    return store.get(key);
  });

  ipcMain.handle('config:set', (event, key, value) => {
    store.set(key, value);
    // 同步更新 cloudAPI 实例
    if (key === 'apiToken' && cloudAPI) {
      cloudAPI.setToken(value);
    }
    if (key === 'cloudApiEndpoint' && cloudAPI) {
      cloudAPI.setEndpoint(value);
    }
  });

  // 服务管理
  ipcMain.handle('service:restart', () => {
    isManualRestart = true;
    stopPythonService();
    stopBackendService();
    setTimeout(() => {
      startBackendService();
      startPythonService();
    }, 1000);
    return { success: true };
  });

  ipcMain.handle('service:status', () => {
    return {
      python: {
        running: pythonService && !pythonService.killed,
        pid: pythonService ? pythonService.pid : null
      },
      backend: {
        running: backendService && !backendService.killed,
        pid: backendService ? backendService.pid : null
      }
    };
  });

  // 应用控制
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:check-update', () => {
    checkForUpdates(true);
    return { success: true };
  });

  ipcMain.handle('app:install-update', () => {
    quitAndInstall();
  });

  ipcMain.handle('app:get-update-status', () => {
    return { ...pendingUpdate };
  });

  ipcMain.handle('app:download-update', () => {
    const ok = downloadUpdate();
    return { success: ok };
  });

  ipcMain.handle('app:skip-update', (_event, version) => {
    skipUpdate(version || pendingUpdate.version);
    setPendingUpdate({ hasUpdate: false, phase: 'idle', version: null });
    return { success: true };
  });

  ipcMain.handle('app:get-update-feed-info', () => {
    return getUpdateFeedInfo();
  });

  ipcMain.handle('app:get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('app:get-data-path', () => {
    return app.getPath('userData');
  });

  // 打开外部链接
  ipcMain.handle('shell:open-external', async (event, url) => {
    try {
      await shell.openExternal(url);
    } catch (err) {
      console.error('[Shell] Failed to open external URL:', err.message);
    }
  });

  // 打开文件目录
  ipcMain.handle('shell:show-item-in-folder', (event, fullPath) => {
    shell.showItemInFolder(fullPath);
  });
}

// 应用启动
app.whenReady().then(() => {
  // 初始化云端 API
  cloudAPI = new CloudAPI({
    endpoint: store.get('cloudApiEndpoint'),
    token: store.get('apiToken'),
    appVersion: app.getVersion()
  });

  // 创建窗口
  createWindow();

  // 创建系统托盘
  createTray();

  // 设置 IPC
  setupIPC();

  // 启动后端服务
  if (store.get('autoStartService')) {
    startBackendService();
  }

  // 启动 Python 服务
  if (store.get('autoStartService')) {
    startPythonService();
  }

  // 设置自动更新
  pendingUpdate.envUrl = process.env.AI_CONTENT_UPDATE_URL || null;
  setupAutoUpdater(mainWindow, { onStateChange: setPendingUpdate });

  // macOS: 点击 dock 图标时显示窗口
  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
}).catch((err) => {
  console.error('[App] Failed to initialize:', err);
  dialog.showErrorBox('启动失败', `应用初始化失败: ${err.message}`);
});

// 应用退出
app.on('before-quit', () => {
  isQuitting = true;
  stopPythonService();
  stopBackendService();
  destroyUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 安全：禁止导航到外部 URL
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'http://localhost:3010' && !navigationUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });
});
