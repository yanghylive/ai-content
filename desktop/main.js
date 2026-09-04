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
const { resolveStableUserDataDir } = require('./user-data-path');
const { setupAutoUpdater, checkForUpdates, quitAndInstall, destroy: destroyUpdater, downloadUpdate, skipUpdate, getSkippedVersion, getUpdateFeedInfo } = require('./auto-updater');

// 修复 macOS PATH 问题
fixPath();

function configureStableUserDataPath() {
  // round14（stage14 实锤）：打包版 userData 默认落 productName 目录（macOS =
  // `~/Library/Application Support/JIUZHANG AI 内容创作平台/`，Info.plist
  // CFBundleName），而 3011 跨进程推导硬编码 ai-content-desktop → 面板模式
  // 开关/面板桥凭据两条链在生产 macOS 全断。win+mac 打包版统一固定，
  // macOS 老用户数据一次性 rename 迁移。dev 版 name 本就一致，不受影响。
  const resolved = resolveStableUserDataDir({
    platform: process.platform,
    isPackaged: app.isPackaged,
    appName: app.getName(),
    execPath: process.execPath,
    appData: app.getPath('appData'),
  });
  if (!resolved) {
    return;
  }

  const { dir, migrateFrom } = resolved;
  if (migrateFrom) {
    try {
      if (!fs.existsSync(dir) && fs.existsSync(migrateFrom)) {
        fs.renameSync(migrateFrom, dir);
        console.error('[user-data] 一次性迁移 userData：', migrateFrom, '→', dir);
      }
    } catch (error) {
      // 迁移失败不阻塞启动：老数据保留原地（不丢），只是本次不迁
      console.error('[user-data] userData 迁移失败（老数据保留原地）：', error?.message || error);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
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

// 浏览器面板（工作流阶段 2）：右侧 WebContentsView + 本地控制条，
// 与 TabManager 通过 rightInset 协同布局。
const { BrowserPanelManager } = require('./browser-panel-manager');
const browserPanel = new BrowserPanelManager({
  electron: require('electron'),
  store,
  tabManager,
  // 阶段 6 决策 ③：面板模式开关文件落 userData（与桥凭据同一目录取法）
  getUserDataDir: () => {
    try {
      return app.getPath('userData');
    } catch {
      return null;
    }
  },
});
function getBrowserPanel() {
  return browserPanel;
}

// 阶段 3：Broker × 面板接线——capability token 只存活主进程，Agent 桥（阶段 4）
// 经 authenticated local IPC 调 getBrowserWiring().*ForAgent(panelId, actor, ...)。
const { wireBrowserPanel } = require('./browser-broker-wiring');
const browserWiring = wireBrowserPanel({
  manager: browserPanel,
  // 阶段 6：待批列表变更 → 实时推给审批浮层（Agent 签单 / 用户批准 / 拒绝都触发）。
  // 这是 UI 旁路，抛错不影响签单与执行（wiring 内部已 try/catch）。
  onPendingChange: (panelId, pending) => {
    const current = browserPanel.session ? browserPanel.session.panelId : null;
    // 只刷新当前面板的那份，避免串台（多面板场景下把 A 的单推到 B 的浮层上）
    if (panelId === current) browserPanel.updateApprovalList(pending);
  },
});
function getBrowserWiring() {
  return browserWiring;
}

// 阶段 5：桥的生命周期编排（与阶段 5 端到端脚本共用同一模块，避免"E2E 验副本、
// 生产跑另一份"）。规则：面板可见(opened/shown)→起桥+写 0600 凭据文件；
// 隐藏/销毁/换账号→关桥+删凭据文件（详见模块头注释）。
const { createBrowserBridgeRuntime } = require('./browser-panel-bridge-runtime');
const browserBridgeRuntime = createBrowserBridgeRuntime({
  manager: browserPanel,
  wiring: browserWiring,
  getUserDataDir: () => {
    try {
      return app.getPath('userData');
    } catch {
      return null;
    }
  },
  logger: console,
});

/** 桥是否可用 + endpoint（**不含 token**，供诊断/日志） */
function getBrowserBridgeInfo() {
  const info = browserBridgeRuntime.info();
  return info ? { port: info.port, endpoint: info.endpoint } : null;
}

if (typeof browserPanel.onSessionEvent === 'function') {
  browserPanel.onSessionEvent((event) => {
    browserBridgeRuntime.sync(event);
  });
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

// Octop sidecar admin 密码只能由当前设备持有，不能在模板、启动脚本或安装包中
// 固定一个所有用户共用的默认值。与 Agent-S token 相同，优先 safeStorage 加密，
// 不可用时才回退到用户目录 0600 文件。
const OCTOP_ADMIN_PASSWORD_FILE = 'octop-admin-password.v1';
let cachedOctopAdminPassword = null;

function octopAdminPasswordStoragePath() {
  return path.join(app.getPath('userData'), 'security', OCTOP_ADMIN_PASSWORD_FILE);
}

function readOctopAdminPasswordFromDisk() {
  const passwordPath = octopAdminPasswordStoragePath();
  if (!fs.existsSync(passwordPath)) return null;
  const raw = fs.readFileSync(passwordPath, 'utf8').trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(Buffer.from(raw, 'base64'));
      return decrypted.trim() || null;
    }
  } catch (error) {
    console.warn('[Security] Octop admin password 解密失败，将重新生成:', error.message);
  }
  return null;
}

function persistOctopAdminPassword(password) {
  const passwordPath = octopAdminPasswordStoragePath();
  fs.mkdirSync(path.dirname(passwordPath), { recursive: true, mode: 0o700 });
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(password);
    fs.writeFileSync(passwordPath, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    return 'safeStorage';
  }
  console.warn('[Security] safeStorage 不可用，Octop admin password 将以明文保存在用户数据目录（权限 0600）');
  fs.writeFileSync(passwordPath, password, { encoding: 'utf8', mode: 0o600 });
  return 'plaintext';
}

function ensureOctopAdminPassword() {
  if (cachedOctopAdminPassword) return cachedOctopAdminPassword;
  const stored = readOctopAdminPasswordFromDisk();
  if (stored) {
    cachedOctopAdminPassword = stored;
    return cachedOctopAdminPassword;
  }
  cachedOctopAdminPassword = crypto.randomBytes(32).toString('hex');
  persistOctopAdminPassword(cachedOctopAdminPassword);
  console.log('[Security] Generated new per-device Octop admin password');
  return cachedOctopAdminPassword;
}

// 2026-08-27 Win P1：AGENT_GATEWAY_SECRET 兜底注入。
// 打包 extraResources 同目标覆盖链不保证 backend.env 覆盖 example（实测 1.1.96
// 部署态 .env 恒为 example 内容），AGENT_GATEWAY_SECRET 因此缺失，非开发环境
// agent-gateway.module 启动即 throw。复用 per-device 随机持久化密钥（ensureAgentSToken）
// 兜底，满足"禁止默认密钥"安全约束；backend/.env 若显式提供则优先生效。
let cachedGatewaySecret = null;

function ensureGatewaySecret() {
  if (cachedGatewaySecret) return cachedGatewaySecret;
  cachedGatewaySecret = crypto.randomBytes(32).toString('hex');
  return cachedGatewaySecret;
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
  try { fs.chmodSync(databasePath, 0o600); } catch { /* best effort on non-POSIX hosts */ }
}

/**
 * 2026-09-01 换库适配（审计 #1/2/6/7/9/11）：启动扫描账号库（accounts/*.sqlite）。
 * 文件头非 SQLite（前 16 字节非 "SQLite format 3\0"）→ 带备份隔离 + 从系统库模板重建。
 * 运行态完整性（PRAGMA quick_check）由后端 ensureAccountDatabase 登录时自愈兜底，
 * 这里只做启动期静态隔离（提前发现问题库，避免拖到登录才暴露）。
 * 0 字节文件跳过（SQLite 打开时会自动初始化，非损坏）。
 */
function scanAndHealAccountDatabases(systemDatabasePath) {
  try {
    const accountsDir = path.join(path.dirname(systemDatabasePath), 'accounts');
    if (!fs.existsSync(accountsDir)) return 0;
    const entries = fs
      .readdirSync(accountsDir)
      .filter((name) => name.endsWith('.sqlite'));
    let healed = 0;
    for (const name of entries) {
      const accountPath = path.join(accountsDir, name);
      if (!isSqliteFileHeaderValid(accountPath)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${accountPath}.corrupt-${stamp}`;
        for (const suffix of ['-wal', '-shm']) {
          const sidecar = `${accountPath}${suffix}`;
          if (fs.existsSync(sidecar)) {
            try {
              fs.renameSync(sidecar, `${sidecar}.corrupt-${stamp}`);
            } catch { /* sidecar 隔离失败不阻断主库处理 */ }
          }
        }
        fs.renameSync(accountPath, backupPath);
        fs.copyFileSync(systemDatabasePath, accountPath);
        try { fs.chmodSync(accountPath, 0o600); } catch { /* best effort */ }
        const msg = `[AutoHeal] account DB ${name} header invalid; backed up to ${backupPath}, rebuilt from system template`;
        console.log('[Backend]', msg);
        appendRuntimeLog('backend-launch.log', msg);
        healed += 1;
      }
    }
    return healed;
  } catch (error) {
    console.error('[Backend] scanAndHealAccountDatabases failed:', error.message);
    return 0;
  }
}

function isSqliteFileHeaderValid(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return true; // 空文件：SQLite 打开时自动初始化，非损坏
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(16);
      const read = fs.readSync(fd, header, 0, 16, 0);
      return read === 16 && header.toString('latin1') === 'SQLite format 3\0';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

const SQLITE_ARTIFACT_RETENTION_COUNT = 20;
const SQLITE_ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function pruneDesktopSqliteArtifacts(databasePath) {
  const directory = path.dirname(databasePath);
  const baseName = path.basename(databasePath);
  const prefixes = [
    `${baseName}-wal.orphan-`,
    `${baseName}-shm.orphan-`,
    `${baseName}.bak-`,
    `${baseName}.suspect-`,
    `${baseName}.corrupt-`,
  ];
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    console.warn('[Backend] Unable to scan SQLite recovery artifacts:', error.message);
    return;
  }
  const now = Date.now();
  for (const prefix of prefixes) {
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => {
        const filePath = path.join(directory, entry.name);
        try { return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    candidates.forEach(({ filePath, mtimeMs }, index) => {
      if (index < SQLITE_ARTIFACT_RETENTION_COUNT && now - mtimeMs <= SQLITE_ARTIFACT_RETENTION_MS) return;
      try {
        fs.unlinkSync(filePath);
        console.warn('[Backend] Pruned old SQLite recovery artifact:', filePath);
      } catch (error) {
        console.warn('[Backend] Unable to prune SQLite recovery artifact:', error.message);
      }
    });
  }
}

function ensureDesktopSqliteDatabase(envVars, backendPath) {
  const mode = (envVars.KAYPAL_DESKTOP_DATABASE_MODE || '').trim().toLowerCase();
  if (mode !== 'sqlite') return true;

  const databasePath = resolveSqliteDatabasePath(envVars.SQLITE_DATABASE_URL || envVars.DATABASE_URL, backendPath);
  if (!databasePath) return true;

  pruneDesktopSqliteArtifacts(databasePath);
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(filePath)) {
      try { fs.chmodSync(filePath, 0o600); } catch { /* best effort on non-POSIX hosts */ }
    }
  }

  // 不要在 SQLite 打开前移走 WAL/SHM：异常退出时合法的已提交事务可能仍只
  // 存在 WAL，提前隔离会直接丢数据。SQLite 会校验 WAL 与主库的 salt；只有
  // 后端实际返回明确的 SQLITE_CORRUPT 特征时，healCorruptedDesktopDatabase()
  // 才负责带备份地隔离损坏库并重建。启动阶段只收紧权限，不做不可逆判断。

  const seedPath = path.join(backendPath, 'prisma', 'seed.db');

  // 已存在的库（包括 WAL/SHM）必须原样交给 SQLite 打开和恢复。读取主库前几 MB
  // 只能得到不完整的预检结论：最新 schema/事务可能尚在合法 WAL，启动前据此
  // 替换主库会把用户数据当成损坏数据丢弃。明确的 SQLITE_CORRUPT/NOTADB 只在
  // 后端实际崩溃后由 healCorruptedDesktopDatabase() 带备份处理。
  if (fs.existsSync(databasePath)) {
    if (!sqliteDatabaseHasRequiredSchema(databasePath)) {
      console.warn('[Backend] SQLite schema precheck inconclusive; preserving existing database and sidecars for SQLite recovery:', databasePath);
    }
    return true;
  }

  // 目标库不存在 → 仅此首次初始化场景允许复制无用户数据的包内种子库。
  if (sqliteDatabaseHasRequiredSchema(seedPath)) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.copyFileSync(seedPath, databasePath);
    console.log('[Backend] SQLite database initialized from packaged seed:', databasePath);
  } else {
    console.warn('[Backend] SQLite seed database is missing or incomplete:', seedPath);
  }
  return true;
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
  getBrowserPanel().attach(mainWindow);

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

/**
 * 2026-08-28：打包态后端是 detached 子进程，App 崩溃/被强杀时不会走 before-quit，
 * 残留孤儿进程会一直占着 3011，导致下次启动后端 EADDRINUSE 连续失败——
 * 用户表现为「应用起不来 / 功能全挂且注入的网关键据失效（孤儿拿的是旧 env）」。
 * 这里在 spawn 前探测端口，把占用者（仅本机 3011 上非本进程的 node）清掉。
 * 只针对打包态，避免开发态误杀用户自己的 dev backend。
 */
async function releaseBackendPort(port, backendEntry) {
  if (!app.isPackaged || process.platform === 'win32') return;
  const net = require('node:net');
  const inUse = await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port, '127.0.0.1');
  });
  if (!inUse) return;
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const pids = `${out}`.split(/\s+/).filter(Boolean);
    for (const pid of pids) {
      if (Number(pid) === process.pid) continue;
      let cmd = '';
      try {
        cmd = execFileSync('ps', ['-p', pid, '-o', 'command='], {
          encoding: 'utf8',
          timeout: 3000,
        });
      } catch {
        cmd = '';
      }
      // 只清理「执行我们打包 backend 入口」的残留后端，避免误杀别的服务
      if (cmd && backendEntry && cmd.includes(backendEntry)) {
        console.log(`[Backend] 清理残留后端进程 pid=${pid}（端口 ${port} 被占）`);
        try {
          process.kill(Number(pid), 'SIGKILL');
        } catch (error) {
          console.warn(`[Backend] 清理失败 pid=${pid}: ${error.message}`);
        }
      } else if (cmd) {
        console.warn(`[Backend] 端口 ${port} 被非本应用进程占用(pid=${pid})，跳过清理`);
      }
    }
  } catch (error) {
    console.warn(`[Backend] 端口 ${port} 占用检测失败: ${error.message}`);
  }
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
  if (ensureDesktopSqliteDatabase(envVars, backendPath) === false) {
    backendStartupDiagnostic = 'SQLite 数据库启动保护已阻断：旧 WAL/SHM 或可疑主库无法安全移位';
    backendStartupBlocked = true;
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
    console.error('[Backend]', backendStartupDiagnostic);
    return;
  }
  const desktopDatabasePath = resolveSqliteDatabasePath(
    envVars.SQLITE_DATABASE_URL || envVars.DATABASE_URL,
    backendPath,
  );
  // 供崩溃自愈（healCorruptedDesktopDatabase）定位本次启动使用的库文件
  lastBackendDatabasePath = desktopDatabasePath;
  // 2026-09-01 换库适配：启动扫描账号库文件头，损坏带备份重建
  scanAndHealAccountDatabases(desktopDatabasePath);

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
  const octopCredentials = getOctopAdminCredentials();
  envVars.OCTOP_USERNAME = envVars.OCTOP_USERNAME || octopCredentials.username;
  envVars.OCTOP_PASSWORD = envVars.OCTOP_PASSWORD || octopCredentials.password;
  envVars.OCTOP_ADMIN_USERNAME = envVars.OCTOP_ADMIN_USERNAME || octopCredentials.username;
  envVars.OCTOP_ADMIN_PASSWORD = envVars.OCTOP_ADMIN_PASSWORD || octopCredentials.password;
  // 2026-08-27 Win P1：打包部署态 backend/.env 实为 example 内容（extraResources
  // 同目标覆盖链失效），AGENT_GATEWAY_SECRET 缺失导致非开发环境后端启动即 throw。
  // 进程内随机兜底：本机内存中生成并注入，仅主进程↔spawn 后端同生命周期使用，
  // 无外部消费者；backend/.env 显式提供时优先生效（上方 envFile 解析已入 envVars）。
  if (!envVars.AGENT_GATEWAY_SECRET) {
    envVars.AGENT_GATEWAY_SECRET = ensureGatewaySecret();
  }
  // 2026-08-27：加载打包进包的 kaypal 网关凭据（runtime/generated/release-config.json，
  // 由 prepare-release-config.js 从 KAYPAL_GATEWAY_* env 生成，gitignored），
  // 注入后端出站用：x-kaypal-api-key（ai-content-desktop 条目）+ context JWT 签名配置。
  const generatedConfigPath = getResourcePath('generated/release-config.json');
  if (fs.existsSync(generatedConfigPath)) {
    try {
      const generatedConfig = JSON.parse(fs.readFileSync(generatedConfigPath, 'utf8'));
      const gw = generatedConfig.kaypalGateway || {};
      if (gw.apiKey) envVars.KAYPAL_AI_PROXY_API_KEY = gw.apiKey;
      if (gw.contextJwtSecret) envVars.KAYPAL_CONTEXT_JWT_SECRET = gw.contextJwtSecret;
      if (gw.appId) envVars.KAYPAL_APP_ID = gw.appId;
      if (gw.tenantId) envVars.KAYPAL_TENANT_ID = gw.tenantId;
      if (gw.billingUserId) envVars.KAYPAL_BILLING_USER_ID = gw.billingUserId;
      if (gw.legacyApiKey) envVars.KAYPAL_LEGACY_API_KEY = gw.legacyApiKey;
      if (gw.apiKey && gw.contextJwtSecret) {
        console.log('[Backend] Kaypal gateway credential loaded from release config');
      }
    } catch (error) {
      console.warn('[Backend] 无法读取 release-config.json:', error.message);
    }
  }
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
  // v1.1.103（复核 P1 整改）：记录本次启动时 stderr 日志的写入起点。
  // backend-stderr.log 为追加模式、跨启动累积——自愈特征匹配若读整个文件尾部，
  // 「本次 EADDRINUSE + 历史启动的 malformed 报错」会误命中并清掉健康库。
  // 崩溃时只读取本次启动偏移之后的内容。
  let backendStderrStartOffset = 0;
  try {
    backendStderrStartOffset = fs.existsSync(backendStderrPath) ? fs.statSync(backendStderrPath).size : 0;
  } catch {
    backendStderrStartOffset = 0;
  }
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

  // 2026-08-28：spawn 前清理上次崩溃遗留的孤儿后端（占着 3011 会让本次启动必失败）
  await releaseBackendPort(Number(envVars.PORT || BACKEND_PORT), backendEntry);

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

  backendService.on('close', async (code) => {
    // v1.1.106（复核 P2-C）：isQuitting 判断必须**最先**执行——应用退出时子进程
    // 以 signal 关闭，code 为 null，`null !== 0` 会误入上报/自愈分支（清库风险）。
    // 同时等待两个写流 flush（end() 是异步落盘，立即同步读可能读不到本次
    // P2010/malformed 最后几行，导致应自愈而未自愈）。
    const quitting = isQuitting;
    await Promise.all([
      new Promise((resolve) => {
        backendStdout.end();
        backendStdout.once('finish', resolve);
        backendStdout.once('close', resolve);
        setTimeout(resolve, 2000); // 兜底超时，防挂住 close
      }),
      new Promise((resolve) => {
        backendStderr.end();
        backendStderr.once('finish', resolve);
        backendStderr.once('close', resolve);
        setTimeout(resolve, 2000);
      }),
    ]).catch(() => {});
    const errorLine = stderrTail
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /(?:ERROR|Error:|Exception|Cannot find|ENOENT)/i.test(line));
    backendStartupDiagnostic = `后端进程退出（代码 ${code ?? 'unknown'}）${errorLine ? `：${errorLine.slice(0, 500)}` : ''}`;
    appendRuntimeLog('backend-launch.log', backendStartupDiagnostic);
    // 2026-08-29 兜底上报：后端异常退出直接报云端（本地转发者已死，不能依赖 3011 自报）
    if (!quitting && code !== 0) {
      reportBackendCrash(code, stderrTail || backendStartupDiagnostic);
      // 2026-08-29 自愈：SQLite 数据页损坏时启动前的 schema 预检查发现不了（marker 完好），
      // Prisma 运行时查询才炸。识别损坏特征 → 自动备份 + 重建空库 → 走现有重启链路自愈。
      // v1.1.102：特征匹配输入从 4KB stderrTail 扩大为 backend-stderr.log 尾 64KB
      //（早期 Prisma 损坏信息可能被挤出 stderrTail 窗口——复核 P2 整改）。
      // v1.1.103（复核 P1 整改）：日志为追加模式跨启动累积，必须只读**本次启动**
      // 写入的部分（backendStderrStartOffset 之后）——否则「本次 EADDRINUSE +
      // 历史启动的 malformed 报错」会误命中并清掉健康库。
      const corruptionEvidence = `${stderrTail || ''}\n${tailFileSync(backendStderrPath, 65536, backendStderrStartOffset)}`;
      if (DB_CORRUPT_SIGNATURE.test(corruptionEvidence)) {
        healCorruptedDesktopDatabase('backend crash with sqlite corruption signature');
      }
    }
    console.log(`[Backend] Service exited with code ${code}`);
    if (backendService && backendService.__killTimer) clearTimeout(backendService.__killTimer);
    backendService = null;
    if (quitting) return;
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

// ============ 后端崩溃兜底上报（2026-08-29 补 error-reports 盲区） ============
// 背景：error-reports 自动上报的转发者是本地 3011 后端进程（它持 OSS 凭据）；
// 后端启动即崩时转发者自己死了，前端 bridge 的 POST 也全部失败，OSS 零记录。
// 主进程在崩溃/就绪超时两个挂点把错误摘要直接 POST 云端 /api/v1/client-error 转发落 OSS。
// fire-and-forget + 会话频控（MAX_RESTARTS=3 次重启循环下最多 3 条 + 同指纹去重）。
const backendCrashReportState = { signatures: new Set(), count: 0, maxPerSession: 3 };
// 最近一次后端启动使用的 SQLite 库路径（startBackendService 内赋值），供崩溃自愈定位
let lastBackendDatabasePath = null;
// 自愈频控（v1.1.102 复核整改）：每会话最多 2 次、失败不永久禁用（rename 被锁等
// 临时 I/O 错误下允许下次崩溃重试），防止非数据库原因的崩溃被反复清库丢数据。
let backendDbHealAttempts = 0;
const BACKEND_DB_HEAL_MAX_ATTEMPTS = 2;
// SQLite 损坏特征（v1.1.102 收窄）：只匹配「明确的 SQLite 库级错误」，去掉易误伤的
// 宽泛词（malformed 单词可能出现在无关日志、unable to open 可能是目录权限问题）。
// v1.1.106（复核 P2-C 再收窄）：Prisma code 14（SQLITE_CANTOPEN）是权限/路径问题，
// 不等于数据库损坏，移除；P2010 必须带明确的 corrupted/malformed/not a database
// 关键词才命中（防 database is locked / raw query 误伤）。
// 特征匹配输入改为 backend-stderr.log 尾部 64KB（stderrTail 仅 4KB，早期 Prisma
// 损坏信息可能被挤出窗口——复核 P2 整改）。
const DB_CORRUPT_SIGNATURE = /database disk image is malformed|file is not a database|SQLITE_CORRUPT|SQLITE_NOTADB|PrismaClientKnownRequestError[\s\S]{0,400}code:\s*['"]?(11|26)['"]?|P2010[\s\S]{0,400}(?:malformed|not a database|disk image)/i;

function healCorruptedDesktopDatabase(reason) {
  if (backendDbHealAttempts >= BACKEND_DB_HEAL_MAX_ATTEMPTS) return false;
  backendDbHealAttempts += 1;
  const databasePath = lastBackendDatabasePath;
  if (!databasePath || !fs.existsSync(databasePath)) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // v1.1.110（复核 P1）：移走的 sidecar 记在 try 外，供主库 rename 失败时回滚
  //（否则「sidecar 已移走 + 主库仍在」的中间态会让下次启动读到半残状态）。
  const movedSidecars = [];
  let backupPath = null;
  const rollbackSidecars = () => {
    for (const moved of movedSidecars) {
      try {
        fs.renameSync(`${moved}.corrupt-${stamp}`, moved);
      } catch { /* 回滚失败仅记录，不改变阻断结论 */ }
    }
    movedSidecars.length = 0;
  };
  const rollbackMainDatabase = () => {
    if (!backupPath || !fs.existsSync(backupPath)) return;
    try {
      if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
      fs.renameSync(backupPath, databasePath);
    } catch (rollbackError) {
      console.error(`[Backend] AutoHeal main DB rollback failed: ${rollbackError.message}`);
    }
  };
  try {
    // v1.1.108（复核 P1）：**先移 sidecar 再移主库**——旧实现先 rename 主库，
    // sidecar（WAL/SHM）rename 失败后返回 false，但主库已被移走：重启时
    // ensureDesktopSqliteDatabase 会复制 seed.db 到缺失路径，旧 WAL 仍在原位，
    // 打开新库时同名 WAL 被加载 → 污染。现在：sidecar 全部 rename 成功后才动
    // 主库；任一 sidecar 失败则回滚已移走的 sidecar、主库保持原样，阻断重建。
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${databasePath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        try {
          fs.renameSync(sidecar, `${sidecar}.corrupt-${stamp}`);
          movedSidecars.push(sidecar);
        } catch (error) {
          // 回滚已移走的 sidecar（尽量恢复原状），主库不动
          const rolledBackCount = movedSidecars.length;
          rollbackSidecars();
          console.error(`[Backend] AutoHeal sidecar rename failed (${suffix}): ${error.message}; rolled back ${rolledBackCount} sidecar(s), main DB untouched`);
          appendRuntimeLog('backend-launch.log', `[AutoHeal] BLOCKED: sidecar rename failed (${suffix}) — main DB kept, no rebuild (stale WAL would pollute new DB)`);
          return false;
        }
      }
    }
    // sidecar 全部安全移走 → 再移主库
    backupPath = `${databasePath}.corrupt-${stamp}`;
    fs.renameSync(databasePath, backupPath);
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    createEmptySqliteDatabase(databasePath);
    const msg = `[AutoHeal] SQLite database corrupted (reason: ${reason}); backed up to ${backupPath}, recreated from scratch, backend will restart`;
    console.log('[Backend]', msg);
    appendRuntimeLog('backend-launch.log', msg);
    return true;
  } catch (error) {
    // v1.1.110（复核 P1）：主库 rename/rebuild 失败 → 回滚已移走的 sidecar，
    // 不允许停在「sidecar 已移走 + 主库仍在」的中间态
    rollbackMainDatabase();
    rollbackSidecars();
    console.error('[Backend] AutoHeal failed:', error.message);
    appendRuntimeLog('backend-launch.log', `[AutoHeal] failed (attempt ${backendDbHealAttempts}/${BACKEND_DB_HEAL_MAX_ATTEMPTS}): ${error.message}（sidecar 已回滚）`);
    return false;
  }
}

function tailFileSync(filePath, maxBytes = 4000, startOffset = 0) {
  try {
    const stat = fs.statSync(filePath);
    // v1.1.103：startOffset 之后的范围才有效（日志追加模式下剔除历史启动内容）；
    // 若文件被轮转变小（size < startOffset），回退为读文件尾。
    let start = Math.max(startOffset, stat.size - maxBytes, 0);
    if (start > stat.size) start = Math.max(stat.size - maxBytes, 0);
    const length = stat.size - start;
    if (length <= 0) return '';
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function reportBackendCrash(exitCode, detailText, kind = 'backend-startup-crash') {
  try {
    if (!cloudAPI) return;
    const state = backendCrashReportState;
    if (state.count >= state.maxPerSession) return;
    const detail = String(detailText || '');
    const signature = `${kind}:${detail.slice(0, 300)}`;
    if (state.signatures.has(signature)) return;
    state.signatures.add(signature);
    if (state.signatures.size > 20) state.signatures.clear();
    state.count += 1;
    void cloudAPI.reportClientError({
      kind,
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      message: detail.slice(0, 2000) || '后端启动失败',
      stderrTail: detail.slice(0, 8000),
      launchLog: tailFileSync(path.join(app.getPath('userData'), 'logs', 'backend-launch.log'), 4000),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron || '',
      node: process.versions.node || '',
      dataPath: app.getPath('userData'),
    }).then((ok) => {
      if (ok) console.log('[Backend] 崩溃摘要已上报云端 error-reports');
    });
  } catch (err) {
    console.warn('[Backend] crash report failed(ignored):', err && err.message);
  }
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
  // 读取 backend/.env 里的 OCTOP_*（若有），否则使用当前设备随机持久化凭据。
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
    password: env.OCTOP_ADMIN_PASSWORD || env.OCTOP_PASSWORD || ensureOctopAdminPassword(),
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
  const isTrustedRendererSender = (event) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      !getTabManager().isOwnedWebContents(event.sender) ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame
    ) return false;
    try {
      const senderUrl = new URL(event.senderFrame.url);
      const allowedOrigins = new Set(['http://localhost:3010', 'http://127.0.0.1:3010']);
      if (frontendServerUrl) allowedOrigins.add(new URL(frontendServerUrl).origin);
      return allowedOrigins.has(senderUrl.origin);
    } catch {
      return false;
    }
  };

  // 桌面端系统能力（v1.1.66 修复）：剪贴板写入、登录凭据 safeStorage 加密记忆
  // （登录页「记住账号和密码」）。外部链接走下方已有的 shell:open-external。

  ipcMain.handle('clipboard:write-text', (event, text) => {
    if (!isTrustedRendererSender(event)) return false;
    try {
      const { clipboard } = require('electron');
      clipboard.writeText(String(text ?? ''));
      return true;
    } catch {
      return false;
    }
  });

  const SECURE_STORE_PREFIX = 'loginCredential:';
  ipcMain.handle('secure-store:get', (event, key) => {
    if (!isTrustedRendererSender(event) || typeof key !== 'string' || key.length > 128) return null;
    try {
      const raw = store.get(`${SECURE_STORE_PREFIX}${key}`);
      if (typeof raw !== 'string' || !raw) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(raw, 'base64'));
    } catch {
      return null;
    }
  });

  ipcMain.handle('secure-store:set', (event, key, value) => {
    if (!isTrustedRendererSender(event) || typeof key !== 'string' || key.length > 128) return false;
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      const encrypted = safeStorage.encryptString(String(value ?? ''));
      store.set(`${SECURE_STORE_PREFIX}${key}`, encrypted.toString('base64'));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('secure-store:delete', (event, key) => {
    if (!isTrustedRendererSender(event) || typeof key !== 'string' || key.length > 128) return false;
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

  // 配置管理
  const CONFIG_GET_ALLOWED_KEYS = new Set([
    'autoStartService',
    'hoverBallEnabled',
    'windowBounds',
    'lastLoginUser',
  ]);
  ipcMain.handle('config:get', (event, key) => {
    if (!isTrustedRendererSender(event) || typeof key !== 'string' || !CONFIG_GET_ALLOWED_KEYS.has(key)) {
      console.warn(`[Config] 拒绝通过 config:get 读取未授权 key: ${key}`);
      return null;
    }
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
    if (!isTrustedRendererSender(event) || typeof key !== 'string' || !CONFIG_SET_ALLOWED_KEYS.has(key)) {
      console.warn(`[Config] 拒绝通过 config:set 修改未授权 key: ${key}`);
      return false;
    }
    store.set(key, value);
    return true;
  });

  // 服务管理
  ipcMain.handle('service:restart', async (event) => {
    if (!isTrustedRendererSender(event)) return { success: false };
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

  ipcMain.handle('service:status', (event) => {
    if (!isTrustedRendererSender(event)) return { success: false };
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
  ipcMain.handle('app:get-version', (event) => {
    if (!isTrustedRendererSender(event)) return null;
    return app.getVersion();
  });

  ipcMain.handle('app:check-update', (event) => {
    if (!isTrustedRendererSender(event)) return { success: false };
    checkForUpdates(true);
    return { success: true };
  });

  ipcMain.handle('app:install-update', (event) => {
    if (!isTrustedRendererSender(event)) return { success: false };
    quitAndInstall();
  });

  ipcMain.handle('app:get-update-status', (event) => {
    if (!isTrustedRendererSender(event)) return { success: false };
    return { ...pendingUpdate };
  });

  ipcMain.handle('app:download-update', (event) => {
    if (!isTrustedRendererSender(event)) return { success: false };
    const ok = downloadUpdate();
    return { success: ok };
  });

  ipcMain.handle('app:skip-update', async (event, version) => {
    if (!isTrustedRendererSender(event)) return { success: false };
    // v1.1.110（复核 P1）：skipUpdate 内部要 await electron-updater 的
    // cancelDownload（下载中跳过）——IPC 必须等这条异步取消走完再返回，
    // 否则调用方以为已取消、实际下载仍在跑（退出时仍可能安装被跳过版本）。
    await skipUpdate(version || pendingUpdate.version);
    setPendingUpdate({ hasUpdate: false, phase: 'idle', version: null });
    return { success: true };
  });

  ipcMain.handle('app:get-update-feed-info', (event) => {
    if (!isTrustedRendererSender(event)) return { success: false };
    return getUpdateFeedInfo();
  });

  ipcMain.handle('app:get-platform', (event) => {
    if (!isTrustedRendererSender(event)) return null;
    return process.platform;
  });

  ipcMain.handle('app:get-data-path', (event) => {
    if (!isTrustedRendererSender(event)) return null;
    return app.getPath('userData');
  });

  // 打开外部链接（仅允许 http/https，防 file:// 等本地协议被任意打开）
  ipcMain.handle('shell:open-external', async (event, url) => {
    if (!isTrustedRendererSender(event) || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
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
    if (!isTrustedRendererSender(event) || typeof fullPath !== 'string') return false;
    const resolved = path.resolve(fullPath);
    const allowedRoots = [app.getPath('userData'), process.resourcesPath]
      .filter(Boolean)
      .map((root) => path.resolve(root));
    const allowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
    if (!allowed) {
      console.warn(`[Shell] 拒绝打开沙盒外路径: ${resolved}`);
      return false;
    }
    shell.showItemInFolder(resolved);
    return true;
  });

  // 多工作区标签壳 IPC（tab 条 + 前端 workspace 切换器调用）
  getTabManager().registerIpc(ipcMain);

  // 浏览器面板 IPC（工作流阶段 2）
  // 全部通道的唯一实现在 ./browser-panel-ipc.js —— main.js 与端到端冒烟共用，
  // 避免"E2E 验副本、生产跑另一份"。三条 sender 门禁详见该模块头注释：
  //   strip ∨ trusted（开面板/查状态）/ stripOnly（导航类）/ approvalOnly（批准·拒绝）
  const { registerBrowserPanelIpc } = require('./browser-panel-ipc');
  registerBrowserPanelIpc({
    ipcMain,
    getPanel: getBrowserPanel,
    getWiring: getBrowserWiring,
    isTrustedRendererSender:
      typeof isTrustedRendererSender === 'function' ? isTrustedRendererSender : undefined,
  });

  // —— TraeWork 对齐：浏览器面板入口上顶栏（悬浮球 dock 已退役） ——
  // 面板状态 → 顶部标签条（chip 与宽度预设按钮据此渲染）
  getBrowserPanel().onStateChange((state) => {
    try {
      const strip = getTabManager().tabStrip;
      if (strip && !strip.webContents.isDestroyed()) {
        strip.webContents.send('browser-panel:state', state);
      }
    } catch { /* 标签条尚未创建 */ }
  });
  const isFromTabStrip = (event) => {
    try {
      const strip = getTabManager().tabStrip;
      return !!(strip && !strip.webContents.isDestroyed() && strip.webContents.id === event.sender.id);
    } catch {
      return false;
    }
  };
  const currentBusinessUrl = () => {
    try {
      const tm = getTabManager();
      const tab = tm.tabs.get(tm.activeId);
      const wc = tab && tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
      return (wc && wc.getURL()) || '';
    } catch {
      return '';
    }
  };
  ipcMain.on('tab-strip:browser-show', (e) => {
    if (!isFromTabStrip(e)) return;
    const p = getBrowserPanel();
    if (p.publicState().visible) return;
    if (!p.show()) {
      const url = currentBusinessUrl();
      if (url) { try { p.open({ url }); } catch { /* 非 http(s) 页忽略 */ } }
    }
  });
  ipcMain.on('tab-strip:browser-hide', (e) => {
    if (isFromTabStrip(e)) getBrowserPanel().hide();
  });
  ipcMain.on('tab-strip:browser-open-current', (e) => {
    if (!isFromTabStrip(e)) return;
    const url = currentBusinessUrl();
    if (!url) return;
    try { getBrowserPanel().open({ url }); } catch { /* 非 http(s) 页忽略 */ }
  });
  ipcMain.on('tab-strip:browser-new-tab', (e) => {
    if (!isFromTabStrip(e)) return;
    const p = getBrowserPanel();
    if (p.session) {
      try { p.tabsOperation('new'); } catch { /* 视图不可用时退回 show */ }
      if (!p.publicState().visible) p.show();
    } else {
      const url = currentBusinessUrl() || 'https://www.douyin.com';
      try { p.open({ url }); } catch { /* ignore */ }
    }
  });
  ipcMain.on('tab-strip:browser-width', (e, mode) => {
    if (!isFromTabStrip(e)) return;
    const p = getBrowserPanel();
    if (!p.publicState().visible || !p.window || p.window.isDestroyed()) return;
    const { width } = p.window.getContentBounds();
    const target = mode === 'max' ? Math.floor(width * 0.6) : mode === 'half' ? Math.floor(width * 0.5) : 480;
    p.setWidth(target);
  });
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
    // 2026-08-29 兜底上报：进程可能还活着但 3011 一直不就绪，与崩溃上报走同频控
    reportBackendCrash(
      null,
      backendStartupDiagnostic || `3011 未在 ${BACKEND_READY_TIMEOUT_MS}ms 内就绪（进程 ${backendService ? '存活' : '已退出'}）`,
      'backend-not-ready',
    );
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
  // v1.1.106（大王决策）：悬浮球先禁用——UI 桥断了 5 个版本（preload 漏打包，
  // 点执行必报错），且无引导、用户不知其用途，半成品不配裸奔。默认关闭，
  // 做完整（修复 + 首次使用引导 + 场景演示 + 报错可读提示）并真机验证后再灰度放开。
  // v1.1.111（大王决策：悬浮球不要了）：清理存量配置——≤1.1.105 默认开启时代，
  // 用户 config 里可能已持久化 hoverBallEnabled=true（旧逻辑/开关写入），仅改
  // 默认值清不掉这些机器的残留。启动时直接删键，悬浮球在任何机器上都不再出现。
  if (store.has('hoverBallEnabled')) {
    store.delete('hoverBallEnabled');
  }
  if (store.get('hoverBallEnabled') === true) {
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
  // 阶段 5：关桥 = 停监听 + 销毁 token + 删磁盘凭据文件（退出不留残留 token）
  try {
    const closing = browserBridgeRuntime.close();
    if (closing && typeof closing.catch === 'function') {
      closing.catch((error) => {
        console.warn('[App] closeBrowserBridge failed:', error?.message || error);
      });
    }
  } catch (error) {
    console.warn('[App] closeBrowserBridge failed:', error?.message || error);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 安全：禁止导航到外部 URL
// 2026-09-04（微信登录卡死修复）：面板体系 webContents（浏览器面板/控制条/审批浮层）
// 豁免——面板的产品语义就是浏览第三方平台，跨域导航（微信 oauth 从 open.weixin.qq.com
// 跳回 channels 域 callback、用户点平台页外链）是预期行为；此前被全局拦截导致
// 扫码确认后永远卡「登录中...」（ERR_ABORTED）。主窗/3010 内容仍受白名单保护。
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      if (browserPanel && browserPanel.ownsWebContents(contents)) {
        return; // 面板体系导航自由
      }
    } catch {
      /* 归属判断异常则继续走白名单 */
    }
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
