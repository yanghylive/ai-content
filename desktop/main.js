const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog } = require('electron');
const path = require('path');
const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const Store = require('electron-store');
const fixPath = require('fix-path');
const CloudAPI = require('./cloud-api');
const { buildError: buildLocalBridgeError, createNonceCache, requestBackend: requestLocalBridgeBackend, shouldUseE2EUserData, validateRequest: validateLocalBridgeRequest } = require('./local-bridge');
const { setupAutoUpdater, checkForUpdates, quitAndInstall, destroy: destroyUpdater, downloadUpdate, skipUpdate, getSkippedVersion, getUpdateFeedInfo } = require('./auto-updater');

// 修复 macOS PATH 问题
fixPath();

function inferWindowsPackagedUserDataDir() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return null;
  }

  const execPath = (process.execPath || '').replace(/\//g, '\\');
  const marker = '\\AppData\\Local\\Programs\\';
  const markerIndex = execPath.toLowerCase().indexOf(marker.toLowerCase());
  if (markerIndex <= 0) {
    return null;
  }

  const userProfile = execPath.slice(0, markerIndex);
  if (!/^[a-z]:\\users\\[^\\]+$/i.test(userProfile)) {
    return null;
  }

  return path.join(userProfile, 'AppData', 'Roaming', 'ai-content-desktop');
}

function configureStableUserDataPath() {
  const windowsUserDataDir = inferWindowsPackagedUserDataDir();
  if (!windowsUserDataDir) {
    return;
  }

  fs.mkdirSync(windowsUserDataDir, { recursive: true });
  app.setPath('userData', windowsUserDataDir);
}

configureStableUserDataPath();

if (shouldUseE2EUserData({
  nodeEnv: process.env.NODE_ENV,
  e2eMode: process.env.KAYPAL_E2E_MODE,
  isPackaged: app.isPackaged,
  target: process.env.KAYPAL_E2E_USER_DATA_DIR,
})) {
  fs.mkdirSync(process.env.KAYPAL_E2E_USER_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.KAYPAL_E2E_USER_DATA_DIR);
}

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
let agentSService = null;
let backendService = null;
let cloudAPI = null;
let isQuitting = false;
let agentSRestartCount = 0;
let backendRestartCount = 0;
let backendStartupDiagnostic = null;
const MAX_RESTARTS = 3;
const FRONTEND_PORT = 3010;
const BACKEND_PORT = 3011;
const AGENT_S_PORT = 17777;
const BACKEND_READY_TIMEOUT_MS = 60_000;
const BACKEND_READY_INTERVAL_MS = 500;
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

function isNodeAgentRuntimeEnabled() {
  return app.isPackaged || process.env.KAYPAL_NODE_AGENT_RUNTIME === '1';
}

function isRelativeSqliteUrl(value) {
  return !value || value === 'file:' || value.startsWith('file:./') || value.startsWith('file:../');
}

function toSqliteFileUrl(filePath) {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

function resolveDesktopDatabaseEnv(envVars) {
  const mode = (envVars.KAYPAL_DESKTOP_DATABASE_MODE || process.env.KAYPAL_DESKTOP_DATABASE_MODE || 'sqlite').trim().toLowerCase();
  envVars.KAYPAL_DESKTOP_DATABASE_MODE = mode;

  if (mode === 'sqlite') {
    const databasePath = path.join(app.getPath('userData'), 'kaypal-ai.sqlite');
    const databaseUrl = toSqliteFileUrl(databasePath);
    if (isRelativeSqliteUrl(envVars.SQLITE_DATABASE_URL)) {
      envVars.SQLITE_DATABASE_URL = databaseUrl;
    }
    if (!envVars.DATABASE_URL || envVars.DATABASE_URL.startsWith('postgres') || isRelativeSqliteUrl(envVars.DATABASE_URL)) {
      envVars.DATABASE_URL = envVars.SQLITE_DATABASE_URL;
    }
    return;
  }

  if (!envVars.DATABASE_URL) {
    envVars.DATABASE_URL = DEFAULT_DATABASE_URL;
  }
}

function resolveSqliteDatabasePath(databaseUrl, cwd) {
  if (!databaseUrl || !databaseUrl.startsWith('file:')) return null;
  const rawPath = databaseUrl.slice('file:'.length);
  if (!rawPath) return null;
  const decodedPath = decodeURIComponent(rawPath);
  return path.isAbsolute(decodedPath) ? decodedPath : path.resolve(cwd, decodedPath);
}

function readSqliteHeaderAndSchemaMarkers(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 1024) return null;

  const maxBytes = Math.min(stat.size, 32 * 1024 * 1024);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function sqliteDatabaseHasRequiredSchema(filePath) {
  if (!fs.existsSync(filePath)) return false;

  try {
    const buffer = readSqliteHeaderAndSchemaMarkers(filePath);
    if (!buffer || !buffer.subarray(0, 16).toString('ascii').startsWith('SQLite format 3')) {
      return false;
    }

    const content = buffer.toString('latin1');
    const requiredMarkers = [
      'ai_models',
      'ai_platforms',
      'default_model_configs',
      'schedule_configs',
      'user_sessions',
      'users',
      'kaypal_user_id',
      'commercial_execution_allowed',
      'plan_mode',
    ];

    return requiredMarkers.every((marker) => content.includes(marker));
  } catch (error) {
    console.warn(`[Backend] Unable to inspect SQLite database ${filePath}:`, errorOutput(error) || error.message);
    return false;
  }
}

function ensureDesktopSqliteDatabase(envVars, backendPath) {
  const mode = (envVars.KAYPAL_DESKTOP_DATABASE_MODE || '').trim().toLowerCase();
  if (mode !== 'sqlite') return;

  const databasePath = resolveSqliteDatabasePath(envVars.SQLITE_DATABASE_URL || envVars.DATABASE_URL, backendPath);
  if (!databasePath) return;

  const seedPath = path.join(backendPath, 'prisma', 'dev.db');
  if (!sqliteDatabaseHasRequiredSchema(seedPath)) {
    console.warn('[Backend] SQLite seed database is missing or incomplete:', seedPath);
    return;
  }

  if (sqliteDatabaseHasRequiredSchema(databasePath)) {
    return;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  if (fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0) {
    const backupPath = `${databasePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(databasePath, backupPath);
    console.warn('[Backend] Existing SQLite database did not contain required schema, backed up to:', backupPath);
  }

  fs.copyFileSync(seedPath, databasePath);
  console.log('[Backend] SQLite database initialized from packaged seed:', databasePath);
}

function appendRuntimeLog(fileName, message) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, fileName),
      `${new Date().toISOString()} ${message}\n`
    );
  } catch (error) {
    console.warn(`[Logs] Failed to append ${fileName}:`, error.message);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function readProcessEnvCaseInsensitive(key) {
  const expected = key.toLowerCase();
  for (const [envKey, value] of Object.entries(process.env)) {
    if (envKey.toLowerCase() === expected && value) {
      return { key: envKey, value };
    }
  }
  return null;
}

function copyProcessEnvCaseInsensitive(target, key) {
  const found = readProcessEnvCaseInsensitive(key);
  if (!found) return null;
  target[found.key] = found.value;
  return found.value;
}

function inferWindowsUserProfilePaths() {
  if (process.platform !== 'win32') return {};
  const userDataPath = (app.getPath('userData') || '').replace(/\//g, '\\');
  const match = userDataPath.match(/^([a-z]:\\Users\\[^\\]+)\\AppData\\Roaming\\/i);
  if (!match) return {};
  const userProfile = match[1];
  return {
    USERPROFILE: userProfile,
    APPDATA: path.join(userProfile, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(userProfile, 'AppData', 'Local'),
  };
}

function createWindowsPackagedBaseEnv() {
  const baseEnv = {};
  const inferred = inferWindowsUserProfilePaths();
  const requiredKeys = [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'APPDATA',
    'LOCALAPPDATA',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'TEMP',
    'TMP',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'ALLUSERSPROFILE',
    'PUBLIC',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'PROCESSOR_IDENTIFIER',
    'NUMBER_OF_PROCESSORS',
  ];

  for (const key of requiredKeys) {
    copyProcessEnvCaseInsensitive(baseEnv, key);
  }

  const systemRoot =
    readProcessEnvCaseInsensitive('SystemRoot')?.value ||
    readProcessEnvCaseInsensitive('WINDIR')?.value ||
    'C:\\Windows';
  baseEnv.SystemRoot = baseEnv.SystemRoot || systemRoot;
  baseEnv.WINDIR = baseEnv.WINDIR || systemRoot;
  baseEnv.ComSpec = baseEnv.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
  baseEnv.PATHEXT = baseEnv.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';

  baseEnv.USERPROFILE = baseEnv.USERPROFILE || inferred.USERPROFILE;
  baseEnv.APPDATA = baseEnv.APPDATA || inferred.APPDATA;
  baseEnv.LOCALAPPDATA = baseEnv.LOCALAPPDATA || inferred.LOCALAPPDATA;

  const tempPath =
    readProcessEnvCaseInsensitive('TEMP')?.value ||
    readProcessEnvCaseInsensitive('TMP')?.value ||
    (baseEnv.LOCALAPPDATA ? path.join(baseEnv.LOCALAPPDATA, 'Temp') : app.getPath('temp'));
  baseEnv.TEMP = baseEnv.TEMP || tempPath;
  baseEnv.TMP = baseEnv.TMP || tempPath;
  try {
    if (tempPath) fs.mkdirSync(tempPath, { recursive: true });
  } catch (error) {
    console.warn('[Backend] Unable to ensure Windows temp directory:', error.message);
  }

  const pathValue =
    readProcessEnvCaseInsensitive('Path')?.value ||
    process.env.PATH ||
    [
      path.join(systemRoot, 'System32'),
      systemRoot,
      path.join(systemRoot, 'System32', 'Wbem'),
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(';');
  baseEnv.Path = baseEnv.Path || pathValue;
  baseEnv.PATH = baseEnv.PATH || pathValue;

  return Object.fromEntries(
    Object.entries(baseEnv).filter(([, value]) => typeof value === 'string' && value.length > 0),
  );
}

function createPackagedNodeEnv(envVars, nodeBin) {
  const baseEnv = app.isPackaged
    ? process.platform === 'win32'
      ? createWindowsPackagedBaseEnv()
      : {
          HOME: process.env.HOME,
          USER: process.env.USER,
          LOGNAME: process.env.LOGNAME || process.env.USER,
          SHELL: process.env.SHELL || '/bin/sh',
          PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
          TMPDIR: process.env.TMPDIR || '/tmp',
          LANG: process.env.LANG || 'C.UTF-8',
          LC_ALL: process.env.LC_ALL || process.env.LANG || 'C.UTF-8',
        }
    : { ...process.env };
  const childEnv = { ...baseEnv, ...envVars };

  if (app.isPackaged && nodeBin === process.execPath) {
    childEnv.ELECTRON_RUN_AS_NODE = '1';
  }

  return childEnv;
}

// 获取资源路径（开发/生产环境不同）
function getResourcePath(relativePath) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
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
    title: 'JIUZHANG AI 内容创作平台',
    autoHideMenuBar: true,
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
  mainWindow.setMenuBarVisibility(false);

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

// 需要的 Python 版本：Agent-S sidecar 使用 3.12+。
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
  // 优先级：manifest 记录的安装路径 → 系统 PATH 里的 python
  // 不再硬编码 6 个 Windows 默认安装路径（`C:\\Python312\\python.exe` 之类），
  // 让 deps-manifest.json 说话；找不到就让 `py` / `python3` 走 PATH
  const candidates = [];
  const seen = new Set();

  if (process.platform === 'win32') {
    const manifestPython = readInstallerPythonManifest();
    for (const raw of [
      ...(Array.isArray(manifestPython.runtimeCandidates) ? manifestPython.runtimeCandidates : []),
      manifestPython.path,
      manifestPython.installedPath,
      manifestPython.pythonPath,
      manifestPython.executable
    ]) {
      const expanded = expandWindowsPath(raw);
      if (expanded && !seen.has(expanded.toLowerCase())) {
        seen.add(expanded.toLowerCase());
        candidates.push({ label: expanded, command: expanded, args: [], requiresPath: true });
      }
    }
    candidates.push(
      { label: 'py -3', command: 'py', args: ['-3'] },
      { label: 'python', command: 'python', args: [] }
    );
  } else {
    candidates.push(
      { label: 'python3', command: 'python3', args: [] },
      { label: 'python', command: 'python', args: [] }
    );
  }
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
  const resourceCandidates = process.platform !== 'win32'
    ? [
        path.join(process.resourcesPath || '', 'runtime', 'node', 'bin', 'node'),
      ]
    : [
        path.join(process.resourcesPath || '', 'runtime', 'node', 'bin', 'node.exe'),
      ];

  if (app.isPackaged) {
    return resourceCandidates.filter(Boolean);
  }

  if (process.platform !== 'win32') {
    return [
      ...resourceCandidates,
      process.env.NODE_EXE,
      'node',
    ].filter(Boolean);
  }

  return [
    ...resourceCandidates,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    process.env.NODE_EXE,
    'node'
  ].filter(Boolean);
}

function resolveNodeBinary() {
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

  if (app.isPackaged) {
    console.error('[Backend] Packaged app requires bundled Node runtime:', attempts.join('\n'));
    return null;
  }

  console.error('[Backend] Node runtime not found:', attempts.join('\n'));
  return null;
}

function spawnBackendServiceProcess(nodeBin, backendEntry, backendPath, childEnv) {
  return spawn(nodeBin, [backendEntry], {
    cwd: backendPath,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// 确保 Python 虚拟环境存在
// runtimeName: 当前只保留 'agent-s-executor'。5409/auto-upload sidecar 已下线。
function ensurePythonVenv(sidecarPath, runtimeName = 'agent-s-executor') {
  if (app.isPackaged) {
    return {
      error: 'legacy_python_sidecar_disabled',
      detail: 'Packaged desktop uses the in-process Node Agent Runtime; Python sidecar and venv creation are dev-only.',
    };
  }
  const venvName = `${runtimeName}-venv`;
  const venvDir = process.platform === 'win32'
    ? path.join(app.getPath('userData'), 'runtime', venvName)
    : path.join(sidecarPath, '.venv');
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
      cwd: sidecarPath,
      timeout: 60000
    });
    console.log('[Python] Virtual environment created');

    // 安装依赖
    const pipPath = process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'pip.exe')
      : path.join(venvDir, 'bin', 'pip');
    const requirementsPath = path.join(sidecarPath, 'requirements.txt');

    if (fs.existsSync(requirementsPath)) {
      console.log('[Python] Installing dependencies...');
      execSync(`"${pipPath}" install -r "${requirementsPath}"`, {
        cwd: sidecarPath,
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

// 共用：3 次重试 + 指数退避（1s / 3s / 9s），用完就放弃（让用户去看日志）
// inc 回调必须真正自增闭包计数器并返回新值（光返回老值没用）
function scheduleRestart(name, restart, inc) {
  if (!store.get('autoStartService')) return;
  const count = inc();
  if (count > MAX_RESTARTS) {
    console.error(`[${name}] Crashed ${MAX_RESTARTS} times in a row, giving up auto-restart. Check logs above.`);
    return;
  }
  const delay = 1000 * Math.pow(3, count - 1);
  console.log(`[${name}] Restarting in ${delay / 1000}s (attempt ${count}/${MAX_RESTARTS})...`);
  setTimeout(restart, delay);
}

// 启动 Agent-S sidecar
async function startAgentSService() {
  if (app.isPackaged) {
    console.log('[Agent-S] Packaged desktop uses Node Agent Runtime; legacy Python sidecar is disabled.');
    return;
  }
  if (isNodeAgentRuntimeEnabled()) {
    console.log('[Agent-S] Python sidecar skipped: KAYPAL_NODE_AGENT_RUNTIME=1');
    return;
  }

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
      `无法准备 Agent-S Python 环境:\n\n${pythonResult.detail || pythonResult.error}\n\n请从开始菜单运行「修复安装」，或重新安装 JIUZHANG AI。`);
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
    scheduleRestart('Agent-S', () => startAgentSService(), () => ++agentSRestartCount);
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

function requestLocalJson(pathname, port) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        timeout: 3000,
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve(res.statusCode);
          return;
        }
        reject(new Error(`HTTP ${res.statusCode || 'unknown'}`));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function waitForBackendReady(timeoutMs = BACKEND_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await requestLocalJson('/api/auth/setup-status', BACKEND_PORT);
      console.log(`[Backend] Ready after ${Date.now() - startedAt}ms`);
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, BACKEND_READY_INTERVAL_MS));
    }
  }

  appendRuntimeLog(
    'backend-launch.log',
    `backend readiness timeout after ${timeoutMs}ms: ${errorOutput(lastError) || lastError?.message || 'unknown'}`
  );
  return false;
}

function backendLogHint() {
  return [
    `日志目录：${path.join(app.getPath('userData'), 'logs')}`,
    '重点查看：backend-launch.log、backend-stderr.log、backend-stdout.log',
  ].join('\n');
}

// 启动后端服务
async function startBackendService() {
  backendStartupDiagnostic = null;
  const portInUse = await isPortInUse(BACKEND_PORT);
  if (portInUse) {
    try {
      await requestLocalJson('/api/auth/setup-status', BACKEND_PORT);
      console.log(`[Backend] Port ${BACKEND_PORT} already has a ready backend, skipping start`);
    } catch (error) {
      backendStartupDiagnostic =
        `3011 端口已被占用，但不是可用的 JIUZHANG AI 后端：${errorOutput(error) || error.message}`;
      appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
      console.error('[Backend]', backendStartupDiagnostic);
    }
    return;
  }

  const backendPath = getResourcePath('backend');
  const mainJsPath = path.join(backendPath, 'index.js');

  if (!fs.existsSync(mainJsPath)) {
    backendStartupDiagnostic = `后端入口缺失：${mainJsPath}`;
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
    console.warn('[Backend]', backendStartupDiagnostic);
    return;
  }

  console.log('[Backend] Starting service from:', backendPath);

  const envFile = path.join(backendPath, '.env');
  const envVars = app.isPackaged
    ? { PORT: String(BACKEND_PORT), NODE_ENV: 'production' }
    : { ...process.env, PORT: String(BACKEND_PORT), NODE_ENV: 'production' };

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
  envVars.KAYPAL_AUTH_BASE_URL = envVars.KAYPAL_AUTH_BASE_URL || 'https://test.kaypal.cn';
  envVars.KAYPAL_DESKTOP_USER_DATA_DIR = envVars.KAYPAL_DESKTOP_USER_DATA_DIR || app.getPath('userData');

  resolveDesktopDatabaseEnv(envVars);
  ensureDesktopSqliteDatabase(envVars, backendPath);
  envVars.REDIS_DISABLED = envVars.REDIS_DISABLED || 'true';
  envVars.AGENT_S_BASE_URL = envVars.AGENT_S_BASE_URL || `http://127.0.0.1:${AGENT_S_PORT}`;
  envVars.KAYPAL_RUNTIME_SHARED_SECRET = envVars.KAYPAL_RUNTIME_SHARED_SECRET || AGENT_S_TOKEN;
  envVars.KAYPAL_AGENT_S_TOKEN = envVars.KAYPAL_AGENT_S_TOKEN || AGENT_S_TOKEN;
  envVars.KAYPAL_NODE_AGENT_RUNTIME = envVars.KAYPAL_NODE_AGENT_RUNTIME || process.env.KAYPAL_NODE_AGENT_RUNTIME || (app.isPackaged ? '1' : '0');
  const bundledBrowserRoot = getResourcePath('playwright-browsers');
  if (fs.existsSync(bundledBrowserRoot)) {
    envVars.KAYPAL_PLAYWRIGHT_BROWSERS_PATH = envVars.KAYPAL_PLAYWRIGHT_BROWSERS_PATH || bundledBrowserRoot;
    envVars.PLAYWRIGHT_BROWSERS_PATH = envVars.PLAYWRIGHT_BROWSERS_PATH || bundledBrowserRoot;
  }
  const bundledPlaywrightMcpCli = path.join(backendPath, 'node_modules', '@playwright', 'mcp', 'cli.js');
  if (fs.existsSync(bundledPlaywrightMcpCli)) {
    envVars.PLAYWRIGHT_MCP_CLI_PATH = envVars.PLAYWRIGHT_MCP_CLI_PATH || bundledPlaywrightMcpCli;
  }
  const browserRuntimeRoot = path.join(app.getPath('userData'), 'browser-runtime');
  const backendDataRoot = path.join(app.getPath('userData'), 'runtime-data');
  envVars.LOCAL_BROWSER_PROFILE_ROOT =
    envVars.LOCAL_BROWSER_PROFILE_ROOT || path.join(browserRuntimeRoot, 'profiles');
  envVars.KAYPAL_BROWSER_BRIDGE_PROFILE_ROOT =
    envVars.KAYPAL_BROWSER_BRIDGE_PROFILE_ROOT || envVars.LOCAL_BROWSER_PROFILE_ROOT;
  envVars.LOCAL_BROWSER_EVIDENCE_ROOT =
    envVars.LOCAL_BROWSER_EVIDENCE_ROOT || path.join(browserRuntimeRoot, 'evidence');
  envVars.AUTO_UPLOAD_MATERIALS_DIR =
    envVars.AUTO_UPLOAD_MATERIALS_DIR || path.join(backendDataRoot, 'materials');
  envVars.AUTO_UPLOAD_COOKIES_DIR =
    envVars.AUTO_UPLOAD_COOKIES_DIR || path.join(backendDataRoot, 'cookiesFile');
  envVars.AUTO_UPLOAD_AVATARS_DIR =
    envVars.AUTO_UPLOAD_AVATARS_DIR || path.join(backendDataRoot, 'avatars');
  envVars.LEGACY_AUTO_UPLOAD_ROOT =
    envVars.LEGACY_AUTO_UPLOAD_ROOT || path.join(backendDataRoot, 'legacy-auto-upload');
  fs.mkdirSync(envVars.LOCAL_BROWSER_PROFILE_ROOT, { recursive: true });
  fs.mkdirSync(envVars.LOCAL_BROWSER_EVIDENCE_ROOT, { recursive: true });
  fs.mkdirSync(envVars.AUTO_UPLOAD_MATERIALS_DIR, { recursive: true });
  fs.mkdirSync(envVars.AUTO_UPLOAD_COOKIES_DIR, { recursive: true });
  fs.mkdirSync(envVars.AUTO_UPLOAD_AVATARS_DIR, { recursive: true });
  fs.mkdirSync(envVars.LEGACY_AUTO_UPLOAD_ROOT, { recursive: true });

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

  const prismaEngineCandidates =
    process.platform === 'win32'
      ? [
          path.join(backendPath, 'client', 'query_engine-windows.dll.node'),
          path.join(backendPath, 'client', 'libquery_engine-windows.dll.node')
        ]
      : process.platform === 'darwin'
        ? [
            path.join(backendPath, 'client', process.arch === 'arm64'
              ? 'libquery_engine-darwin-arm64.dylib.node'
              : 'libquery_engine-darwin.dylib.node')
          ]
        : [
            path.join(backendPath, 'client', 'libquery_engine-debian-openssl-3.0.x.so.node')
          ];
  const prismaEnginePath = prismaEngineCandidates.find((candidate) => fs.existsSync(candidate));
  if (prismaEnginePath) {
    envVars.PRISMA_CLIENT_ENGINE_TYPE = envVars.PRISMA_CLIENT_ENGINE_TYPE || 'library';
    envVars.PRISMA_QUERY_ENGINE_LIBRARY = prismaEnginePath;
  }

  const nodeBin = resolveNodeBinary();
  if (!nodeBin) {
    backendStartupDiagnostic = '找不到打包内置 Node.js 运行环境。';
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
    dialog.showErrorBox('服务启动失败',
      '找不到 Node.js 运行环境，后端服务无法启动。\n\n请从开始菜单运行「修复安装」，或重新安装 JIUZHANG AI 内容创作平台。');
    return;
  }

  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const backendStdoutPath = path.join(logDir, 'backend-stdout.log');
  const backendStderrPath = path.join(logDir, 'backend-stderr.log');
  const backendStdout = fs.createWriteStream(backendStdoutPath, { flags: 'a' });
  const backendStderr = fs.createWriteStream(backendStderrPath, { flags: 'a' });
  const backendEntry = path.join(backendPath, 'index.js');
  const childEnv = createPackagedNodeEnv(envVars, nodeBin);

  appendRuntimeLog('backend-launch.log', JSON.stringify({
    nodeBin,
    backendEntry,
    backendPath,
    spawnMode: 'direct',
    port: envVars.PORT,
    databaseUrl: envVars.DATABASE_URL,
    kaypalAuthBaseUrl: envVars.KAYPAL_AUTH_BASE_URL || null,
    prismaEnginePath: childEnv.PRISMA_QUERY_ENGINE_LIBRARY || null,
    playwrightBrowsersPath: childEnv.PLAYWRIGHT_BROWSERS_PATH || null,
    electronRunAsNode: childEnv.ELECTRON_RUN_AS_NODE || null,
  }));

  backendService = spawnBackendServiceProcess(
    nodeBin,
    backendEntry,
    backendPath,
    childEnv,
  );

  appendRuntimeLog('backend-launch.log', `spawned pid=${backendService.pid || 'unknown'}`);

  backendService.stdout.on('data', (data) => {
    backendStdout.write(data);
    console.log('[Backend]', data.toString().trim());
  });

  backendService.stderr.on('data', (data) => {
    backendStderr.write(data);
    console.error('[Backend Error]', data.toString().trim());
  });

  backendService.on('close', (code) => {
    backendStdout.end();
    backendStderr.end();
    console.log(`[Backend] Service exited with code ${code}`);
    backendService = null;
    if (isQuitting) return;
    scheduleRestart('Backend', () => startBackendService(), () => ++backendRestartCount);
  });

  backendService.on('error', (err) => {
    backendStartupDiagnostic = `后端进程启动失败：${err.message}`;
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
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
  if (isNodeAgentRuntimeEnabled()) {
    items.push({ label: '本地执行引擎已启用', enabled: false });
  } else {
    items.push({
      label: '重启本地执行引擎',
      click: () => {
        stopAgentSService();
        setTimeout(startAgentSService, 1000);
      }
    });
  }
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

  let tooltip = 'JIUZHANG AI 内容创作平台';
  if (pendingUpdate.downloaded) {
    tooltip = `JIUZHANG AI · v${pendingUpdate.version} 已下载，下次启动安装`;
  } else if (pendingUpdate.hasUpdate) {
    tooltip = `JIUZHANG AI · 新版本 v${pendingUpdate.version} 可更新`;
  } else if (pendingUpdate.phase === 'error') {
    tooltip = `JIUZHANG AI · 更新检查失败`;
  } else if (pendingUpdate.configured === false) {
    tooltip = 'JIUZHANG AI · 自动更新未配置';
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
const localBridgeNonceCache = createNonceCache();

function setupIPC() {
  ipcMain.handle('local-bridge:request', async (event, request) => {
    if (!validateLocalBridgeRequest(request)) {
      return buildLocalBridgeError(request, 'INVALID_REQUEST', '请求无效', 400);
    }
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      return buildLocalBridgeError(request, 'PERMISSION_DENIED', '请求来源无权访问', 403);
    }

    const senderFrame = event.senderFrame;
    if (!senderFrame || senderFrame !== event.sender.mainFrame) {
      return buildLocalBridgeError(request, 'PERMISSION_DENIED', '请求来源无权访问', 403);
    }

    let senderUrl;
    try {
      senderUrl = new URL(senderFrame.url);
    } catch {
      return buildLocalBridgeError(request, 'PERMISSION_DENIED', '请求来源无权访问', 403);
    }
    const allowedOrigins = new Set(['http://localhost:3010']);
    if (frontendServerUrl) {
      try { allowedOrigins.add(new URL(frontendServerUrl).origin); } catch {}
    }
    if (!allowedOrigins.has(senderUrl.origin)
      || (senderUrl.hostname !== 'localhost' && senderUrl.hostname !== '127.0.0.1')) {
      return buildLocalBridgeError(request, 'PERMISSION_DENIED', '请求来源无权访问', 403);
    }

    if (!localBridgeNonceCache.accept(senderUrl.origin, request.nonce)) {
      return buildLocalBridgeError(request, 'INVALID_REQUEST', '请求已处理', 400);
    }

    const host = senderUrl.hostname === 'localhost' ? 'localhost' : '127.0.0.1';
    const backendOrigin = `http://${host}:3011`;
    let cookieHeader = '';
    try {
      const cookies = await event.sender.session.cookies.get({ url: backendOrigin });
      cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    } catch {
      return buildLocalBridgeError(request, 'INTERNAL_ERROR', '无法读取本地会话', 500);
    }
    return requestLocalBridgeBackend({ request, host, cookieHeader });
  });

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
  ipcMain.handle('service:restart', async () => {
    isQuitting = true;
    stopAgentSService();
    stopBackendService();
    setTimeout(() => {
      isQuitting = false;
      if (!isNodeAgentRuntimeEnabled()) {
        startAgentSService();
      }
      startBackendService();
    }, 1000);
    return { success: true };
  });

  ipcMain.handle('service:status', () => {
    return {
      agentS: {
        mode: isNodeAgentRuntimeEnabled() ? 'node-runtime' : 'legacy-sidecar',
        running: isNodeAgentRuntimeEnabled() || (agentSService && !agentSService.killed),
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
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  // 初始化云端 API
  cloudAPI = new CloudAPI({
    endpoint: store.get('cloudApiEndpoint'),
    token: store.get('apiToken'),
    appVersion: app.getVersion()
  });

  // 启动本地执行 sidecars
  if (store.get('autoStartService') && !isNodeAgentRuntimeEnabled()) {
    startAgentSService();
  }

  // autoStartService 只控制崩溃后的自动恢复；桌面端基础 API 必须始终启动。
  // 先启动后端并等待 3011 就绪，避免前端登录页抢跑后报 Failed to fetch。
  await startBackendService();
  const ready = await waitForBackendReady();
  if (!ready) {
    const diagnostic = backendStartupDiagnostic
      ? `\n\n诊断：${backendStartupDiagnostic}`
      : '';
    dialog.showErrorBox(
      '本地服务启动超时',
      `3011 后端服务还没有就绪。应用会继续打开，请稍后点击刷新或重启应用。${diagnostic}\n\n${backendLogHint()}`
    );
  }

  await startFrontendServer();

  // 在窗口加载页面前完成 IPC 注册，避免 preload 抢跑。
  setupIPC();

  // 创建窗口
  createWindow();

  // 创建系统托盘
  createTray();

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
    const allowedOrigins = new Set([
      'http://localhost:3010',
      'http://127.0.0.1:3010',
    ]);
    if (frontendServerUrl) {
      allowedOrigins.add(frontendServerUrl);
    }
    if (!allowedOrigins.has(parsedUrl.origin) && !navigationUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });
});
