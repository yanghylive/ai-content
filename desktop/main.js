const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog, safeStorage } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const Store = require('electron-store');
const fixPath = require('fix-path');
const CloudAPI = require('./cloud-api');
const { EMPTY_SQLITE_DATABASE_BASE64 } = require('./sqlite-empty-template');
const { CREDENTIAL_MASTER_KEY_ENV, ensureCredentialMasterKey } = require('./credential-key-store');
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
    cloudApiEndpoint: 'https://kaypal.cn/cloud-api',
    apiToken: '',
    autoStartService: true,
    lastLoginUser: ''
  }
});

// 多工作区标签壳（方案 A：WebContentsView per tab）
const { TabManager } = require('./workspace-tabs');
const tabManager = new TabManager(store);
function getTabManager() {
  return tabManager;
}

let mainWindow = null;
let tray = null;
let agentSService = null;
let backendService = null;
let octopService = null;
let cloudAPI = null;
let isQuitting = false;
let agentSRestartCount = 0;
let backendRestartCount = 0;
let backendStartupDiagnostic = null;
let backendStartupBlocked = false;
const MAX_RESTARTS = 3;
const FRONTEND_PORT = 3010;
const BACKEND_PORT = 3011;
const AGENT_S_PORT = 17777;
const OCTOP_PORT = 8088;
const BACKEND_READY_TIMEOUT_MS = 60_000;
const BACKEND_READY_INTERVAL_MS = 500;

// 默认数据库连接：仅本地开发兜底。不内置任何真实口令，避免明文凭据进入产物；
// 优先使用环境变量 DATABASE_URL（生产/打包环境由部署侧注入）。
function defaultDatabaseUrl() {
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('file:')) {
    return process.env.DATABASE_URL;
  }
  return 'postgresql://postgres@127.0.0.1:5432/ai_content?schema=public';
}

// per-device Agent-S 共享密钥（KAYPAL_RUNTIME_SHARED_SECRET / KAYPAL_AGENT_S_TOKEN）：
// 首启随机生成并持久化到 userData/security 下 0600 文件；优先用 safeStorage 加密，
// safeStorage 不可用（如 Linux 无 keyring）时回退明文存储并启动时告警一次。
const AGENT_S_TOKEN_FILE = 'agent-s-token.v1';
let cachedAgentSToken = null;

function agentSTokenStoragePath() {
  return path.join(app.getPath('userData'), 'security', AGENT_S_TOKEN_FILE);
}

function readAgentSTokenFromDisk() {
  const tokenPath = agentSTokenStoragePath();
  if (!fs.existsSync(tokenPath)) return null;
  const raw = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!raw) return null;
  // 明文回退格式（64 位 hex）直接复用
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw, 'base64')).toString('utf8');
    }
  } catch (error) {
    console.warn('[Security] Agent-S token 解密失败，将重新生成:', error.message);
  }
  return null;
}

function persistAgentSToken(token) {
  const tokenPath = agentSTokenStoragePath();
  const directory = path.dirname(tokenPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (safeStorage.isEncryptionAvailable()) {
    const ciphertext = safeStorage.encryptString(token);
    fs.writeFileSync(tokenPath, ciphertext.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    return 'safeStorage';
  }
  console.warn('[Security] safeStorage 不可用，Agent-S token 将以明文保存在用户数据目录（权限 0600），建议为系统配置 keyring');
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return 'plaintext';
}

function ensureAgentSToken() {
  if (cachedAgentSToken) return cachedAgentSToken;
  const stored = readAgentSTokenFromDisk();
  if (stored) {
    cachedAgentSToken = stored;
    return cachedAgentSToken;
  }
  cachedAgentSToken = crypto.randomBytes(32).toString('hex');
  persistAgentSToken(cachedAgentSToken);
  console.log('[Security] Generated new per-device Agent-S token');
  return cachedAgentSToken;
}

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
    envVars.DATABASE_URL = defaultDatabaseUrl();
    console.warn('[Backend] 未配置 DATABASE_URL，使用无凭据的本地默认连接（postgresql://postgres@127.0.0.1:5432/ai_content），请通过环境变量 DATABASE_URL 配置');
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

    // user_version=1：由桌面端「从零建新库」创建的模板库（尚无 schema），
    // 交由后端启动时执行迁移生成表结构，不视为损坏/需要接管。
    if (buffer.readUInt32BE(60) === 1) {
      return true;
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

// 从零建一个最小空库（user_version=1，无 schema/数据），覆盖原文件。
// 不再复制种子库：schema 交给后端启动时迁移生成。
function createEmptySqliteDatabase(databasePath) {
  fs.writeFileSync(databasePath, Buffer.from(EMPTY_SQLITE_DATABASE_BASE64, 'base64'));
}

function ensureDesktopSqliteDatabase(envVars, backendPath) {
  const mode = (envVars.KAYPAL_DESKTOP_DATABASE_MODE || '').trim().toLowerCase();
  if (mode !== 'sqlite') return;

  const databasePath = resolveSqliteDatabasePath(envVars.SQLITE_DATABASE_URL || envVars.DATABASE_URL, backendPath);
  if (!databasePath) return;

  // 孤儿 WAL 防御（2026-08-27 Win P0）：上次进程异常退出会遗留 <db>-wal/-shm，
  // 它们的页引用指向旧版主库；换版本装包后主库是全新 seed，Prisma 打开时做
  // WAL 合并校验必然对不上 → SQLITE_CORRUPT "database disk image is malformed"。
  // 本函数运行于后端 spawn 之前，此时任何 -wal 都是死文件，移到一旁留档。
  for (const suffix of ['-wal', '-shm']) {
    const sidecarPath = `${databasePath}${suffix}`;
    if (fs.existsSync(sidecarPath)) {
      const orphanPath = `${sidecarPath}.orphan-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        fs.renameSync(sidecarPath, orphanPath);
        console.warn('[Backend] Orphan SQLite sidecar moved aside:', orphanPath);
      } catch (error) {
        // 移不动（文件被占用）时记录即可：若库已被 schema 校验判坏会走 suspect 分支
        console.warn('[Backend] Unable to move SQLite sidecar:', error.message);
      }
    }
  }

  const seedPath = path.join(backendPath, 'prisma', 'dev.db');

  // 目标库已存在且 schema 完整（或为桌面端新建的 user_version=1 空库）→ 直接复用
  if (sqliteDatabaseHasRequiredSchema(databasePath)) {
    return;
  }

  // 目标库不存在 → 仅在目标文件不存在时才复制种子库完成首次初始化
  if (!fs.existsSync(databasePath)) {
    if (sqliteDatabaseHasRequiredSchema(seedPath)) {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.copyFileSync(seedPath, databasePath);
      console.log('[Backend] SQLite database initialized from packaged seed:', databasePath);
    } else {
      console.warn('[Backend] SQLite seed database is missing or incomplete:', seedPath);
    }
    return;
  }

  // 目标库存在但 schema 校验失败：不覆盖原文件（避免用户数据静默丢失），
  // 先保留为 .suspect-<ts>，再从零建一个空库供后端迁移重建。
  const suspectPath = `${databasePath}.suspect-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    fs.renameSync(databasePath, suspectPath);
    console.error('[Backend] SQLite database failed schema check, preserved original as:', suspectPath);
  } catch (error) {
    console.error('[Backend] Unable to preserve suspect SQLite database, skipping recreation:', error.message);
    return;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  createEmptySqliteDatabase(databasePath);
  console.log('[Backend] SQLite database recreated from scratch (user_version=1):', databasePath);
}

function fileContainsMarker(filePath, marker) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const needle = Buffer.from(marker, 'utf8');
  const chunkSize = 1024 * 1024;
  const buffer = Buffer.alloc(chunkSize + needle.length - 1);
  const fd = fs.openSync(filePath, 'r');
  let carryLength = 0;
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, carryLength, chunkSize, null);
      if (bytesRead === 0) return false;
      const length = carryLength + bytesRead;
      if (buffer.subarray(0, length).includes(needle)) return true;
      carryLength = Math.min(needle.length - 1, length);
      buffer.copy(buffer, 0, length - carryLength, length);
    }
  } finally {
    fs.closeSync(fd);
  }
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

/**
 * /api/* 反代到内置后端（127.0.0.1:BACKEND_PORT）。
 * 透传 method / headers（含 Cookie、Content-Type）/ body 流；后端未启动时返回 502 中文提示。
 */
function proxyApiToBackend(req, res) {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: req.url, // 完整透传（含 query string）
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('502 Bad Gateway：后端服务未启动或不可用，请稍候重试');
  });
  req.pipe(proxyReq);
}

function createFrontendStaticServer(frontendRoot) {
  return http.createServer((req, res) => {
    try {
      const urlPath = req.url || '/';
      // /api/* 反代到内置后端（与生产 nginx 同口径）：前端全部走同源相对路径，
      // 不再依赖绝对地址直连 3011（单入口改造，v1.1.70）
      if (urlPath.startsWith('/api/') || urlPath === '/api') {
        return proxyApiToBackend(req, res);
      }
      const filePath = resolveFrontendAsset(frontendRoot, urlPath);
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

  // 多工作区标签壳（方案 A）：前端加载进各标签 WebContentsView，窗口自身
  // webContents 保持空白；TabManager 在 contentView 下挂 tab 条 + 内容视图，
  // 并把原窗口级「崩溃自愈 / 外链 / 更新广播」handler 下沉到各标签视图。
  if (!frontendServerUrl && process.env.NODE_ENV !== 'development') {
    throw new Error('前端本地服务未启动');
  }
  getTabManager().attach(mainWindow);

  // 保存窗口大小
  mainWindow.on('resize', () => {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', { width: bounds.width, height: bounds.height });
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

// 统一唤起主窗口：Dock 点击 / 托盘点击 / 托盘菜单「显示主窗口」都走这里。
// 单独 show() 在 macOS 应用处于后台时不一定会把窗口置前，需要 restore +
// show + focus 组合，并对「窗口已被销毁 / 最小化」做兜底。
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') {
    try {
      mainWindow.moveTop();
    } catch (_err) {
      /* ignore */
    }
    try {
      app.focus({ steal: true });
    } catch (_err) {
      /* ignore */
    }
  }
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
  if (!store.get('autoStartService')) return false;
  const count = inc();
  if (count > MAX_RESTARTS) {
    console.error(`[${name}] Crashed ${MAX_RESTARTS} times in a row, giving up auto-restart. Check logs above.`);
    return false;
  }
  const delay = 1000 * Math.pow(3, count - 1);
  console.log(`[${name}] Restarting in ${delay / 1000}s (attempt ${count}/${MAX_RESTARTS})...`);
  setTimeout(restart, delay);
  return true;
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
      KAYPAL_AGENT_S_TOKEN: ensureAgentSToken(),
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
    if (agentSService && agentSService.__killTimer) clearTimeout(agentSService.__killTimer);
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
    // 捕获当时的进程引用，防止 5s 定时器误杀「重启后」的新进程
    const target = agentSService;
    if (target.__killTimer) clearTimeout(target.__killTimer);
    target.kill('SIGTERM');
    target.__killTimer = setTimeout(() => {
      if (agentSService === target && target.exitCode === null && !target.killed) {
        target.kill('SIGKILL');
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
    if (backendStartupBlocked) {
      appendRuntimeLog(
        'backend-launch.log',
        `backend startup stopped before readiness: ${backendStartupDiagnostic || 'unknown'}`,
      );
      return false;
    }
    try {
      await requestLocalJson('/api/auth/setup-status', BACKEND_PORT);
      backendRestartCount = 0;
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
  backendStartupBlocked = false;
  const portInUse = await isPortInUse(BACKEND_PORT);
  if (portInUse) {
    try {
      await requestLocalJson('/api/auth/setup-status', BACKEND_PORT);
      console.log(`[Backend] Port ${BACKEND_PORT} already has a ready backend, skipping start`);
    } catch (error) {
      backendStartupDiagnostic =
        `3011 端口已被占用，但不是可用的 JIUZHANG AI 后端：${errorOutput(error) || error.message}`;
      backendStartupBlocked = true;
      appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
      console.error('[Backend]', backendStartupDiagnostic);
    }
    return;
  }

  const backendPath = getResourcePath('backend');
  const mainJsPath = path.join(backendPath, 'index.js');

  if (!fs.existsSync(mainJsPath)) {
    backendStartupDiagnostic = `后端入口缺失：${mainJsPath}`;
    backendStartupBlocked = true;
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
  envVars.KAYPAL_AUTH_BASE_URL = envVars.KAYPAL_AUTH_BASE_URL || 'https://kaypal.cn';
  envVars.KAYPAL_DESKTOP_USER_DATA_DIR = envVars.KAYPAL_DESKTOP_USER_DATA_DIR || app.getPath('userData');
  // 错误自动上报用：把真实应用版本注入后端 env（bundle 无 package.json 可读）
  envVars.APP_VERSION = app.getVersion();

  resolveDesktopDatabaseEnv(envVars);
  ensureDesktopSqliteDatabase(envVars, backendPath);
  const desktopDatabasePath = resolveSqliteDatabasePath(
    envVars.SQLITE_DATABASE_URL || envVars.DATABASE_URL,
    backendPath,
  );

  try {
    const credentialKey = ensureCredentialMasterKey({
      safeStorage,
      userDataPath: app.getPath('userData'),
      configuredKey: app.isPackaged ? null : envVars[CREDENTIAL_MASTER_KEY_ENV],
      allowCreate: !fileContainsMarker(desktopDatabasePath, 'enc:v1:'),
    });
    envVars[CREDENTIAL_MASTER_KEY_ENV] = credentialKey.value;
    appendRuntimeLog(
      'backend-launch.log',
      `credential master key ready source=${credentialKey.source} storage=${credentialKey.storageBackend}`,
    );
  } catch (error) {
    backendStartupDiagnostic = `账号凭据安全密钥初始化失败：${error.message}`;
    backendStartupBlocked = true;
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
    console.error('[Backend]', backendStartupDiagnostic);
    return;
  }

  envVars.REDIS_DISABLED = envVars.REDIS_DISABLED || 'true';
  envVars.AGENT_S_BASE_URL = envVars.AGENT_S_BASE_URL || `http://127.0.0.1:${AGENT_S_PORT}`;
  envVars.KAYPAL_RUNTIME_SHARED_SECRET = envVars.KAYPAL_RUNTIME_SHARED_SECRET || ensureAgentSToken();
  envVars.KAYPAL_AGENT_S_TOKEN = envVars.KAYPAL_AGENT_S_TOKEN || ensureAgentSToken();
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
  // 打包后的微信原生资源（resources/wechat-*）注入到后端 env，供 PowerShell 采集脚本定位
  const bundledWechatDbHelper = getResourcePath('wechat-db-helper');
  if (fs.existsSync(bundledWechatDbHelper)) {
    const helperJs = path.join(bundledWechatDbHelper, 'wechat-db-helper.js');
    const sqliteExe = path.join(bundledWechatDbHelper, 'sqlite3.exe');
    envVars.AI_CONTENT_WECHAT_DB_HELPER =
      envVars.AI_CONTENT_WECHAT_DB_HELPER ||
      (fs.existsSync(helperJs) ? helperJs : bundledWechatDbHelper);
    if (fs.existsSync(sqliteExe)) {
      envVars.AI_CONTENT_SQLITE_EXE = envVars.AI_CONTENT_SQLITE_EXE || sqliteExe;
    }
  }
  const bundledWechatEngine = getResourcePath('wechat-engine');
  if (fs.existsSync(bundledWechatEngine)) {
    const engineJs = path.join(bundledWechatEngine, 'kaypal-wechat-engine.js');
    const engineExe = path.join(bundledWechatEngine, 'kaypal-wechat-engine.exe');
    const enginePath = [engineExe, engineJs].find((candidate) => fs.existsSync(candidate));
    if (enginePath) {
      envVars.AI_CONTENT_WECHAT_ENGINE = envVars.AI_CONTENT_WECHAT_ENGINE || enginePath;
    }
  }
  const bundledWechatNativeRuntime = getResourcePath('wechat-native-runtime');
  if (fs.existsSync(bundledWechatNativeRuntime)) {
    const runtimeJs = path.join(bundledWechatNativeRuntime, 'kaypal-wechat-native-runtime.js');
    const runtimeExe = path.join(bundledWechatNativeRuntime, 'kaypal-wechat-native-runtime.exe');
    const runtimePath = [runtimeExe, runtimeJs].find((candidate) => fs.existsSync(candidate));
    if (runtimePath) {
      envVars.AI_CONTENT_WECHAT_NATIVE_RUNTIME =
        envVars.AI_CONTENT_WECHAT_NATIVE_RUNTIME || runtimePath;
    }
  }
  const bundledWechatOcr = getResourcePath('wechat-ocr');
  if (fs.existsSync(bundledWechatOcr)) {
    envVars.AI_CONTENT_WECHAT_OCR_DIR = envVars.AI_CONTENT_WECHAT_OCR_DIR || bundledWechatOcr;
  }
  // macOS 微信原生工具链（resources/wechat-macos/bin）：cli 命令 + 通讯录/聊天历史脚本入口
  if (process.platform === 'darwin') {
    const bundledWechatMac = getResourcePath('wechat-macos');
    if (fs.existsSync(bundledWechatMac)) {
      const macBin = path.join(bundledWechatMac, 'bin');
      if (fs.existsSync(macBin)) {
        envVars.KAYPAL_WECHAT_COMMAND_ROOT =
          envVars.KAYPAL_WECHAT_COMMAND_ROOT || macBin;
      }
    }
  }
  // 微信自动回复高级脚本根（resources/open-cowork-upstream/scripts，mac/win 共用）
  const bundledOpenCowork = getResourcePath('open-cowork-upstream');
  if (fs.existsSync(bundledOpenCowork)) {
    const scriptsRoot = path.join(bundledOpenCowork, 'scripts');
    if (fs.existsSync(scriptsRoot)) {
      envVars.KAYPAL_DESKTOP_SCRIPT_ROOT =
        envVars.KAYPAL_DESKTOP_SCRIPT_ROOT || scriptsRoot;
    }
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
  // 2026-08-27 真机 P0：Windows native 引擎(query_engine-windows.dll.node)交叉构建产物损坏，
  // 连全新空库都报 "database disk image is malformed"；而 Prisma 默认 WASM 引擎(query_engine_bg.wasm)
  // 可正常打开 seed。Windows 强制走 WASM 引擎（不设 PRISMA_QUERY_ENGINE_LIBRARY），macOS/linux 保留 native。
  if (prismaEnginePath && process.platform !== 'win32') {
    envVars.PRISMA_CLIENT_ENGINE_TYPE = envVars.PRISMA_CLIENT_ENGINE_TYPE || 'library';
    envVars.PRISMA_QUERY_ENGINE_LIBRARY = prismaEnginePath;
  }

  const nodeBin = resolveNodeBinary();
  if (!nodeBin) {
    backendStartupDiagnostic = '找不到打包内置 Node.js 运行环境。';
    backendStartupBlocked = true;
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

  let stderrTail = '';
  backendService.stderr.on('data', (data) => {
    backendStderr.write(data);
    const text = data.toString();
    stderrTail = `${stderrTail}${text}`.slice(-4096);
    console.error('[Backend Error]', text.trim());
  });

  backendService.on('close', (code) => {
    backendStdout.end();
    backendStderr.end();
    const errorLine = stderrTail
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /(?:ERROR|Error:|Exception|Cannot find|ENOENT)/i.test(line));
    backendStartupDiagnostic = `后端进程退出（代码 ${code ?? 'unknown'}）${errorLine ? `：${errorLine.slice(0, 500)}` : ''}`;
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
    console.log(`[Backend] Service exited with code ${code}`);
    if (backendService && backendService.__killTimer) clearTimeout(backendService.__killTimer);
    backendService = null;
    if (isQuitting) return;
    const restartScheduled = scheduleRestart(
      'Backend',
      () => startBackendService(),
      () => ++backendRestartCount,
    );
    if (!restartScheduled) backendStartupBlocked = true;
  });

  backendService.on('error', (err) => {
    backendStartupDiagnostic = `后端进程启动失败：${err.message}`;
    backendStartupBlocked = true;
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
    console.error('[Backend] Failed to start:', err.message);
  });
}

// 停止后端服务
function stopBackendService() {
  if (backendService) {
    console.log('[Backend] Stopping service...');
    // 捕获当时的进程引用，防止 5s 定时器误杀「重启后」的新进程
    const target = backendService;
    if (target.__killTimer) clearTimeout(target.__killTimer);
    target.kill('SIGTERM');
    target.__killTimer = setTimeout(() => {
      if (backendService === target && target.exitCode === null && !target.killed) {
        target.kill('SIGKILL');
      }
    }, 5000);
  }
}

// ============ Octop sidecar（审计 #3：Octop 直接打包，不外部依赖） ============
// 打包进 runtime/octop（venv 精简 + headless_shell chromium + entry.sh），
// 由 main.js 自动启动 8088，首次启动 entry.sh 内 octop init 预置 admin（免 wizard）。

function getOctopSidecarEntry() {
  const sidecarRoot = getResourcePath('octop');
  return process.platform === 'win32'
    ? path.join(sidecarRoot, 'entry.bat')
    : path.join(sidecarRoot, 'entry.sh');
}

function getOctopAdminCredentials() {
  // 与 backend 的 OCTOP_USERNAME/OCTOP_PASSWORD 保持一致，backend 才能登录本 sidecar。
  // 读取 backend/.env 里的 OCTOP_*（若有），否则用默认占位（首启 octop init 会用它建 admin）。
  const envFile = path.join(getResourcePath('backend'), '.env');
  const env = { ...process.env };
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  return {
    username: env.OCTOP_ADMIN_USERNAME || env.OCTOP_USERNAME || 'octop-bridge',
    password: env.OCTOP_ADMIN_PASSWORD || env.OCTOP_PASSWORD || 'Octop1234',
  };
}

async function startOctopSidecar() {
  const entryPath = getOctopSidecarEntry();
  if (!fs.existsSync(entryPath)) {
    console.log('[Octop] sidecar 未打包（runtime/octop 缺失），跳过自动启动');
    return;
  }

  const portInUse = await isPortInUse(OCTOP_PORT);
  if (portInUse) {
    try {
      await requestLocalJson('/api/health', OCTOP_PORT);
      console.log(`[Octop] Port ${OCTOP_PORT} 已有可用 Octop，跳过启动`);
      return;
    } catch {
      console.warn(`[Octop] Port ${OCTOP_PORT} 被占用但不是可用 Octop，跳过`);
      return;
    }
  }

  const sidecarRoot = getResourcePath('octop');
  const creds = getOctopAdminCredentials();
  const childEnv = {
    ...process.env,
    OCTOP_PORT: String(OCTOP_PORT),
    OCTOP_HOME: path.join(app.getPath('userData'), 'octop'),
    OCTOP_ADMIN_USERNAME: creds.username,
    OCTOP_ADMIN_PASSWORD: creds.password,
  };
  // 3010→Octop 同身份 SSO（产品要求：octop 无自有账号体系感知）：
  // sidecar 与后端必须用同一 OCTOP_USER_SECRET（确定性派生 per-user 账号），
  // 否则后端开出的派生账号在 sidecar 侧对不上 → 回退 shared。
  // token TTL 拉长到 7 天，配合 workspace-tabs 的 401 自动续签，用户永不看到 octop 登录页。
  const backendEnvPath = path.join(getResourcePath('backend'), '.env');
  if (fs.existsSync(backendEnvPath)) {
    for (const line of fs.readFileSync(backendEnvPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const key = t.slice(0, i).trim();
      if (
        key === 'OCTOP_USER_SECRET' ||
        key === 'OCTOP_IDENTITY_MODE' ||
        key === 'OCTOP_ACCESS_TOKEN_TTL' ||
        key === 'OCTOP_USER_PREFIX'
      ) {
        const value = t.slice(i + 1).trim();
        if (value) childEnv[key] = value;
      }
    }
  }
  if (!childEnv.OCTOP_ACCESS_TOKEN_TTL) childEnv.OCTOP_ACCESS_TOKEN_TTL = '604800';

  console.log('[Octop] Starting sidecar from:', sidecarRoot);
  if (process.platform === 'win32') {
    octopService = spawn(entryPath, [], { cwd: sidecarRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  } else {
    octopService = spawn(entryPath, [], { cwd: sidecarRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  // 冷启动含 octop init（DB 迁移 + admin 创建）+ uvicorn，超时放宽到 150s
  const startedAt = Date.now();
  while (Date.now() - startedAt < 150_000) {
    if (octopService && octopService.exitCode !== null) break; // 进程已退出
    try {
      await requestLocalJson('/api/health', OCTOP_PORT);
      console.log(`[Octop] Ready after ${Date.now() - startedAt}ms`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.warn('[Octop] 启动超时或进程退出，高级模式将降级（3010 原生工具）');
}

function stopOctopService() {
  if (octopService) {
    console.log('[Octop] Stopping sidecar...');
    const target = octopService;
    if (target.__killTimer) clearTimeout(target.__killTimer);
    target.kill('SIGTERM');
    target.__killTimer = setTimeout(() => {
      if (octopService === target && target.exitCode === null && !target.killed) {
        target.kill('SIGKILL');
      }
    }, 5000);
  }
}

// 创建系统托盘

// ============ 悬浮球（hoverBall，二期：AI 网页代操作快捷入口） ============
let hoverBallWindow = null;

function createHoverBall() {
  try {
    if (hoverBallWindow && !hoverBallWindow.isDestroyed()) return;
    const ballPath = path.join(__dirname, 'hover-ball.html');
    hoverBallWindow = new BrowserWindow({
      width: 320,
      height: 420,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-hoverball.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    hoverBallWindow.loadFile(ballPath);
    // 悬浮球默认贴右边缘
    const { screen } = require('electron');
    const wa = screen.getPrimaryDisplay().workArea;
    hoverBallWindow.setPosition(wa.x + wa.width - 90, wa.y + wa.height - 120);
    hoverBallWindow.setAlwaysOnTop(true, 'floating');
    hoverBallWindow.on('closed', () => {
      hoverBallWindow = null;
    });
  } catch (error) {
    console.error('[HoverBall] 创建失败:', error);
  }
}

function toggleHoverBall() {
  if (hoverBallWindow && !hoverBallWindow.isDestroyed()) {
    hoverBallWindow.close();
    hoverBallWindow = null;
  } else {
    createHoverBall();
  }
}

// 校验请求是否来自悬浮球窗口（含 senderFrame URL 兜底），防止其它窗口/页面冒充调用
function isHoverBallSender(event) {
  if (!hoverBallWindow || hoverBallWindow.isDestroyed()) return false;
  if (event.sender !== hoverBallWindow.webContents) return false;
  const frame = event.senderFrame;
  if (frame && frame.url && !frame.url.startsWith('file://')) return false;
  return true;
}

// 悬浮球拖拽
ipcMain.on('hover-ball:drag', (event, { dx, dy }) => {
  if (!isHoverBallSender(event)) return;
  const [x, y] = hoverBallWindow.getPosition();
  hoverBallWindow.setPosition(x + dx, y + dy);
});

// 悬浮球执行 AI 网页代操作（复用后端 session cookie）
ipcMain.handle('hover-ball:ai-action', async (event, data) => {
  if (!isHoverBallSender(event)) {
    return { ok: false, message: '请求来源无权访问' };
  }
  const instruction = String(data?.instruction || '').trim();
  if (!instruction) {
    return { ok: false, message: '指令不能为空' };
  }
  try {
    const host = '127.0.0.1';
    const backendOrigin = `http://${host}:3011`;
    let cookieHeader = '';
    try {
      const cookies = await event.sender.session.cookies.get({ url: backendOrigin });
      cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
    } catch {}
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(`${backendOrigin}/api/local-engine/browser/ai-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify({ instruction }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, ...body };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      ok: false,
      message: error.name === 'AbortError' ? '执行超时（120 秒）' : `后端调用失败：${error.message || error}`,
    };
  }
});

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
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  });
}

function buildTrayMenu() {
  const items = [
    {
      label: '显示主窗口',
      click: () => {
        showMainWindow();
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
  // 多标签壳：更新状态广播到各标签内容视图（mainWindow.webContents 已不承载前端）
  getTabManager().broadcast('update-state', pendingUpdate);
}

// 设置 IPC 通信
const localBridgeNonceCache = createNonceCache();

function setupIPC() {
  // 桌面端系统能力（v1.1.66 修复）：剪贴板写入、登录凭据 safeStorage 加密记忆
  // （登录页「记住账号和密码」）。外部链接走下方已有的 shell:open-external。

  ipcMain.handle('clipboard:write-text', (_event, text) => {
    try {
      const { clipboard } = require('electron');
      clipboard.writeText(String(text ?? ''));
      return true;
    } catch {
      return false;
    }
  });

  const SECURE_STORE_PREFIX = 'loginCredential:';
  ipcMain.handle('secure-store:get', (_event, key) => {
    try {
      const raw = store.get(`${SECURE_STORE_PREFIX}${key}`);
      if (typeof raw !== 'string' || !raw) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(raw, 'base64'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('secure-store:set', (_event, key, value) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      const encrypted = safeStorage.encryptString(String(value ?? ''));
      store.set(`${SECURE_STORE_PREFIX}${key}`, encrypted.toString('base64'));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('secure-store:delete', (_event, key) => {
    try {
      store.delete(`${SECURE_STORE_PREFIX}${key}`);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('local-bridge:request', async (event, request) => {
    if (!validateLocalBridgeRequest(request)) {
      return buildLocalBridgeError(request, 'INVALID_REQUEST', '请求无效', 400);
    }
    if (!mainWindow || mainWindow.isDestroyed() || !getTabManager().isOwnedWebContents(event.sender)) {
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

  // config:set 白名单：仅允许渲染进程修改业务偏好类配置。
  // apiToken / cloudApiEndpoint / skippedVersion 等敏感 key 禁止经此通道修改，
  // 避免被注入的渲染页篡改凭据或跳转云 API 端点。
  const CONFIG_SET_ALLOWED_KEYS = new Set([
    'autoStartService',
    'hoverBallEnabled',
    'windowBounds',
    'lastLoginUser',
  ]);

  ipcMain.handle('config:set', (event, key, value) => {
    if (typeof key !== 'string' || !CONFIG_SET_ALLOWED_KEYS.has(key)) {
      console.warn(`[Config] 拒绝通过 config:set 修改未授权 key: ${key}`);
      return false;
    }
    store.set(key, value);
    return true;
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

  // 打开外部链接（仅允许 http/https，防 file:// 等本地协议被任意打开）
  ipcMain.handle('shell:open-external', async (event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch (err) {
      console.error('[Shell] Failed to open external URL:', err.message);
      return false;
    }
  });

  // 打开文件目录
  ipcMain.handle('shell:show-item-in-folder', (event, fullPath) => {
    shell.showItemInFolder(fullPath);
  });

  // 多工作区标签壳 IPC（tab 条 + 前端 workspace 切换器调用）
  getTabManager().registerIpc(ipcMain);
}

// 单实例锁：Windows/macOS 下用户再次点击任务栏/Dock 图标时，系统会启动
// 第二个实例；单实例锁让第二个实例退出，并触发 second-instance 事件唤起
// 已运行实例的主窗口（修复「界面关闭后点任务栏图标无法唤起」）。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
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

  // Octop 高级模式 sidecar：异步后台启动，不阻塞前端/基础功能（失败降级为 3010 原生工具）
  void startOctopSidecar();

  // 把前端地址交给标签壳，供各标签视图加载
  getTabManager().setFrontendUrl(frontendServerUrl);

  // 在窗口加载页面前完成 IPC 注册，避免 preload 抢跑。
  setupIPC();

  // 创建窗口
  createWindow();

  // 创建系统托盘
  createTray();

  // 悬浮球（可经托盘开关）
  if (store.get('hoverBallEnabled') !== false) {
    createHoverBall();
  }

  // 设置自动更新
  pendingUpdate.envUrl = process.env.AI_CONTENT_UPDATE_URL || null;
  setupAutoUpdater(mainWindow, {
    onStateChange: setPendingUpdate,
    broadcastToRenderer: (channel, data) => getTabManager().broadcast(channel, data)
  });

  // macOS: 点击 dock 图标时显示窗口
  app.on('activate', () => {
    showMainWindow();
  });
}).catch((err) => {
  console.error('[App] Failed to initialize:', err);
  dialog.showErrorBox('启动失败', `应用初始化失败: ${err.message}`);
});

// 应用退出
app.on('before-quit', () => {
  isQuitting = true;
  getTabManager().persist();
  stopFrontendServer();
  stopAgentSService();
  stopBackendService();
  stopOctopService();
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
      'https://kaypal.cn',
    ]);
    if (frontendServerUrl) {
      allowedOrigins.add(frontendServerUrl);
    }
    if (!allowedOrigins.has(parsedUrl.origin) && !navigationUrl.startsWith('file://')) {
      event.preventDefault();
    }
  });
});
