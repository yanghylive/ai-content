const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog } = require('electron');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
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
let agentSService = null;
let backendService = null;
let cloudAPI = null;
let isQuitting = false;
let isManualRestart = false;
let pythonRestartCount = 0;
let pythonRestartTimer = null;
let agentSRestartCount = 0;
let agentSRestartTimer = null;
let backendRestartCount = 0;
let backendRestartTimer = null;
const PYTHON_MAX_RESTARTS = 5;
const PYTHON_RESTART_RESET_MINUTES = 10;
const AGENT_S_MAX_RESTARTS = 5;
const AGENT_S_RESTART_RESET_MINUTES = 10;
const BACKEND_MAX_RESTARTS = 5;
const BACKEND_RESTART_RESET_MINUTES = 10;
const FRONTEND_PORT = 3010;
const BACKEND_PORT = 3011;
const PYTHON_PORT = 5409;
const AGENT_S_PORT = 17777;
const DEFAULT_DATABASE_URL = 'postgresql://postgres:ai_content_2026@127.0.0.1:5432/ai_content?schema=public';
const AGENT_S_TOKEN = 'change-me-local-token';

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

let frontendServer = null;
let frontendServerUrl = null;

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

function getBundledAssetPath(fileName) {
  const candidates = [
    path.join(__dirname, 'assets', fileName),
    getResourcePath(path.join('assets', fileName))
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function resolveFrontendAsset(frontendRoot, requestPath) {
  const safeRoot = path.resolve(frontendRoot);
  const decodedPath = decodeURIComponent(requestPath.split('?')[0] || '/');
  const normalizedPath = decodedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const candidates = [];

  if (!normalizedPath) {
    candidates.push('index.html');
  } else {
    candidates.push(normalizedPath);
    if (!path.extname(normalizedPath)) {
      candidates.push(`${normalizedPath}.html`);
      candidates.push(path.join(normalizedPath, 'index.html'));
    }
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(safeRoot, candidate);
    if (resolved !== safeRoot && !resolved.startsWith(`${safeRoot}${path.sep}`)) {
      continue;
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  if (normalizedPath && (path.extname(normalizedPath) || normalizedPath.startsWith('_next/'))) {
    return null;
  }

  candidates.push('index.html');
  for (const candidate of candidates.slice(-1)) {
    const resolved = path.resolve(safeRoot, candidate);
    if (resolved === safeRoot || !resolved.startsWith(`${safeRoot}${path.sep}`)) {
      continue;
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  return null;
}

function createFrontendStaticServer(frontendRoot) {
  return http.createServer((req, res) => {
    try {
      const filePath = resolveFrontendAsset(frontendRoot, req.url || '/');
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': getMimeType(filePath),
        'Cache-Control': filePath.includes(`${path.sep}_next${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error('[Frontend] Static server error:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
    }
  });
}

async function listenFrontendServer(frontendRoot, port) {
  return new Promise((resolve, reject) => {
    const server = createFrontendStaticServer(frontendRoot);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function startFrontendServer() {
  if (!app.isPackaged) {
    frontendServerUrl = 'http://localhost:3010';
    return frontendServerUrl;
  }

  const frontendRoot = getResourcePath('frontend');
  const indexPath = path.join(frontendRoot, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`前端资源缺失: ${indexPath}`);
  }

  const candidatePorts = [FRONTEND_PORT, 3012, 3013, 3014, 0];
  let lastError = null;
  for (const port of candidatePorts) {
    try {
      frontendServer = await listenFrontendServer(frontendRoot, port);
      const address = frontendServer.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      frontendServerUrl = `http://127.0.0.1:${actualPort}`;
      console.log('[Frontend] Static server started:', frontendServerUrl);
      return frontendServerUrl;
    } catch (err) {
      lastError = err;
      console.warn(`[Frontend] Port ${port} unavailable:`, err.message);
    }
  }

  throw new Error(`前端本地服务启动失败: ${lastError?.message || 'unknown error'}`);
}

function stopFrontendServer() {
  if (frontendServer) {
    frontendServer.close();
    frontendServer = null;
    frontendServerUrl = null;
  }
}

// 创建主窗口
function createWindow() {
  const { width, height } = store.get('windowBounds');
  const iconPath = getBundledAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  
  const windowOptions = {
    width,
    height,
    minWidth: 1200,
    minHeight: 700,
    title: 'KaypalAI内容创作平台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  if (iconPath) {
    windowOptions.icon = iconPath;
  } else {
    console.warn('[Desktop] App icon is missing, continuing without explicit window icon');
  }

  mainWindow = new BrowserWindow(windowOptions);

  // 加载前端
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3010');
    mainWindow.webContents.openDevTools();
  } else {
    if (!frontendServerUrl) {
      throw new Error('前端本地服务未启动');
    }
    mainWindow.loadURL(frontendServerUrl);
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

// 需要的 Python 版本 (auto-upload/README.md: 3.12+)
const REQUIRED_PYTHON_MAJOR = 3;
const REQUIRED_PYTHON_MINOR = 12;

// 比较 v(x,y) >= REQUIRED
function pythonVersionAtLeast(versionStr) {
  const m = (versionStr || '').match(/Python\s+(\d+)\.(\d+)/);
  if (!m) return false;
  const [_, maj, min] = m;
  if (parseInt(maj) > REQUIRED_PYTHON_MAJOR) return true;
  if (parseInt(maj) < REQUIRED_PYTHON_MAJOR) return false;
  return parseInt(min) >= REQUIRED_PYTHON_MINOR;
}

function readInstallerPythonManifest() {
  const manifestPath = getResourcePath('installer/deps-manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return manifest?.deps?.python || {};
  } catch (err) {
    console.warn('[Python] Unable to read installer deps manifest:', err.message);
    return {};
  }
}

function expandWindowsPath(rawPath) {
  if (!rawPath || process.platform !== 'win32') return rawPath;
  let expanded = rawPath;
  if (expanded.startsWith('resources\\') || expanded.startsWith('resources/')) {
    expanded = path.join(process.resourcesPath, expanded.slice('resources'.length));
  }
  return expanded.replace(/%([^%]+)%/g, (_, key) => process.env[key] || process.env[key.toUpperCase()] || `%${key}%`);
}

function buildPythonCandidates() {
  if (process.platform !== 'win32') {
    return [
      { label: 'python3', command: 'python3', args: [] },
      { label: 'python', command: 'python', args: [] }
    ];
  }

  const manifestPython = readInstallerPythonManifest();
  const candidatePaths = [
    ...(Array.isArray(manifestPython.runtimeCandidates) ? manifestPython.runtimeCandidates : []),
    manifestPython.path,
    manifestPython.installedPath,
    manifestPython.pythonPath,
    manifestPython.executable,
    path.join(process.resourcesPath, 'runtime', 'python', 'python.exe'),
    path.join(process.resourcesPath, 'python', 'python.exe'),
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files (x86)\\Python312\\python.exe',
    '%LocalAppData%\\Programs\\Python\\Python312\\python.exe',
    'C:\\Python312\\python.exe'
  ];

  const candidates = [];
  const seen = new Set();
  for (const rawPath of candidatePaths) {
    const expandedPath = expandWindowsPath(rawPath);
    if (!expandedPath || seen.has(expandedPath.toLowerCase())) continue;
    seen.add(expandedPath.toLowerCase());
    candidates.push({ label: expandedPath, command: expandedPath, args: [], requiresPath: true });
  }

  candidates.push(
    { label: 'py -3.12', command: 'py', args: ['-3.12'] },
    { label: 'python', command: 'python', args: [] },
    { label: 'python3', command: 'python3', args: [] }
  );
  return candidates;
}

function runPythonCandidate(candidate, args, options = {}) {
  const command = candidate.command;
  const commandArgs = [...(candidate.args || []), ...args];
  return execFileSync(command, commandArgs, {
    ...options,
    stdio: 'pipe',
    windowsHide: true
  });
}

function formatCommand(candidate, args) {
  return [candidate.command, ...(candidate.args || []), ...args]
    .map((part) => /\s/.test(part) ? `"${part}"` : part)
    .join(' ');
}

function errorOutput(err) {
  return [err?.stderr, err?.stdout]
    .filter(Boolean)
    .map((buf) => buf.toString().trim())
    .filter(Boolean)
    .join('\n');
}

function buildNodeCandidates() {
  if (process.platform !== 'win32') {
    return [
      path.join(process.resourcesPath || '', 'runtime', 'node', 'node'),
      path.join(process.resourcesPath || '', 'node', 'node'),
      execSync('which node').toString().trim()
    ].filter(Boolean);
  }

  return [
    path.join(process.resourcesPath || '', 'runtime', 'node', 'node.exe'),
    path.join(process.resourcesPath || '', 'node', 'node.exe'),
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    process.env.NODE_EXE,
    'node'
  ].filter(Boolean);
}

function resolveNodeBinary() {
  if (app.isPackaged) {
    return process.execPath;
  }

  const attempts = [];
  for (const candidate of buildNodeCandidates()) {
    if (candidate !== 'node' && !fs.existsSync(candidate)) {
      attempts.push(`${candidate}: not found`);
      continue;
    }
    try {
      const out = execFileSync(candidate, ['--version'], {
        stdio: 'pipe',
        windowsHide: true,
        timeout: 10000
      }).toString().trim();
      console.log(`[Backend] Found Node runtime ${out} at ${candidate}`);
      return candidate;
    } catch (err) {
      attempts.push(`${candidate}: ${errorOutput(err) || err.message}`);
    }
  }

  console.error('[Backend] Node runtime not found:', attempts.join('\n'));
  return null;
}

// 确保 Python 虚拟环境存在
// runtimeName: 'auto-upload'（默认）或 'agent-s-executor'
// Windows 下两个 sidecar 各自独立 venv，避免依赖冲突
function ensurePythonVenv(autoUploadPath, runtimeName = 'auto-upload') {
  const venvName = runtimeName === 'agent-s-executor'
    ? 'agent-s-executor-venv'
    : 'auto-upload-venv';
  const venvDir = process.platform === 'win32'
    ? path.join(app.getPath('userData'), 'runtime', venvName)
    : path.join(autoUploadPath, '.venv');
  const venvPath = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
  fs.mkdirSync(path.dirname(venvDir), { recursive: true });

  // 如果已有 venv,先检查里面 Python 版本 (上一轮可能用 3.11 建过,需要重建)
  if (fs.existsSync(venvPath)) {
    try {
      const ver = execSync(`"${venvPath}" --version`, { stdio: 'pipe' }).toString().trim();
      if (pythonVersionAtLeast(ver)) {
        return venvPath;
      }
      console.log(`[Python] Existing venv has ${ver}, need Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+, rebuilding`);
      fs.rmSync(venvDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[Python] Existing venv broken, rebuilding:', e.message);
      try { fs.rmSync(venvDir, { recursive: true, force: true }); } catch {}
    }
  }

  console.log('[Python] Virtual environment not found, creating...');
  const candidates = buildPythonCandidates();
  let pythonCandidate = null;
  let foundVersion = null;
  const attempts = [];
  for (const candidate of candidates) {
    if (candidate.requiresPath && !fs.existsSync(candidate.command)) {
      attempts.push(`${candidate.label}: not found`);
      continue;
    }
    try {
      const out = runPythonCandidate(candidate, ['--version']).toString().trim();
      if (out) {
        if (!pythonVersionAtLeast(out)) {
          attempts.push(`${candidate.label}: ${out} (too old)`);
          console.log(`[Python] ${out} via '${candidate.label}' is too old (need ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+), skipping`);
          continue;
        }
        pythonCandidate = candidate;
        foundVersion = out;
        console.log(`[Python] Found ${out} via '${candidate.label}'`);
        break;
      }
    } catch (err) {
      attempts.push(`${candidate.label}: ${errorOutput(err) || err.message}`);
    }
  }
  if (!pythonCandidate) {
    return {
      error: 'python_version_too_old',
      required: `${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+`,
      found: foundVersion,
      detail: attempts.join('\n')
    };
  }

  // 清残留半成品 .venv (上轮建失败留下的)
  if (fs.existsSync(venvDir)) {
    console.log('[Python] Removing partial .venv from previous attempt');
    try {
      fs.rmSync(venvDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[Python] Failed to remove .venv:', e.message);
    }
  }

  try {
    runPythonCandidate(pythonCandidate, ['-m', 'venv', venvDir], {
      cwd: autoUploadPath,
      timeout: 60000
    });
    console.log('[Python] Virtual environment created');

    // 安装依赖
    const pipPath = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'pip.exe')
      : path.join(venvDir, 'bin', 'pip');
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
    return {
      error: 'venv_create_failed',
      pythonPath: pythonCandidate.command,
      pythonVersion: foundVersion,
      command: formatCommand(pythonCandidate, ['-m', 'venv', venvDir]),
      stderr: errorOutput(err),
      detail: [
        `Python: ${pythonCandidate.command}`,
        `Version: ${foundVersion || 'unknown'}`,
        `Command: ${formatCommand(pythonCandidate, ['-m', 'venv', venvDir])}`,
        `stderr: ${errorOutput(err) || err.message}`
      ].join('\n')
    };
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

  const pythonResult = ensurePythonVenv(autoUploadPath);

  if (typeof pythonResult === 'object' && pythonResult?.error) {
    let msg;
    if (pythonResult.error === 'python_not_found' || pythonResult.error === 'python_version_too_old') {
      msg = `找不到满足要求的 Python (需要 ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+)。\n\n` +
            `开始菜单 → "AI 内容创作平台" → "修复安装" 重装依赖。\n\n` +
            `如果重装后还这样,手动下 Python 3.12: https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe (装时勾 "Add to PATH")`;
    } else if (pythonResult.error === 'venv_create_failed') {
      msg = `无法创建 Python 虚拟环境 (需要 Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+):\n\n${pythonResult.detail || ''}\n\n手动检查: 开始菜单 → "修复安装" 重装依赖`;
    } else {
      msg = `无法创建 Python 虚拟环境: ${pythonResult.error}`;
    }
    dialog.showErrorBox('服务启动失败', msg);
    return;
  }

  const pythonPath = pythonResult;

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

// 启动 Agent-S sidecar
async function startAgentSService() {
  const portInUse = await isPortInUse(AGENT_S_PORT);
  if (portInUse) {
    console.log(`[Agent-S] Port ${AGENT_S_PORT} already in use, skipping start`);
    return;
  }

  const agentSPath = getResourcePath('agent-s-executor');
  const serviceEntry = path.join(agentSPath, 'main.py');
  const requirementsPath = path.join(agentSPath, 'requirements.txt');

  if (!fs.existsSync(serviceEntry) || !fs.existsSync(requirementsPath)) {
    const missing = !fs.existsSync(serviceEntry) ? serviceEntry : requirementsPath;
    if (app.isPackaged) {
      dialog.showErrorBox('Agent-S 资源缺失',
        `Agent-S sidecar 未打包或未配置，微信/桌面自动化不可用。\n\n缺失路径：${missing}`);
    } else {
      console.warn(`[Agent-S] Skipped (dev mode): sidecar not found at ${missing}`);
    }
    return;
  }

  const pythonResult = ensurePythonVenv(agentSPath, 'agent-s-executor');
  if (typeof pythonResult === 'object' && pythonResult?.error) {
    dialog.showErrorBox('Agent-S 启动失败',
      `无法准备 Agent-S Python 环境:\n\n${pythonResult.detail || pythonResult.error}\n\n请从开始菜单运行「修复安装」，或重新安装 KaypalAI。`);
    return;
  }

  const pythonPath = pythonResult;
  const artifactRoot = path.join(app.getPath('userData'), 'agent-s-artifacts');
  fs.mkdirSync(artifactRoot, { recursive: true });

  console.log('[Agent-S] Starting sidecar from:', agentSPath);
  agentSService = spawn(pythonPath, ['-u', 'main.py'], {
    cwd: agentSPath,
    env: {
      ...process.env,
      KAYPAL_AGENT_S_HOST: '127.0.0.1',
      KAYPAL_AGENT_S_PORT: String(AGENT_S_PORT),
      KAYPAL_AGENT_S_TOKEN: AGENT_S_TOKEN,
      KAYPAL_AGENT_S_RUNNER_MODE: process.env.KAYPAL_AGENT_S_RUNNER_MODE || 'mock',
      KAYPAL_AGENT_S_ARTIFACT_ROOT: artifactRoot
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  agentSService.stdout.on('data', (data) => {
    console.log('[Agent-S]', data.toString().trim());
  });

  agentSService.stderr.on('data', (data) => {
    console.error('[Agent-S Error]', data.toString().trim());
  });

  agentSService.on('close', (code) => {
    console.log(`[Agent-S] Sidecar exited with code ${code}`);
    agentSService = null;
    if (isQuitting) return;

    if (store.get('autoStartService')) {
      agentSRestartCount++;

      if (agentSRestartTimer) clearTimeout(agentSRestartTimer);
      agentSRestartTimer = setTimeout(() => {
        agentSRestartCount = 0;
      }, AGENT_S_RESTART_RESET_MINUTES * 60 * 1000);

      if (agentSRestartCount > AGENT_S_MAX_RESTARTS) {
        console.error(`[Agent-S] Sidecar crashed ${AGENT_S_MAX_RESTARTS} times, stopping auto-restart`);
        return;
      }

      const delay = Math.min(3000 * agentSRestartCount, 30000);
      console.log(`[Agent-S] Restarting in ${delay / 1000}s (attempt ${agentSRestartCount}/${AGENT_S_MAX_RESTARTS})...`);
      setTimeout(startAgentSService, delay);
    }
  });

  agentSService.on('error', (err) => {
    console.error('[Agent-S] Failed to start:', err.message);
  });
}

function stopAgentSService() {
  if (agentSService) {
    console.log('[Agent-S] Stopping sidecar...');
    agentSService.kill('SIGTERM');
    setTimeout(() => {
      if (agentSService && !agentSService.killed) {
        agentSService.kill('SIGKILL');
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

  if (!envVars.DATABASE_URL || envVars.DATABASE_URL.startsWith('file:')) {
    envVars.DATABASE_URL = DEFAULT_DATABASE_URL;
  }
  envVars.REDIS_DISABLED = envVars.REDIS_DISABLED || 'true';
  envVars.AGENT_S_BASE_URL = envVars.AGENT_S_BASE_URL || `http://127.0.0.1:${AGENT_S_PORT}`;
  envVars.KAYPAL_RUNTIME_SHARED_SECRET = envVars.KAYPAL_RUNTIME_SHARED_SECRET || AGENT_S_TOKEN;
  envVars.KAYPAL_AGENT_S_TOKEN = envVars.KAYPAL_AGENT_S_TOKEN || AGENT_S_TOKEN;

  const allowedCorsOrigins = new Set(
    (envVars.CORS_ORIGIN || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
  allowedCorsOrigins.add('http://localhost:3010');
  allowedCorsOrigins.add('http://127.0.0.1:3010');
  if (frontendServerUrl) {
    allowedCorsOrigins.add(frontendServerUrl);
  }
  envVars.CORS_ORIGIN = Array.from(allowedCorsOrigins).join(',');

  const prismaEngineCandidates = process.platform === 'win32'
    ? [
        path.join(backendPath, 'client', 'query_engine-windows.dll.node'),
        path.join(backendPath, 'client', 'libquery_engine-windows.dll.node')
      ]
    : [];
  const prismaEnginePath = prismaEngineCandidates.find((candidate) => fs.existsSync(candidate));
  if (prismaEnginePath) {
    envVars.PRISMA_QUERY_ENGINE_LIBRARY = prismaEnginePath;
  }

  const nodeBin = resolveNodeBinary();
  if (!nodeBin) {
    dialog.showErrorBox('服务启动失败',
      '找不到 Node.js 运行环境，后端服务无法启动。\n\n请从开始菜单运行「修复安装」，或重新安装 KaypalAI 内容创作平台。');
    return;
  }

  backendService = spawn(nodeBin, ['index.js'], {
    cwd: backendPath,
    env: {
      ...envVars,
      ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
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
  const resolvedIconPath = getBundledAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png') || iconPath;
  if (!fs.existsSync(resolvedIconPath)) {
    console.warn('[Tray] Icon missing, tray disabled:', resolvedIconPath);
    return;
  }

  try {
    tray = new Tray(resolvedIconPath);
  } catch (err) {
    console.error('[Tray] Failed to create tray, continuing without tray:', err.message);
    return;
  }

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
    label: '重启 Agent-S',
    click: () => {
      stopAgentSService();
      setTimeout(startAgentSService, 1000);
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
    stopAgentSService();
    stopBackendService();
    setTimeout(() => {
      startPythonService();
      startAgentSService();
      startBackendService();
    }, 1000);
    return { success: true };
  });

  ipcMain.handle('service:status', () => {
    return {
      python: {
        running: pythonService && !pythonService.killed,
        pid: pythonService ? pythonService.pid : null
      },
      agentS: {
        running: agentSService && !agentSService.killed,
        pid: agentSService ? agentSService.pid : null
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
app.whenReady().then(async () => {
  // 初始化云端 API
  cloudAPI = new CloudAPI({
    endpoint: store.get('cloudApiEndpoint'),
    token: store.get('apiToken'),
    appVersion: app.getVersion()
  });

  await startFrontendServer();

  // 创建窗口
  createWindow();

  // 创建系统托盘
  createTray();

  // 设置 IPC
  setupIPC();

  // 启动本地执行 sidecars
  if (store.get('autoStartService')) {
    startPythonService();
    startAgentSService();
  }

  // 启动后端服务
  if (store.get('autoStartService')) {
    startBackendService();
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
  stopFrontendServer();
  stopPythonService();
  stopAgentSService();
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
