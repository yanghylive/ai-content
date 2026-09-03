'use strict';
/**
 * browser-panel-mode-registry.js — 「Agent 是否通过右侧面板代操作」的开关投递文件
 *
 * 为什么不是直接把 KAYPAL_AGENT_PANEL_MODE 塞进 3011 的启动 env：
 *  1. 3011 **不一定由 desktop 启动**（端口被占用时 desktop 会跳过启动），env 注入
 *     覆盖不到"后端已经在外头跑着"的场景——与桥凭据文件同一个理由；
 *  2. 灰度要**可控范围 + 可回退**：开关落在 userData 下，只影响这一台机器、
 *     这一个用户；删掉文件立刻回到 off（不用重启后端，下一次读取即生效）。
 *
 * 模式沿用 browser-panel-bridge-registry.js（0600 + 老化 + pid 探活），
 * 唯一区别：这个文件里**没有 token**，只有 mode，所以老化阈值可以宽松
 * （7 天）。desktop 关面板/退出时会主动清掉，老化只是"崩了没来得及清"的兜底。
 *
 * 安全边界：
 *  - 只写 'on' / 'off'，任何其他值在读取侧一律判为不可用（fail-closed → off）；
 *  - pid 探活：写文件进程已死 → 视为不可用（防止残留文件把开关永久顶开）；
 *  - 文件缺失 = 未开启（**默认 off** 铁律不变）。
 */
const fs = require('fs');
const path = require('path');

const MODE_FILE_NAME = 'browser-panel-mode.json';
const MODE_VERSION = 1;
const PROTOCOL = 'kaypal-browser-panel-mode';
/** 老化阈值（兜底用，正常由 desktop 主动清理）：7 天 */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function resolveModePath(userDataDir) {
  const explicit = process.env.KAYPAL_BROWSER_PANEL_MODE_FILE?.trim();
  if (explicit) return explicit;
  const dir = String(userDataDir || '').trim();
  if (!dir) {
    throw new Error('resolveModePath: userDataDir 必填');
  }
  return path.join(dir, MODE_FILE_NAME);
}

function chmod600(filePath) {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows 无 POSIX mode，忽略
  }
}

/** pid 存活探测：signal 0 只探活不发信号；ESRCH=已死，EPERM=活着但没权限 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

/**
 * 写入开关（0600）。
 * @param {{userDataDir:string, mode:'on'|'off', pid?:number}} input
 * @returns {{filePath:string, payload:object}}
 */
function writeMode({ userDataDir, mode, pid = process.pid }) {
  if (mode !== 'on' && mode !== 'off') {
    throw new Error(`writeMode: mode 只能是 on/off，收到 ${String(mode)}`);
  }
  const filePath = resolveModePath(userDataDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    version: MODE_VERSION,
    protocol: PROTOCOL,
    mode,
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

/**
 * 读开关（fail-closed）。文件缺失 / 形状非法 / mode 非 on|off / 老化 / 进程已死
 * → 全部返回 null（= 未开启）。
 * @returns {null | {mode:'on'|'off', pid:number|null, startedAt:string, filePath:string, ageMs:number}}
 */
function readMode({
  userDataDir,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = Date.now(),
  checkPid = true,
} = {}) {
  let filePath;
  try {
    filePath = resolveModePath(userDataDir);
  } catch {
    return null;
  }
  if (!fs.existsSync(filePath)) return null;
  // 存量文件强制收紧权限（同 bridge registry）
  chmod600(filePath);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.protocol !== PROTOCOL) return null;
  if (parsed.mode !== 'on' && parsed.mode !== 'off') return null;

  const startedAtMs = parsed.startedAt ? Date.parse(parsed.startedAt) : NaN;
  const ageMs = Number.isFinite(startedAtMs) ? Math.max(0, now - startedAtMs) : 0;
  // 没有合法 startedAt 时按老化处理（fail-closed）
  if (!Number.isFinite(startedAtMs) || ageMs > maxAgeMs) return null;

  if (checkPid && typeof parsed.pid === 'number' && !isPidAlive(parsed.pid)) {
    return null;
  }

  return {
    mode: parsed.mode,
    pid: typeof parsed.pid === 'number' ? parsed.pid : null,
    startedAt: parsed.startedAt,
    filePath,
    ageMs,
  };
}

/** 删除开关文件（关面板/退出时调用；删掉即回到默认 off） */
function clearMode({ userDataDir } = {}) {
  let filePath;
  try {
    filePath = resolveModePath(userDataDir);
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
  MODE_FILE_NAME,
  MODE_VERSION,
  PROTOCOL,
  DEFAULT_MAX_AGE_MS,
  resolveModePath,
  isPidAlive,
  writeMode,
  readMode,
  clearMode,
};
