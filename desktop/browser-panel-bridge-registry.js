'use strict';
/**
 * browser-panel-bridge-registry.js — desktop 面板上行桥的「凭据投递文件」读写
 *
 * 背景：3011 后端**不一定由 desktop 启动**（desktop/main.js 的 startBackendService
 * 在 3011 端口已被占用时会跳过启动），所以 env 注入子进程这条路不可靠。
 * 改为：desktop 把 { endpoint, token } 写进 userData 下的一个 0600 文件，
 * 3011 按需读取（读取时点刷新，能跟上桥重启/换端口）。
 *
 * 模式沿用 backend/src/modules/auth/local-mcp-auth.ts（本机同类先例）：
 *  - 写：mode 0o600 + 写后再 chmodSync(0o600)；
 *  - 读：**存量文件也强制 chmod 0o600**（历史上有 0644 落盘的旧文件，
 *    只在创建时 chmod 覆盖不到，导致本机任意进程可读 token）；
 *  - 目录不存在先 mkdir recursive。
 *
 * 安全边界：
 *  - 文件里**只有** endpoint / token / panelId / 进程信息，**不含**任何业务数据；
 *  - token 生命周期 = 面板生命周期：面板关闭 / 应用退出即 closeBrowserBridge()
 *    并 clearRegistry()，磁盘上不留残留 token；
 *  - 读取方须校验 freshness（mtime 老化 → 视为不可用，fail-closed）。
 */
const fs = require('fs');
const path = require('path');

const REGISTRY_FILE_NAME = 'browser-panel-bridge.json';
const REGISTRY_VERSION = 1;
const PROTOCOL = 'kaypal-browser-bridge';
/** 默认老化阈值：超过此值视为桥已不在（desktop 崩溃没来得及清理时的兜底） */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

function resolveRegistryPath(userDataDir) {
  const explicit = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE?.trim();
  if (explicit) return explicit;
  const dir = String(userDataDir || '').trim();
  if (!dir) {
    throw new Error('resolveRegistryPath: userDataDir 必填');
  }
  return path.join(dir, REGISTRY_FILE_NAME);
}

function chmod600(filePath) {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows 无 POSIX mode，忽略
  }
}

/**
 * 写入凭据投递文件（0600）。
 * @returns {{filePath:string, payload:object}}
 */
function writeRegistry({
  userDataDir,
  endpoint,
  token,
  panelId = null,
  sessionId = null,
  webContentsId = null,
  pid = process.pid,
}) {
  if (!endpoint || typeof endpoint !== 'string') {
    throw new Error('writeRegistry: endpoint 必填');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('writeRegistry: token 必填');
  }
  const filePath = resolveRegistryPath(userDataDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    version: REGISTRY_VERSION,
    protocol: PROTOCOL,
    endpoint,
    token,
    panelId,
    sessionId,
    webContentsId,
    pid,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  chmod600(filePath);
  return { filePath, payload };
}

function isValidPayload(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    value.protocol === PROTOCOL &&
    typeof value.endpoint === 'string' &&
    /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(value.endpoint) &&
    typeof value.token === 'string' &&
    value.token.length > 0
  );
}

/**
 * 读取凭据投递文件（fail-closed）。
 * 文件缺失 / 形状非法 / 非回环 endpoint / 老化 → 全部返回 null。
 * @returns {null | {endpoint:string, token:string, panelId:string|null, sessionId:string|null, webContentsId:number|null, pid:number|null, startedAt:string, filePath:string, ageMs:number}}
 */
function readRegistry({ userDataDir, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now() } = {}) {
  let filePath;
  try {
    filePath = resolveRegistryPath(userDataDir);
  } catch {
    return null;
  }
  if (!fs.existsSync(filePath)) return null;
  // 存量文件强制收紧权限（同 local-mcp-auth.ts 的 S5 修复）
  chmod600(filePath);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  if (!isValidPayload(parsed)) return null;

  const startedAtMs = parsed.startedAt ? Date.parse(parsed.startedAt) : NaN;
  const ageMs = Number.isFinite(startedAtMs) ? Math.max(0, now - startedAtMs) : 0;
  // 没有合法 startedAt 时不按新鲜度放行，而是视为老化（fail-closed）
  if (!Number.isFinite(startedAtMs) || ageMs > maxAgeMs) return null;

  return {
    endpoint: parsed.endpoint,
    token: parsed.token,
    panelId: parsed.panelId ?? null,
    sessionId: parsed.sessionId ?? null,
    webContentsId: parsed.webContentsId ?? null,
    pid: typeof parsed.pid === 'number' ? parsed.pid : null,
    startedAt: parsed.startedAt,
    filePath,
    ageMs,
  };
}

/** 删除凭据投递文件（关桥/退出时调用，磁盘不留残留 token） */
function clearRegistry({ userDataDir } = {}) {
  let filePath;
  try {
    filePath = resolveRegistryPath(userDataDir);
  } catch {
    return false;
  }
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

module.exports = {
  REGISTRY_FILE_NAME,
  REGISTRY_VERSION,
  PROTOCOL,
  DEFAULT_MAX_AGE_MS,
  resolveRegistryPath,
  writeRegistry,
  readRegistry,
  clearRegistry,
};
