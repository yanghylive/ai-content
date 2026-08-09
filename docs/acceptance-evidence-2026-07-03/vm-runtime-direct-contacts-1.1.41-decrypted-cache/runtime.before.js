#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ENGINE_NAME = 'kaypal-wechat-native-runtime';
const ENGINE_VERSION = '0.5.0';
const UNIFIED_COMMAND_CONTRACT_VERSION = '2026-06-26.wechat-native-v1';
const CONTACTS_CONTRACT_VERSION = 'kaypal-wechat-native-contacts/v1';
const DB_HELPER_CONTRACT_VERSION = 'kaypal-wechat-db-helper/v1';
const SUPPORTED_COMMANDS = [
  'contacts',
  'group-broadcast',
  'contact-add',
  'moments-publish',
  'moments-marketing',
  'chat-history',
];
const CONTROLLED_COMMANDS = SUPPORTED_COMMANDS.filter((command) => command !== 'contacts');
const MAX_DB_DEPTH = 8;
const MAX_DB_FILES = 120;
const MAX_UIA_NODES = 1800;
const RANDOM_DB_LIMIT = 500;
const RANDOM_UIA_LIMIT = 120;
const ALL_DB_LIMIT = 50000;
const UIA_ALL_MAX_PAGES = 80;
const UIA_ALL_LOW_CONTACT_THRESHOLD = 10;

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)]),
  );
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function commandFromPayload(payload) {
  const candidate = compactText(payload.command || process.argv[2] || 'contacts');
  return candidate || 'contacts';
}

function normalizeStatus(payload, errorCode) {
  if (payload.status) return payload.status;
  if (payload.ok) return 'success';
  if ([
    'approval_required',
    'permission_missing',
    'runtime_unavailable',
    'unsupported_platform',
    'wechat_not_running',
    'wechat_not_logged_in',
    'target_missing',
    'target_not_found',
    'target_ambiguous',
  ].includes(errorCode)) {
    return 'blocked';
  }
  return 'failed';
}

function inferErrorCode(payload) {
  if (payload.errorCode) return payload.errorCode;
  if (payload.ok) return 'success';
  const command = commandFromPayload(payload);
  const diagnostics = payload.diagnostics || {};
  const layers = asRecord(diagnostics.layers);
  const windowLayer = asRecord(layers.window);
  const previewText = [
    ...(Array.isArray(diagnostics.rawPreview) ? diagnostics.rawPreview : []),
    ...(Array.isArray(diagnostics.ocrPreview) ? diagnostics.ocrPreview : []),
  ].join(' ');
  const errorText = compactText(payload.error || payload.message || diagnostics.failureReason);
  const diagnosticText = compactText([
    errorText,
    diagnostics.stage,
    diagnostics.uiaStatus,
    diagnostics.uiaError,
    diagnostics.failureReason,
    diagnostics.fallbackReason,
    previewText,
  ].filter(Boolean).join(' '));
  if (diagnostics.platformStatus === 'unsupported' || /not-windows|只能在 Windows|platform is not win32/i.test(errorText)) {
    return 'unsupported_platform';
  }
  if (/not implemented|尚未实现|not_implemented/i.test(errorText)) return 'runtime_unavailable';
  if (/扫码登录|扫描登录|二维码|登录微信|scan.*login|login/i.test(diagnosticText)) {
    return 'wechat_not_logged_in';
  }
  if (diagnostics.windowStatus === 'not-found') {
    const processId = Number(diagnostics.processId || windowLayer.processId || 0);
    const processName = compactText(diagnostics.processName || windowLayer.processName);
    if (processId > 0 || processName) return 'permission_missing';
    return 'wechat_not_running';
  }
  if (
    command === 'contacts' &&
    /not-wechat-contacts-page|contacts page|通讯录页|没有停在微信通讯录|只识别到 0 个联系人/i.test(diagnosticText)
  ) {
    return 'target_not_found';
  }
  if (/timeout|超时/i.test(errorText)) return 'timeout';
  return 'unknown';
}

function errorCategory(errorCode) {
  if (['unsupported_platform', 'runtime_unavailable', 'timeout', 'cancelled'].includes(errorCode)) return 'runtime';
  if (['permission_missing', 'approval_required'].includes(errorCode)) return 'permission';
  if (['wechat_not_running', 'wechat_not_logged_in'].includes(errorCode)) return 'login';
  if (['target_missing', 'target_not_found', 'target_ambiguous'].includes(errorCode)) return 'target';
  if (['content_invalid', 'media_missing'].includes(errorCode)) return 'content';
  if (['captcha_required', 'risk_prompt_detected', 'rate_limited'].includes(errorCode)) return 'risk';
  if (['readback_failed'].includes(errorCode)) return 'readback';
  return 'unknown';
}

function defaultNextAction(command, status, errorCode) {
  if (status === 'success') {
    if (command === 'contacts') return '联系人已同步，可以写入缓存或继续执行只读分析。';
    if (command === 'diagnose') return '诊断已完成，请查看 diagnostics.layers 判断下一步。';
    if (command === 'contract' || command === 'helper-contract') return '合同摘要已输出，可按 commandMatrix 对接调用方。';
    return '命令已完成。';
  }
  if (errorCode === 'unsupported_platform') return '请在 Windows 桌面端运行该 native runtime。';
  if (errorCode === 'permission_missing') {
    return '微信进程存在，但当前执行器拿不到可控窗口；请在同一个已登录的用户桌面会话打开微信通讯录，避免从服务会话或管理员/非管理员混合会话启动。';
  }
  if (errorCode === 'wechat_not_running') return '请打开并登录 Windows 微信，再重试联系人同步。';
  if (errorCode === 'wechat_not_logged_in') return '微信窗口已打开，但停在登录页；请先扫码登录，再切到通讯录页重新同步。';
  if (command === 'contacts' && errorCode === 'target_not_found') return '微信窗口已打开，但当前不是通讯录页；请先扫码登录并切到左侧“通讯录”，再重新同步。';
  if (errorCode === 'runtime_unavailable') return '当前仅注册命令边界，保持人工/审批流程；不要按真实发送或发布处理。';
  if (command === 'contacts') return '请确认 Windows 微信已打开到通讯录，或检查 DB helper/诊断输出后重试。';
  return '请查看 errorCode 和 diagnostics，修复阻断项后重试。';
}

function normalizeDiagnostics(command, diagnostics, status) {
  const now = new Date().toISOString();
  const stage = compactText(diagnostics && diagnostics.stage) || (status === 'success' ? `${command}-completed` : `${command}-${status}`);
  return {
    ...diagnostics,
    command,
    stage,
    completedAt: (diagnostics && diagnostics.completedAt) || now,
    runtime: {
      engine: ENGINE_NAME,
      engineVersion: ENGINE_VERSION,
      enginePath: __filename,
      nativeRuntimeVersion: ENGINE_VERSION,
      platform: process.platform,
      ...((diagnostics && diagnostics.runtime) || {}),
    },
    warnings: Array.isArray(diagnostics && diagnostics.warnings)
      ? diagnostics.warnings
      : [],
  };
}

function mapContactsOutputSource(source) {
  if (/db/i.test(source || '')) return 'wechat-db';
  if (/uia/i.test(source || '')) return 'uia';
  if (/cache/i.test(source || '')) return 'cache';
  if (source) return 'native-runtime';
  return 'empty';
}

function contactsOutputFromPayload(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    source: payload.ok ? mapContactsOutputSource(payload.source) : 'empty',
    contacts: items.map((item) => {
      const contact = asRecord(item);
      const wxid = compactText(contact.wxid || contact.alias || contact.nickname || contact.remark || contact.displayName);
      const displayName = compactText(contact.displayName || contact.remark || contact.nickname || contact.wxid || wxid);
      return {
        wxid: wxid || displayName || 'unknown',
        nickname: compactText(contact.nickname),
        remark: compactText(contact.remark),
        displayName: displayName || wxid || 'unknown',
        tags: Array.isArray(contact.tags) ? contact.tags.map(compactText).filter(Boolean) : [],
        currentWechatId: compactText(contact.currentWechatId),
        plannedWechatId: compactText(contact.plannedWechatId),
        syncedAt: payload.syncedAt,
        raw: contact.raw,
      };
    }),
    count: items.length,
    currentWechatId: payload.currentWechatId,
    plannedWechatId: payload.plannedWechatId,
    syncedAt: payload.syncedAt,
    exportedContent: payload.exportedContent,
  };
}

function buildErrorDetail(payload, errorCode, status, nextAction) {
  if (payload.ok) return undefined;
  const message = compactText(payload.error || payload.message || 'WeChat native command failed.');
  return {
    code: errorCode,
    category: errorCategory(errorCode),
    message,
    technicalMessage: compactText(payload.technicalMessage),
    stage: compactText(payload.diagnostics && payload.diagnostics.stage),
    retryable: Boolean(payload.retryable),
    manualActionRequired: status === 'blocked' || Boolean(payload.manualActionRequired),
    nextAction,
    raw: payload.errorRaw,
  };
}

function respond(payload, code = 0) {
  const command = commandFromPayload(payload);
  const errorCode = inferErrorCode(payload);
  const status = normalizeStatus(payload, errorCode);
  const nextAction = payload.nextAction || defaultNextAction(command, status, errorCode);
  const diagnostics = normalizeDiagnostics(command, payload.diagnostics || {}, status);
  const output = payload.output || (command === 'contacts' ? contactsOutputFromPayload(payload) : undefined);
  const response = stripUndefined({
    ...payload,
    ok: Boolean(payload.ok),
    engine: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    contractVersion: UNIFIED_COMMAND_CONTRACT_VERSION,
    legacyContractVersion: command === 'contacts' ? CONTACTS_CONTRACT_VERSION : undefined,
    command,
    status,
    errorCode,
    nextAction,
    output,
    diagnostics,
    errorDetail: payload.errorDetail || buildErrorDetail(payload, errorCode, status, nextAction),
  });
  fs.writeSync(1, `${JSON.stringify(response)}\n`);
  process.exit(code);
}

function emit(payload, code = 0) {
  respond(payload, code);
}

function fail(command, payload, code = 1) {
  respond({
    ...payload,
    command,
    ok: false,
  }, code);
}

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function compactText(value) {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleepMs(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!delay) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, delay);
}

function copyFileWithRetries(sourcePath, targetPath, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 8);
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs) || 120);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.copyFileSync(sourcePath, targetPath);
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) sleepMs(baseDelayMs * attempt);
    }
  }
  return {
    ok: false,
    attempts,
    error: compactText(lastError && lastError.message ? lastError.message : lastError),
  };
}

function toBase64Utf8(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function runPowerShellSharedReadCopy(sourcePath, targetPath) {
  if (process.platform !== 'win32') {
    return { ok: false, status: 'skipped', reason: 'non-windows' };
  }
  const scriptPath = path.join(
    os.tmpdir(),
    `kaypal-wechat-shared-copy-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
  );
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $sourcePath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(sourcePath)}'))
  $targetPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(targetPath)}'))
  $targetDir = [System.IO.Path]::GetDirectoryName($targetPath)
  if (-not [string]::IsNullOrWhiteSpace($targetDir)) {
    [System.IO.Directory]::CreateDirectory($targetDir) | Out-Null
  }
  if (Test-Path -LiteralPath $targetPath) {
    Remove-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue
  }
  $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  $inputStream = [System.IO.File]::Open($sourcePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
  try {
    $outputStream = [System.IO.File]::Open($targetPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    try {
      $inputStream.CopyTo($outputStream)
    } finally {
      $outputStream.Dispose()
    }
  } finally {
    $inputStream.Dispose()
  }
  [ordered]@{
    ok = (Test-Path -LiteralPath $targetPath)
    outputPath = $targetPath
    outputBytes = if (Test-Path -LiteralPath $targetPath) { (Get-Item -LiteralPath $targetPath).Length } else { 0 }
  } | ConvertTo-Json -Compress
} catch {
  [ordered]@{
    ok = $false
    error = $_.Exception.Message
    errorType = $_.Exception.GetType().FullName
  } | ConvertTo-Json -Compress
  exit 3
}
`;
  try {
    fs.writeFileSync(
      scriptPath,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, 'utf16le')]),
    );
    const result = run(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
    );
    const jsonLine = findLastJsonLine(result.stdout);
    const parsed = jsonLine ? safeJsonParse(jsonLine) : {};
    return {
      ok: Boolean(parsed.ok) && fs.existsSync(targetPath),
      status: result.status === 0 ? 'completed' : 'failed',
      exitCode: result.status,
      outputPath: parsed.outputPath || targetPath,
      outputBytes: Number(parsed.outputBytes) || 0,
      error: compactText(parsed.error || parsed.parseError || result.stderr || result.stdout || result.error?.message || ''),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      error: compactText(error && error.message ? error.message : error),
    };
  } finally {
    try {
      fs.rmSync(scriptPath, { force: true });
    } catch {
      // Best effort temp cleanup.
    }
  }
}

function normalizeContactText(value) {
  const text = compactText(value);
  const compact = text.replace(/\s+/g, '');
  if (!compact || compact.length < 2 || compact.length > 80) return '';
  if (/^(微信|WeChat|Weixin|通讯录|联系人|新的朋友|朋友|群聊|标签|公众号|服务号|订阅号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|服务通知|小程序|更多|全部|添加朋友|发现|我|设置|通用|取消|确定|保存|返回|完成)$/.test(compact)) return '';
  if (/抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|AI员工|Kaypal|版本更新|同步通讯录|立即执行|定时计划/.test(text)) return '';
  if (/^[\d\s:：.,，。/\\-]+$/.test(compact)) return '';
  if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(compact)) return '';
  return text;
}

function uniqueText(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const value = compactText(item);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function findLastJsonLine(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if ((line.startsWith('{') && line.endsWith('}')) || (line.startsWith('[') && line.endsWith(']'))) {
      return line;
    }
  }
  return '';
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return { parseError: error.message };
  }
}

function contractSummary(mode) {
  const uiaFallbackEnabled = process.env.AI_CONTENT_WECHAT_ALLOW_UIA_CONTACT_FALLBACK === '1';
  return {
    version: CONTACTS_CONTRACT_VERSION,
    mode,
    command: 'contacts --mode random|all',
    successShape: {
      ok: true,
      mode: 'random|all',
      source: uiaFallbackEnabled
        ? 'windows-wechat-native-db|windows-wechat-native-helper|windows-wechat-native-uia|windows-wechat-native-uia-scroll'
        : 'windows-wechat-native-db|windows-wechat-native-helper',
      contacts: 'string[] display names derived from items',
      items: 'Array<{ wxid, nickname, remark, alias, tags, source }>',
      count: 'items.length',
      syncedAt: 'ISO-8601 timestamp',
      diagnostics: 'structured layer diagnostics',
    },
    failureShape: {
      ok: false,
      mode: 'random|all',
      error: 'user-safe failure summary',
      diagnostics: 'includes platform/window/db/helper/uia layer status and failureLayer',
    },
    modeSemantics: {
      random: uiaFallbackEnabled
        ? `bounded best-effort sample: plaintext/helper DB up to ${RANDOM_DB_LIMIT}, UIA visible-page fallback up to ${RANDOM_UIA_LIMIT}`
        : `database/helper sync only up to ${RANDOM_DB_LIMIT}; UIA/OCR screen collection is disabled by default`,
      all: uiaFallbackEnabled
        ? `best-effort full sync: plaintext/helper DB up to ${ALL_DB_LIMIT}, UIA scroll fallback up to ${UIA_ALL_MAX_PAGES} pages`
        : `database/helper full sync only up to ${ALL_DB_LIMIT}; UIA/OCR screen collection is disabled by default`,
    },
  };
}

function addPath(list, candidate) {
  if (!candidate) return;
  try {
    const full = path.resolve(String(candidate));
    if (fs.existsSync(full) && !list.some((item) => item.toLowerCase() === full.toLowerCase())) {
      list.push(full);
    }
  } catch {
    // Best effort only.
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout || 15000,
    ...options,
  });
}

function runPowerShell(script, timeout = 20000) {
  return run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout },
  );
}

function queryRegistryValue(key, name) {
  if (process.platform !== 'win32') return '';
  const result = run('reg.exe', ['query', key, '/v', name], { timeout: 8000 });
  if (result.status !== 0) return '';
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const line = text.split(/\r?\n/).find((item) => item.includes(name));
  if (!line) return '';
  const parts = line.trim().split(/\s{2,}/);
  return parts.length >= 3 ? parts.slice(2).join(' ').trim() : '';
}

function wechatRoots() {
  const roots = [];
  const home = os.homedir();
  addPath(roots, process.env.AI_CONTENT_WECHAT_CONTACT_DB_DIR);
  addPath(roots, process.env.AI_CONTENT_WECHAT_FILES_DIR);
  addPath(roots, process.env.WECHAT_FILES_DIR);
  addPath(roots, path.join(home, 'Documents', 'WeChat Files'));
  addPath(roots, path.join(home, 'Documents', 'xwechat_files'));

  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.USERPROFILE]) {
    if (!base) continue;
    addPath(roots, path.join(base, 'Tencent', 'WeChat'));
    addPath(roots, path.join(base, 'Tencent', 'Weixin'));
    addPath(roots, path.join(base, 'Documents', 'WeChat Files'));
    addPath(roots, path.join(base, 'Documents', 'xwechat_files'));
  }

  if (process.platform === 'win32') {
    const usersRoots = [
      path.join(process.env.SystemDrive || 'C:', 'Users'),
      'C:\\Users',
    ];
    for (const usersRoot of usersRoots) {
      let entries = [];
      try {
        entries = fs.readdirSync(usersRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const userHome = path.join(usersRoot, entry.name);
        addPath(roots, path.join(userHome, 'Documents', 'WeChat Files'));
        addPath(roots, path.join(userHome, 'Documents', 'xwechat_files'));
      }
    }
  }

  for (const regName of ['FileSavePath', 'InstallPath']) {
    const value = queryRegistryValue('HKCU\\Software\\Tencent\\WeChat', regName);
    addPath(roots, value);
    if (value) {
      addPath(roots, path.join(value, 'WeChat Files'));
      addPath(roots, path.join(value, 'xwechat_files'));
    }
  }

  return roots;
}

function normalizedPathKey(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function parseWechatFilesPath(commandLine) {
  const text = String(commandLine || '');
  const quoted = text.match(/--wechat-files-path="([^"]+)"/i);
  if (quoted && quoted[1]) return quoted[1];
  const plain = text.match(/--wechat-files-path=([^\s]+)/i);
  return plain && plain[1] ? plain[1] : '';
}

function activeWechatFilesRoots(processInfo = {}) {
  const roots = [];
  addPath(roots, processInfo.wechatFilesPath);
  if (Array.isArray(processInfo.wechatFilesPaths)) {
    for (const item of processInfo.wechatFilesPaths) addPath(roots, item);
  }
  addPath(roots, process.env.AI_CONTENT_ACTIVE_WECHAT_FILES_DIR);
  return roots;
}

function isUnderRoot(dbPath, root) {
  const dbKey = normalizedPathKey(dbPath);
  const rootKey = normalizedPathKey(root);
  return Boolean(rootKey && (dbKey === rootKey || dbKey.startsWith(`${rootKey}/`)));
}

function activeRootScore(dbPath, activeRoots) {
  for (let index = 0; index < activeRoots.length; index += 1) {
    if (isUnderRoot(dbPath, activeRoots[index])) return activeRoots.length - index;
  }
  return 0;
}

function findFilesLimited(root, names, maxDepth = MAX_DB_DEPTH, maxCount = MAX_DB_FILES) {
  const found = [];
  if (!root || !fs.existsSync(root)) return found;
  const wanted = new Set(names.map((item) => item.toLowerCase()));
  const queue = [{ dir: root, depth: 0 }];

  while (queue.length && found.length < maxCount) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) queue.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (wanted.has(entry.name.toLowerCase())) {
        addPath(found, full);
        if (found.length >= maxCount) break;
      }
    }
  }
  return found;
}

function safeStat(candidate) {
  try {
    return candidate && fs.existsSync(candidate) ? fs.statSync(candidate) : null;
  } catch {
    return null;
  }
}

const recentDirMtimeCache = new Map();

function latestChildMtimeMs(dirPath, maxEntries = 160) {
  const key = normalizedPathKey(dirPath);
  if (!key) return 0;
  if (recentDirMtimeCache.has(key)) return recentDirMtimeCache.get(key);
  let latest = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    recentDirMtimeCache.set(key, 0);
    return 0;
  }
  for (const entry of entries.slice(0, maxEntries)) {
    const full = path.join(dirPath, entry.name);
    const stat = safeStat(full);
    if (!stat) continue;
    latest = Math.max(latest, Number(stat.mtimeMs) || 0, Number(stat.ctimeMs) || 0);
  }
  recentDirMtimeCache.set(key, latest);
  return latest;
}

function extractDbAccountInfo(dbPath) {
  const text = String(dbPath || '');
  const normalized = text.replace(/\\/g, '/');
  const match = normalized.match(/(?:^|\/)(xwechat_files|WeChat Files)\/([^/]+)(?:\/|$)/i);
  const rootKind = match ? match[1] : '';
  const accountFolder = match ? match[2] : '';
  const baseWxidMatch = accountFolder.match(/^(wxid_[A-Za-z0-9]+)(?:_|$)/i);
  const baseWxid = baseWxidMatch ? baseWxidMatch[1] : accountFolder;
  const lower = normalized.toLowerCase();
  const accountRoot = match
    ? normalized.slice(0, normalized.indexOf(`/${rootKind}/`) + rootKind.length + accountFolder.length + 2)
    : '';
  return {
    path: text,
    rootKind,
    accountFolder,
    baseWxid,
    accountRoot,
    isBackup: /\/backup(?:\/|$)/i.test(normalized),
    isAllUsers: /\/all_users(?:\/|$)/i.test(normalized) || accountFolder.toLowerCase() === 'all_users',
    isXWechat: rootKind.toLowerCase() === 'xwechat_files',
    isContactDb: /\/db_storage\/contact\/contact\.db$/i.test(normalized) || /\/contact\.db$/i.test(normalized),
    isMessageDb: /\/(?:msg|db_storage\/message|message)\/[^/]*(?:micromsg|msg)\.db$/i.test(lower) || /\/(?:micromsg|msg)\.db$/i.test(lower),
  };
}

function candidateProbePaths(dbPath, info) {
  const probes = [dbPath, path.dirname(dbPath), info.accountRoot];
  if (info.accountRoot) {
    probes.push(
      path.join(info.accountRoot, 'db_storage'),
      path.join(info.accountRoot, 'db_storage', 'contact'),
      path.join(info.accountRoot, 'db_storage', 'session'),
      path.join(info.accountRoot, 'db_storage', 'message'),
      path.join(info.accountRoot, 'db_storage', 'msg'),
      path.join(info.accountRoot, 'db_storage', 'chat'),
      path.join(info.accountRoot, 'db_storage', 'ChatMsg'),
      path.join(info.accountRoot, 'config'),
      path.join(info.accountRoot, 'msg'),
      path.join(info.accountRoot, 'resource'),
      path.join(info.accountRoot, 'temp'),
    );
  }
  return probes.filter(Boolean);
}

function describeDbCandidate(dbPath) {
  const info = extractDbAccountInfo(dbPath);
  let activeMtimeMs = 0;
  let sizeBytes = 0;
  const dbStat = safeStat(dbPath);
  if (dbStat) sizeBytes = Number(dbStat.size) || 0;
  for (const probe of candidateProbePaths(dbPath, info)) {
    const stat = safeStat(probe);
    if (!stat) continue;
    activeMtimeMs = Math.max(activeMtimeMs, Number(stat.mtimeMs) || 0, Number(stat.ctimeMs) || 0);
    if (stat.isDirectory()) {
      activeMtimeMs = Math.max(activeMtimeMs, latestChildMtimeMs(probe));
    }
  }
  let score = 0;
  if (info.isXWechat) score += 80;
  if (info.isContactDb) score += 60;
  if (info.accountFolder && !info.isAllUsers && !info.isBackup) score += 20;
  if (info.isMessageDb) score -= 20;
  if (info.isAllUsers || info.isBackup) score -= 2000;
  score += Math.min(80, Math.floor(sizeBytes / 1024 / 1024));
  return {
    ...info,
    sizeBytes,
    activeMtimeMs,
    activeMtime: activeMtimeMs ? new Date(activeMtimeMs).toISOString() : '',
    score,
  };
}

function rankContactDbCandidates(paths, processInfo = {}) {
  const activeRoots = activeWechatFilesRoots(processInfo);
  return paths
    .map((dbPath, index) => ({
      dbPath,
      index,
      details: describeDbCandidate(dbPath),
      activeRootScore: activeRootScore(dbPath, activeRoots),
    }))
    .sort((left, right) => {
      const explicitLeft = left.dbPath === path.resolve(String(process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH || '')) ? 1 : 0;
      const explicitRight = right.dbPath === path.resolve(String(process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH || '')) ? 1 : 0;
      if (explicitLeft !== explicitRight) return explicitRight - explicitLeft;
      if (left.activeRootScore !== right.activeRootScore) return right.activeRootScore - left.activeRootScore;
      if (left.details.activeMtimeMs !== right.details.activeMtimeMs) {
        return right.details.activeMtimeMs - left.details.activeMtimeMs;
      }
      if (left.details.sizeBytes !== right.details.sizeBytes) return right.details.sizeBytes - left.details.sizeBytes;
      if (left.details.score !== right.details.score) return right.details.score - left.details.score;
      return left.index - right.index;
    })
    .map((item) => item.dbPath);
}

function findContactDbCandidates(processInfo = {}) {
  const paths = [];
  addPath(paths, process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH);
  const roots = [...activeWechatFilesRoots(processInfo), ...wechatRoots()];
  for (const root of roots) {
    for (const dbPath of findFilesLimited(root, ['contact.db', 'Contact.db', 'MicroMsg.db', 'MSG.db'])) {
      addPath(paths, dbPath);
    }
  }
  return rankContactDbCandidates(paths, processInfo);
}

function findSqlitePath() {
  const candidates = [
    process.env.AI_CONTENT_SQLITE_EXE,
    process.env.SQLITE_EXE,
    path.join(__dirname, '..', 'wechat-db-helper', 'sqlite3.exe'),
    path.join(__dirname, 'sqlite3.exe'),
    'sqlite3.exe',
    'sqlite3',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) || candidate.includes('/')) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    const result = run(candidate, ['-version'], { timeout: 4000 });
    if (result.status === 0) return candidate;
  }
  return '';
}

function findDecryptionHelpers() {
  const helpers = [];
  const candidates = [
    process.env.AI_CONTENT_WECHAT_DB_HELPER,
    process.env.AI_CONTENT_WECHAT_KEY_HELPER,
    path.join(__dirname, '..', 'wechat-db-helper', 'wechat-db-helper.exe'),
    path.join(__dirname, '..', 'wechat-db-helper', 'wechat-db-helper.js'),
    path.join(__dirname, '..', 'wechat-db-helper', 'wechat-dump-rs.exe'),
    path.join(__dirname, '..', 'wechat-db-helper', 'wx_key.dll'),
    path.join(__dirname, 'wechat-db-helper.exe'),
    path.join(__dirname, 'wechat-db-helper.js'),
    path.join(__dirname, 'wechat-dump-rs.exe'),
    path.join(__dirname, 'wx_key.dll'),
  ].filter(Boolean);
  for (const candidate of candidates) addPath(helpers, candidate);
  return helpers;
}

function helperKind(helperPath) {
  const ext = path.extname(String(helperPath || '')).toLowerCase();
  if (ext === '.dll') return 'library';
  if (ext === '.js') return 'node-script';
  if (ext === '.ps1') return 'powershell-script';
  if (ext === '.cmd' || ext === '.bat') return 'shell-script';
  if (ext === '.exe' || !ext) return 'executable';
  return 'unknown';
}

function describeDbHelpers(paths) {
  return paths.map((helperPath) => {
    const kind = helperKind(helperPath);
    const runnable = ['executable', 'node-script', 'powershell-script', 'shell-script'].includes(kind);
    return {
      path: helperPath,
      kind,
      runnable,
      contractVersion: DB_HELPER_CONTRACT_VERSION,
    };
  });
}

function firstRunnableHelper(helperInfos) {
  return helperInfos.find((item) => item.runnable);
}

function helperLaunchSpec(helperInfo) {
  if (!helperInfo || !helperInfo.path) return null;
  if (helperInfo.kind === 'node-script') {
    return { command: process.execPath, args: [helperInfo.path] };
  }
  if (helperInfo.kind === 'powershell-script') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperInfo.path],
    };
  }
  return { command: helperInfo.path, args: [] };
}

function commandEnvSlug(command) {
  return compactText(command).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function findCommandRunnerCandidates(command) {
  const runners = [];
  const slug = commandEnvSlug(command);
  const runnerDir = process.env.AI_CONTENT_WECHAT_NATIVE_RUNNER_DIR;
  const candidates = [
    process.env[`AI_CONTENT_WECHAT_COMMAND_RUNNER_${slug}`],
    process.env.AI_CONTENT_WECHAT_NATIVE_COMMAND_RUNNER,
    process.env.AI_CONTENT_WECHAT_WRITE_RUNNER,
  ].filter(Boolean);
  const dirs = [
    runnerDir,
    path.join(__dirname, '..', 'wechat-native-runners'),
    path.join(__dirname, 'runners'),
  ].filter(Boolean);
  const names = [
    `kaypal-wechat-${command}-runner.exe`,
    `kaypal-wechat-${command}-runner.js`,
    `wechat-${command}-runner.exe`,
    `wechat-${command}-runner.js`,
    `${command}.exe`,
    `${command}.js`,
  ];
  for (const dir of dirs) {
    for (const name of names) {
      candidates.push(path.join(dir, name));
    }
  }
  for (const candidate of candidates) addPath(runners, candidate);
  return runners;
}

function describeCommandRunners(paths, command) {
  return paths.map((runnerPath) => {
    const kind = helperKind(runnerPath);
    const platformSupported =
      process.platform === 'win32' ||
      process.env.AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER === '1';
    const runnable =
      platformSupported &&
      ['executable', 'node-script', 'powershell-script', 'shell-script'].includes(kind);
    return {
      path: runnerPath,
      kind,
      runnable,
      platformSupported,
      command,
      contractVersion: UNIFIED_COMMAND_CONTRACT_VERSION,
    };
  });
}

function firstRunnableCommandRunner(command) {
  return describeCommandRunners(findCommandRunnerCandidates(command), command)
    .find((item) => item.runnable);
}

function commandRunnerLaunchSpec(runnerInfo, command) {
  if (!runnerInfo || !runnerInfo.path) return null;
  const args = [command, '--contract', UNIFIED_COMMAND_CONTRACT_VERSION];
  if (runnerInfo.kind === 'node-script') {
    return { command: process.execPath, args: [runnerInfo.path, ...args] };
  }
  if (runnerInfo.kind === 'powershell-script') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runnerInfo.path, ...args],
    };
  }
  return { command: runnerInfo.path, args };
}

function discoverWechatProcess() {
  if (process.platform !== 'win32') return {};
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$items = Get-Process | Where-Object { $_.ProcessName -in @('WeChat','Weixin','WeChatAppEx') } | ForEach-Object {
  $version = ''
  $commandLine = ''
  $wechatFilesPath = ''
  if ($_.Path) {
    try { $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($_.Path).FileVersion } catch {}
  }
  try {
    $commandLine = [string](Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
    if ($commandLine -match '--wechat-files-path="([^"]+)"') {
      $wechatFilesPath = [string]$Matches[1]
    } elseif ($commandLine -match '--wechat-files-path=([^\s]+)') {
      $wechatFilesPath = [string]$Matches[1]
    }
  } catch {}
  [pscustomobject]@{
    processId = $_.Id
    processName = ($_.ProcessName + '.exe')
    executablePath = $_.Path
    commandLine = $commandLine
	    windowTitle = $_.MainWindowTitle
	    mainWindowHandle = [int64]$_.MainWindowHandle
	    workingSet64 = [int64]$_.WorkingSet64
	    wechatVersion = $version
	    wechatFilesPath = $wechatFilesPath
	  }
	}
$allWechatFilesPaths = @($items | Where-Object { -not [string]::IsNullOrWhiteSpace($_.wechatFilesPath) } | Select-Object -ExpandProperty wechatFilesPath -Unique)
$rankedItems = @($items | Sort-Object @{ Expression = { if ($_.processName -match '^(Weixin|WeChat)\.exe$') { 2 } elseif ($_.processName -match '^WeChatAppEx\.exe$') { 1 } else { 0 } }; Descending = $true }, @{ Expression = { if ($_.mainWindowHandle -ne 0) { 1 } else { 0 } }; Descending = $true }, @{ Expression = { if ([string]::IsNullOrWhiteSpace($_.wechatFilesPath)) { 0 } else { 1 } }; Descending = $true }, @{ Expression = 'workingSet64'; Descending = $true }, @{ Expression = 'processId'; Descending = $false })
$selected = $rankedItems | Select-Object -First 1
$output = if ($selected) {
  $selected | Add-Member -NotePropertyName wechatFilesPaths -NotePropertyValue $allWechatFilesPaths -Force
  $selected | Add-Member -NotePropertyName wechatProcesses -NotePropertyValue $rankedItems -Force
  $selected
} else {
  $null
}
$output | ConvertTo-Json -Depth 5 -Compress
`;
  const result = runPowerShell(script, 12000);
  if (result.status !== 0 || !String(result.stdout || '').trim()) {
    return { processError: compactText(result.stderr || result.stdout || `powershell exit ${result.status}`) };
  }
  try {
    const parsed = JSON.parse(String(result.stdout).trim());
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return { processError: `process json parse failed: ${error.message}` };
  }
}

function baseDiagnostics(mode, dbPaths, helperInfos, processInfo) {
  const helper = firstRunnableHelper(helperInfos);
  const platformReady = process.platform === 'win32';
  const windowReady = Boolean(processInfo.processName && processInfo.mainWindowHandle !== 0);
  const uiaFallbackEnabled = process.env.AI_CONTENT_WECHAT_ALLOW_UIA_CONTACT_FALLBACK === '1';
  const helperStatus = helper
    ? 'runnable-detected'
    : helperInfos.length
      ? 'detected-not-runnable'
      : 'missing';
  return {
    stage: 'native-start',
    source: ENGINE_NAME,
    engine: ENGINE_NAME,
    engineVersion: ENGINE_VERSION,
    contractVersion: CONTACTS_CONTRACT_VERSION,
    contactsContract: contractSummary(mode),
    nativeRuntimePath: __filename,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    platform: process.platform,
    platformStatus: platformReady ? 'ready' : 'unsupported',
    processName: processInfo.processName,
    processId: processInfo.processId,
    processCommandLine: processInfo.commandLine,
    windowTitle: processInfo.windowTitle,
    windowStatus: platformReady ? (windowReady ? 'ready' : 'not-found') : 'not-applicable',
    windowError: processInfo.processError,
    wechatVersion: processInfo.wechatVersion,
    wechatFilesPath: processInfo.wechatFilesPath,
    wechatFilesPaths: processInfo.wechatFilesPaths,
    dbPaths,
    dbCandidateDetails: dbPaths.map(describeDbCandidate).slice(0, 20),
    selectedDbPath: dbPaths[0] || '',
    selectedDbAccountFolder: dbPaths[0] ? describeDbCandidate(dbPaths[0]).accountFolder : '',
    selectedDbBaseWxid: dbPaths[0] ? describeDbCandidate(dbPaths[0]).baseWxid : '',
    dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
    dbHelper: helper && helper.path,
    decryptionHelperPath: helper && helper.path,
    helperPaths: helperInfos.map((item) => item.path),
    helperCandidates: helperInfos,
    helperStatus,
    helperKind: helper && helper.kind,
    helperContractVersion: DB_HELPER_CONTRACT_VERSION,
    dbKeyStatus: 'unknown',
    runtimeCapabilities: [
      'sqlite-plaintext-contact-db',
      'encrypted-db-state-detection',
      'db-helper-contract-v1',
      'wechat-db-helper-sqlcipher-decryption',
      'wechat-process-memory-key-scan',
      uiaFallbackEnabled ? 'windows-uia-visible-contact-fallback' : 'windows-uia-visible-contact-diagnostic-disabled',
      uiaFallbackEnabled ? 'windows-uia-scroll-all-contact-collector' : 'windows-uia-scroll-all-contact-diagnostic-disabled',
      uiaFallbackEnabled ? 'windows-uia-contact-page-autonav' : 'windows-uia-contact-page-autonav-disabled',
      uiaFallbackEnabled ? 'windows-uia-scroll-top-reset' : 'windows-uia-scroll-top-reset-disabled',
      'structured-layer-diagnostics',
    ],
    attemptedSources: uiaFallbackEnabled
      ? ['native-db', 'native-db-helper-contract', 'native-uia']
      : ['native-db', 'native-db-helper-contract'],
    limits: {
      randomDbLimit: RANDOM_DB_LIMIT,
      randomUiaLimit: RANDOM_UIA_LIMIT,
      allDbLimit: ALL_DB_LIMIT,
      allUiaMaxPages: UIA_ALL_MAX_PAGES,
      maxDbDepth: MAX_DB_DEPTH,
      maxDbFiles: MAX_DB_FILES,
      maxUiaNodesPerPage: MAX_UIA_NODES,
    },
    layers: {
      platform: {
        status: platformReady ? 'ready' : 'unsupported',
        platform: process.platform,
        os: `${os.type()} ${os.release()} ${os.arch()}`,
      },
      window: {
        status: platformReady ? (windowReady ? 'ready' : 'not-found') : 'not-applicable',
        processName: processInfo.processName,
        processId: processInfo.processId,
        commandLine: processInfo.commandLine,
        wechatFilesPath: processInfo.wechatFilesPath,
        wechatFilesPaths: processInfo.wechatFilesPaths,
        title: processInfo.windowTitle,
        error: processInfo.processError,
      },
      db: {
        status: dbPaths.length ? 'candidate-found' : 'not-found',
        paths: dbPaths,
        candidates: dbPaths.map(describeDbCandidate).slice(0, 20),
      },
      helper: {
        status: helperStatus,
        path: helper && helper.path,
        kind: helper && helper.kind,
        candidates: helperInfos,
        contractVersion: DB_HELPER_CONTRACT_VERSION,
      },
      uia: {
        status: 'not-started',
      },
    },
    warnings: [],
  };
}

function mergeWarnings(...groups) {
  return uniqueText(groups.flatMap((group) => (Array.isArray(group) ? group : [])));
}

function resolveFailureLayer(diagnostics) {
  if (diagnostics.platformStatus && diagnostics.platformStatus !== 'ready') return 'platform';
  if (diagnostics.windowStatus && !['ready', 'not-applicable'].includes(diagnostics.windowStatus)) {
    if (!diagnostics.dbPaths || diagnostics.dbPaths.length === 0) return 'window';
  }
  if (diagnostics.helperStatus && diagnostics.helperStatus.startsWith('failed')) return 'helper';
  if (diagnostics.dbKeyStatus === 'encrypted-or-locked' && diagnostics.helperStatus !== 'completed') {
    return 'helper';
  }
  if (['sqlite-missing', 'query-failed'].includes(diagnostics.dbStatus)) return 'db';
  if (diagnostics.uiaStatus && diagnostics.uiaStatus !== 'completed') return 'uia';
  return 'contacts';
}

function resolveFailureReason(diagnostics) {
  return compactText(
    diagnostics.platformError ||
      diagnostics.windowError ||
      diagnostics.dbError ||
      diagnostics.helperError ||
      diagnostics.uiaError ||
      (diagnostics.warnings || []).join('；') ||
      'no contacts',
  );
}

function collectUiaSnapshot(scrollAll = false) {
  if (process.platform !== 'win32') {
    return { error: 'UIA is only available on Windows' };
  }
  const maxPages = scrollAll ? UIA_ALL_MAX_PAGES : 1;
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KaypalWechatWin32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
$proc = Get-Process | Where-Object { $_.ProcessName -in @('WeChat','Weixin') -and $_.MainWindowHandle -ne 0 } | Sort-Object MainWindowHandle -Descending | Select-Object -First 1
if (-not $proc) { throw 'WeChat window not found' }
[KaypalWechatWin32]::ShowWindowAsync($proc.MainWindowHandle, 5) | Out-Null
[KaypalWechatWin32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 350
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
if (-not $root) { throw 'WeChat automation root not found' }
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$allNodes = New-Object System.Collections.Generic.List[Object]
$pages = New-Object System.Collections.Generic.List[Object]
$seenPageKeys = New-Object 'System.Collections.Generic.HashSet[string]'
$script:NodeReadErrors = 0
$script:ScrollAttempts = 0
$script:ScrollTargetCount = 0
$script:NodeLimitHit = $false
$stopReason = 'unknown'
function Normalize-Text([string]$text) {
  if ($null -eq $text) { return '' }
  return (($text -replace '[\x00-\x1f\x7f]', '') -replace '\s+', ' ').Trim()
}
function Click-ScreenPoint([int]$x, [int]$y) {
  try {
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    Start-Sleep -Milliseconds 80
    [KaypalWechatWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [KaypalWechatWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    return $true
  } catch {
    return $false
  }
}
function Invoke-UiElement($el) {
  if ($null -eq $el) { return $false }
  $pattern = $null
  try {
    if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $pattern.Invoke()
      return $true
    }
  } catch {}
  try {
    if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
      $pattern.Select()
      return $true
    }
  } catch {}
  try {
    $point = $el.GetClickablePoint()
    return Click-ScreenPoint ([int]$point.X) ([int]$point.Y)
  } catch {
    return $false
  }
}
$script:ContactNavTarget = ''
$script:ContactNavReads = 0
function Find-ContactNavElement($el, [int]$depth) {
  if ($null -eq $el -or $depth -gt 22 -or $script:ContactNavReads -gt 1600) { return $null }
  $script:ContactNavReads++
  $current = $null
  try { $current = $el.Current } catch { return $null }
  if ($null -ne $current) {
    $name = Normalize-Text $current.Name
    $controlType = ''
    try { $controlType = $current.ControlType.ProgrammaticName } catch {}
    $rect = $current.BoundingRectangle
    if ($name -match '^(通讯录|联系人)$|微信通讯录' -and $rect.Width -gt 6 -and $rect.Height -gt 6) {
      $script:ContactNavTarget = "$name/$controlType"
      return $el
    }
  }
  try { $child = $walker.GetFirstChild($el) } catch { $child = $null }
  while ($child -ne $null) {
    $found = Find-ContactNavElement $child ($depth + 1)
    if ($null -ne $found) { return $found }
    try { $child = $walker.GetNextSibling($child) } catch { $child = $null }
  }
  return $null
}
function Ensure-ContactsPage($rootElement) {
  $nav = Find-ContactNavElement $rootElement 0
  if ($null -ne $nav) {
    if (Invoke-UiElement $nav) { return 'uia-nav-invoked' }
    return 'uia-nav-found-not-invoked'
  }
  try {
    $rect = $rootElement.Current.BoundingRectangle
    if ($rect.Width -gt 420 -and $rect.Height -gt 360) {
      $x = [int]($rect.Left + 38)
      $y = [int]($rect.Top + [Math]::Min(230, [Math]::Max(170, $rect.Height * 0.24)))
      if (Click-ScreenPoint $x $y) {
        $script:ContactNavTarget = "coordinate:$x,$y"
        return 'coordinate-fallback-click'
      }
    }
  } catch {}
  return 'not-found'
}
function Add-Node($el, $depth, $nodes, $scrollables) {
  if ($null -eq $el -or $nodes.Count -ge ${MAX_UIA_NODES} -or $depth -gt 24) { return }
  $current = $null
  try { $current = $el.Current } catch { $script:NodeReadErrors++; return }
  if ($null -eq $current) { return }
  $rect = $current.BoundingRectangle
  try {
    $nodes.Add([pscustomobject]@{
      name = $current.Name
      automationId = $current.AutomationId
      className = $current.ClassName
      controlType = $current.ControlType.ProgrammaticName
      left = [int]$rect.Left
      top = [int]$rect.Top
      width = [int]$rect.Width
      height = [int]$rect.Height
      depth = $depth
    })
  } catch {
    $script:NodeReadErrors++
  }
  $scrollPattern = $null
  try {
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$scrollPattern)) {
      if ($scrollPattern.Current.VerticallyScrollable -and $rect.Height -gt 120 -and $rect.Width -gt 120) {
        $scrollables.Add($el)
      }
    }
  } catch {
    $script:NodeReadErrors++
  }
  try { $child = $walker.GetFirstChild($el) } catch { $script:NodeReadErrors++; $child = $null }
  while ($child -ne $null -and $nodes.Count -lt ${MAX_UIA_NODES}) {
    Add-Node $child ($depth + 1) $nodes $scrollables
    try { $child = $walker.GetNextSibling($child) } catch { $script:NodeReadErrors++; $child = $null }
  }
  if ($nodes.Count -ge ${MAX_UIA_NODES}) {
    $script:NodeLimitHit = $true
  }
}
$contactNavAction = Ensure-ContactsPage $root
if ($contactNavAction -ne 'not-found') {
  Start-Sleep -Milliseconds 650
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
}
$script:ScrollResetAttempts = 0
$maxPages = ${maxPages}
for ($page = 1; $page -le $maxPages; $page++) {
  $nodes = New-Object System.Collections.Generic.List[Object]
  $scrollables = New-Object System.Collections.Generic.List[Object]
  Add-Node $root 0 $nodes $scrollables
  if ($page -eq 1 -and $maxPages -gt 1 -and $scrollables.Count -gt 0) {
    $resetTarget = $scrollables | Sort-Object {
      $r = $_.Current.BoundingRectangle
      [double]($r.Width * $r.Height)
    } -Descending | Select-Object -First 1
    $resetPattern = $null
    try {
      if ($resetTarget -and $resetTarget.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$resetPattern)) {
        for ($reset = 0; $reset -lt 12; $reset++) {
          $percent = [double]$resetPattern.Current.VerticalScrollPercent
          if ($percent -lt 0 -or $percent -le 0.5) { break }
          $resetPattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::LargeDecrement)
          $script:ScrollResetAttempts++
          Start-Sleep -Milliseconds 180
        }
        if ($script:ScrollResetAttempts -gt 0) {
          $nodes = New-Object System.Collections.Generic.List[Object]
          $scrollables = New-Object System.Collections.Generic.List[Object]
          Add-Node $root 0 $nodes $scrollables
        }
      }
    } catch {}
  }
  $texts = @($nodes | ForEach-Object { Normalize-Text $_.name } | Where-Object { $_ -and $_.Length -gt 0 } | Select-Object -First 650)
  $pageKey = [string]::Join('|', @($texts | Select-Object -First 220))
  $isDuplicate = $false
  if ($pageKey -and -not $seenPageKeys.Add($pageKey)) {
    $isDuplicate = $true
    $stopReason = 'duplicate-page'
  }
  $pageInfo = [pscustomobject]@{
    page = $page
    textCount = $texts.Count
    nodeCount = $nodes.Count
    scrollableCount = $scrollables.Count
    duplicate = $isDuplicate
    signature = if ($pageKey.Length -gt 180) { $pageKey.Substring(0, 180) } else { $pageKey }
    firstText = if ($texts.Count -gt 0) { $texts[0] } else { '' }
    lastText = if ($texts.Count -gt 0) { $texts[$texts.Count - 1] } else { '' }
    texts = $texts
  }
  $pages.Add($pageInfo)
  if ($isDuplicate) { break }
  foreach ($node in $nodes) {
    if ($allNodes.Count -lt (${MAX_UIA_NODES} * 3)) { $allNodes.Add($node) }
  }
  if ($maxPages -le 1) {
    $stopReason = 'single-page-mode'
    break
  }
  if ($page -eq $maxPages) {
    $stopReason = 'max-pages'
    break
  }
  $target = $scrollables | Sort-Object {
    $r = $_.Current.BoundingRectangle
    [double]($r.Width * $r.Height)
  } -Descending | Select-Object -First 1
  if (-not $target) {
    $stopReason = 'no-scrollable-container'
    break
  }
  $script:ScrollTargetCount++
  $pattern = $null
  if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) {
    $stopReason = 'scroll-pattern-unavailable'
    break
  }
  $beforePercent = -1
  $afterPercent = -1
  try {
    $beforePercent = [double]$pattern.Current.VerticalScrollPercent
    if ($beforePercent -ge 99.5) {
      $pageInfo | Add-Member -NotePropertyName scrollPercentBefore -NotePropertyValue $beforePercent -Force
      $stopReason = 'scroll-at-bottom'
      break
    }
    $script:ScrollAttempts++
    $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::LargeIncrement)
    Start-Sleep -Milliseconds 360
    $afterPercent = [double]$pattern.Current.VerticalScrollPercent
    $pageInfo | Add-Member -NotePropertyName scrollPercentBefore -NotePropertyValue $beforePercent -Force
    $pageInfo | Add-Member -NotePropertyName scrollPercentAfter -NotePropertyValue $afterPercent -Force
    if ($afterPercent -ge 0 -and $beforePercent -ge 0 -and [math]::Abs($afterPercent - $beforePercent) -lt 0.01) {
      $stopReason = 'scroll-no-progress'
      break
    }
  } catch {
    $stopReason = 'scroll-exception'
    $pageInfo | Add-Member -NotePropertyName scrollError -NotePropertyValue $_.Exception.Message -Force
    break
  }
}
if ($stopReason -eq 'unknown') { $stopReason = 'completed' }
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$rootRect = $root.Current.BoundingRectangle
[pscustomobject]@{
  processId = $proc.Id
  processName = ($proc.ProcessName + '.exe')
  windowTitle = $proc.MainWindowTitle
  windowRect = @{ left = [int]$rootRect.Left; top = [int]$rootRect.Top; width = [int]$rootRect.Width; height = [int]$rootRect.Height }
  screen = @{ width = [int]$screen.Width; height = [int]$screen.Height }
  maxPagesRequested = $maxPages
  stopReason = $stopReason
  scrollAttempts = $script:ScrollAttempts
  scrollResetAttempts = $script:ScrollResetAttempts
  scrollTargetCount = $script:ScrollTargetCount
  nodeReadErrors = $script:NodeReadErrors
  nodeLimitHit = [bool]$script:NodeLimitHit
  contactNavigation = @{ action = $contactNavAction; target = $script:ContactNavTarget; scannedNodes = $script:ContactNavReads }
  pages = $pages
  nodes = $allNodes
  texts = @($pages | ForEach-Object { $_.texts } | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -First 2000)
} | ConvertTo-Json -Depth 7 -Compress
`;
  const result = runPowerShell(script, 25000);
  if (result.status !== 0 || !String(result.stdout || '').trim()) {
    return { error: compactText(result.stderr || result.stdout || `powershell exit ${result.status}`) };
  }
  try {
    return JSON.parse(String(result.stdout).trim());
  } catch (error) {
    return { error: `UIA json parse failed: ${error.message}`, stdoutTail: String(result.stdout || '').slice(-1000) };
  }
}

function isSystemContactId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!id) return true;
  if (id.endsWith('@chatroom') || id.startsWith('gh_')) return true;
  return new Set([
    'fmessage',
    'qmessage',
    'tmessage',
    'weixin',
    'filehelper',
    'newsapp',
    'qqmail',
    'floatbottle',
    'lbsapp',
    'medianote',
    'qqsync',
    'weibo',
    'masssendapp',
    'feedsapp',
    'voip',
    'officialaccounts',
    'notification_messages',
    'notifymessage',
    'mphelper',
  ]).has(id);
}

function addContact(items, wxid, nickname, remark, alias, source, tags = []) {
  if (isSystemContactId(wxid)) return;
  const cleanNickname = normalizeContactText(nickname);
  const cleanRemark = normalizeContactText(remark);
  const cleanAlias = normalizeContactText(alias);
  const cleanWxid = normalizeContactText(wxid);
  if (!cleanNickname && !cleanRemark && !cleanAlias && !cleanWxid) return;
  const stableId = compactText(wxid || cleanAlias || cleanNickname || cleanRemark);
  const key = uniqueText([stableId, cleanNickname, cleanRemark, cleanAlias]).join('|').toLowerCase();
  if (!key || items.some((item) => item._key === key)) return;
  items.push({
    _key: key,
    wxid: stableId,
    nickname: cleanNickname || cleanRemark || cleanAlias || cleanWxid,
    remark: cleanRemark,
    alias: cleanAlias,
    tags: uniqueText(Array.isArray(tags) ? tags : []).slice(0, 30),
    source,
  });
}

function prepareSqliteReadTarget(dbPath, diagnostics) {
  const ext = path.extname(dbPath) || '.db';
  const snapshotPath = path.join(
    os.tmpdir(),
    `kaypal-wechat-contact-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
  const copy = copyFileWithRetries(dbPath, snapshotPath, { attempts: 10, baseDelayMs: 150 });
  if (copy.ok) {
    diagnostics.dbSnapshotPaths = uniqueText([...(diagnostics.dbSnapshotPaths || []), snapshotPath]).slice(0, 20);
    diagnostics.dbSnapshotCopyAttempts = copy.attempts;
    return { queryPath: snapshotPath, snapshotPath };
  }
  const sharedCopy = runPowerShellSharedReadCopy(dbPath, snapshotPath);
  if (sharedCopy.ok) {
    diagnostics.dbSnapshotPaths = uniqueText([...(diagnostics.dbSnapshotPaths || []), snapshotPath]).slice(0, 20);
    diagnostics.dbSharedReadSnapshotPaths = uniqueText([...(diagnostics.dbSharedReadSnapshotPaths || []), snapshotPath]).slice(0, 20);
    diagnostics.dbSnapshotCopyAttempts = copy.attempts;
    diagnostics.dbSnapshotSharedRead = true;
    return { queryPath: snapshotPath, snapshotPath };
  }
  diagnostics.dbCopyError = copy.error;
  diagnostics.dbSharedReadCopyError = sharedCopy.error || sharedCopy.reason || '';
  diagnostics.dbCopyAttempts = copy.attempts;
  diagnostics.dbSnapshotFallback = 'live-db';
  return { queryPath: dbPath, snapshotPath: '' };
}

function cleanupSqliteReadTarget(target) {
  if (!target || !target.snapshotPath) return;
  try {
    fs.rmSync(target.snapshotPath, { force: true });
  } catch {
    // Temp cleanup is best effort.
  }
}

const SYSTEM_CONTACT_SQL_IDS = [
  'fmessage',
  'qmessage',
  'tmessage',
  'weixin',
  'filehelper',
  'newsapp',
  'qqmail',
  'floatbottle',
  'lbsapp',
  'medianote',
  'qqsync',
  'weibo',
  'masssendapp',
  'feedsapp',
  'voip',
  'officialaccounts',
  'notification_messages',
  'notifymessage',
  'mphelper',
].map((item) => `'${item}'`).join(',');

function cleanSqlText(column) {
  return `replace(replace(replace(COALESCE(${column}, ''), char(13), ' '), char(10), ' '), char(9), ' ')`;
}

function uiaSourceForMode(mode) {
  return mode === 'all' ? 'windows-wechat-native-uia-scroll' : 'windows-wechat-native-uia';
}

function displayNameForItem(item) {
  if (!item || typeof item !== 'object') return '';
  return compactText(item.nickname || item.remark || item.alias || item.wxid);
}

function buildUiaFirstLast(pageSummaries, items = []) {
  const pages = Array.isArray(pageSummaries) ? pageSummaries : [];
  const firstPage = pages[0] || {};
  const lastPage = pages[pages.length - 1] || {};
  const contactNames = (Array.isArray(items) ? items : [])
    .map(displayNameForItem)
    .filter(Boolean);
  return {
    firstPage: firstPage.page,
    lastPage: lastPage.page,
    firstText: compactText(firstPage.firstText),
    lastText: compactText(lastPage.lastText),
    firstContact: contactNames[0] || '',
    lastContact: contactNames[contactNames.length - 1] || '',
  };
}

function uiaConfidenceForMode(mode, lowConfidenceReason = '') {
  if (lowConfidenceReason) return 'low';
  return mode === 'all' ? 'medium' : 'sample';
}

function withUiaConfidence(items, confidence) {
  return items.map((item) => ({
    ...item,
    source: item.source || 'wechat-native-uia',
    confidence,
  }));
}

function lowConfidenceUiaReason(mode, items, diagnostics) {
  const count = Array.isArray(items) ? items.length : 0;
  const status = compactText(diagnostics && diagnostics.uiaStatus);
  const stopReason = compactText(diagnostics && diagnostics.uiaStopReason);
  const pagesScanned = Number(diagnostics && diagnostics.pagesScanned) || 0;
  const dbKeyStatus = compactText(diagnostics && diagnostics.dbKeyStatus);
  const helperStatus = compactText(diagnostics && diagnostics.helperStatus);
  const badUiaState = /not-wechat-contacts-page|completed-empty|failed|window-not-found/i.test(status);
  const badStopReason = /no-scrollable-container|not-wechat-contacts-page|scroll-no-progress|scroll-pattern-unavailable|scroll-exception|duplicate-page/i.test(stopReason);
  const encryptedWithoutHelper = dbKeyStatus === 'encrypted-or-locked' && helperStatus !== 'completed';
  const hardContactsPageMiss = /not-wechat-contacts-page/i.test(status);
  const hardStopReason = /no-scrollable-container|not-wechat-contacts-page|duplicate-page/i.test(stopReason);

  if (badUiaState && count <= 1) {
    return `UIA 状态 ${status || 'unknown'}，只识别到 ${count} 个联系人，拒绝作为通讯录结果`;
  }
  if (mode === 'all') {
    if (encryptedWithoutHelper && hardContactsPageMiss) {
      return `微信数据库加密或被占用且 helper 未完成，UIA 状态 ${status || 'unknown'}，拒绝作为全量成功`;
    }
    if (encryptedWithoutHelper && hardStopReason) {
      return `微信数据库加密或被占用且 helper 未完成，UIA 停止原因 ${stopReason || 'unknown'}，拒绝作为全量成功`;
    }
    if (encryptedWithoutHelper && count < UIA_ALL_LOW_CONTACT_THRESHOLD) {
      return `微信数据库加密或被占用且 helper 未完成，只从 UIA 识别到 ${count} 个联系人，拒绝作为全量成功`;
    }
    if (count <= 1) {
      return `全量同步只识别到 ${count} 个联系人，低于可信阈值，拒绝覆盖本地名单`;
    }
    if (count < 5 && (pagesScanned > 1 || badStopReason)) {
      return `全量同步扫描 ${pagesScanned || 0} 页但只识别到 ${count} 个联系人，停止原因 ${stopReason || 'unknown'}，拒绝作为成功`;
    }
  }
  return '';
}

function collectBySqlite(dbPaths, mode) {
  const sqlite = findSqlitePath();
  const items = [];
  const diagnostics = {
    sqlitePath: sqlite,
    dbPaths,
    dbCandidateDetails: dbPaths.map(describeDbCandidate).slice(0, 40),
    dbContactCount: 0,
    dbQueryAttempts: 0,
    dbError: '',
    dbErrors: [],
    dbKeyStatus: 'unknown',
    dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
    selectedDbPath: '',
    selectedDbAccountFolder: '',
    selectedDbBaseWxid: '',
    selectedDbActiveMtime: '',
    selectedDbScore: 0,
    currentAccountDbBlocked: false,
    blockedReasons: [],
  };
  if (!dbPaths.length) {
    diagnostics.dbError = 'wechat contact database not found';
    return { items, diagnostics };
  }
  if (!sqlite) {
    diagnostics.dbError = 'sqlite3 not found';
    diagnostics.dbStatus = 'sqlite-missing';
    return { items, diagnostics };
  }

  const limit = mode === 'all' ? ALL_DB_LIMIT : RANDOM_DB_LIMIT;
  const order = mode === 'all' ? '' : ' ORDER BY RANDOM()';
  const queries = [
    `SELECT ${cleanSqlText('user_name')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM user_info WHERE user_name IS NOT NULL AND user_name NOT LIKE '%@chatroom' AND user_name NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nickname')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('UserName')}, ${cleanSqlText('NickName')}, ${cleanSqlText('Remark')}, ${cleanSqlText('Alias')} FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0 AND COALESCE(LocalType, 1) = 1${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nick_name')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('username')}, ${cleanSqlText('nickname')}, ${cleanSqlText('remark')}, ${cleanSqlText('alias')} FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('UserName')}, ${cleanSqlText('NickName')}, ${cleanSqlText('Remark')}, ${cleanSqlText('Alias')} FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN (${SYSTEM_CONTACT_SQL_IDS}) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT ${cleanSqlText('UserName')}, ${cleanSqlText('NickName')}, ${cleanSqlText('Remark')}, ${cleanSqlText('Alias')} FROM rcontact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
  ];

  for (const [dbIndex, dbPath] of dbPaths.entries()) {
    const selected = describeDbCandidate(dbPath);
    const isFirstRankedContactDb =
      dbIndex === 0 &&
      selected.isXWechat &&
      selected.isContactDb &&
      selected.accountFolder &&
      !selected.isAllUsers &&
      !selected.isBackup;
    const readTarget = prepareSqliteReadTarget(dbPath, diagnostics);
    try {
      for (const query of queries) {
        diagnostics.dbQueryAttempts++;
        const result = run(sqlite, ['-noheader', '-separator', '\t', readTarget.queryPath, query], { timeout: 45000 });
        if (result.status !== 0) {
          diagnostics.dbError = compactText(result.stderr || result.stdout || `sqlite exit ${result.status}`);
          if (/file is not a database|encrypted|malformed|not an error|database is locked/i.test(diagnostics.dbError)) {
            diagnostics.dbKeyStatus = 'encrypted-or-locked';
            diagnostics.dbStatus = 'encrypted-or-locked';
            diagnostics.dbErrors.push({
              path: dbPath,
              status: 'blocked',
              reason: 'encrypted-or-locked',
              error: diagnostics.dbError,
            });
            if (isFirstRankedContactDb) {
              diagnostics.currentAccountDbBlocked = true;
              diagnostics.selectedDbPath = dbPath;
              diagnostics.selectedDbAccountFolder = selected.accountFolder;
              diagnostics.selectedDbBaseWxid = selected.baseWxid;
              diagnostics.selectedDbActiveMtime = selected.activeMtime;
              diagnostics.selectedDbScore = selected.score;
              diagnostics.blockedReasons.push('current-account-db-key-missing');
              diagnostics.dbErrors.push({
                path: dbPath,
                status: 'blocked',
                reason: 'current-account-db-key-missing',
                error: 'current account contact.db could not be read by sqlite; refused stale-account fallback',
              });
              return { items, diagnostics };
            }
          } else {
            diagnostics.dbStatus = 'query-failed';
            diagnostics.dbErrors.push({
              path: dbPath,
              status: 'failed',
              reason: 'query-failed',
              error: diagnostics.dbError,
            });
          }
          continue;
        }
        diagnostics.dbKeyStatus = 'plaintext-readable';
        diagnostics.dbStatus = 'plaintext-readable';
        for (const line of String(result.stdout || '').split(/\r?\n/)) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          addContact(items, parts[0], parts[1], parts[2], parts[3], 'wechat-native-db');
        }
        if (items.length) {
          diagnostics.selectedDbPath = dbPath;
          diagnostics.selectedDbAccountFolder = selected.accountFolder;
          diagnostics.selectedDbBaseWxid = selected.baseWxid;
          diagnostics.selectedDbActiveMtime = selected.activeMtime;
          diagnostics.selectedDbScore = selected.score;
          diagnostics.dbContactCount = items.length;
          diagnostics.dbStatus = 'completed';
          return { items, diagnostics };
        }
      }
      if (isFirstRankedContactDb) {
        diagnostics.currentAccountDbBlocked = true;
        diagnostics.selectedDbPath = dbPath;
        diagnostics.selectedDbAccountFolder = selected.accountFolder;
        diagnostics.selectedDbBaseWxid = selected.baseWxid;
        diagnostics.selectedDbActiveMtime = selected.activeMtime;
        diagnostics.selectedDbScore = selected.score;
        diagnostics.dbStatus =
          diagnostics.dbStatus === 'candidate-found'
            ? 'completed-empty'
            : diagnostics.dbStatus;
        diagnostics.dbError =
          diagnostics.dbError ||
          'current account contact.db returned no readable contacts; refused stale-account fallback';
        diagnostics.blockedReasons.push('current-account-db-unreadable');
        diagnostics.dbErrors.push({
          path: dbPath,
          status: 'blocked',
          reason: 'current-account-db-unreadable',
          error: diagnostics.dbError,
        });
        return { items, diagnostics };
      }
    } finally {
      cleanupSqliteReadTarget(readTarget);
    }
  }

  diagnostics.dbContactCount = items.length;
  diagnostics.blockedReasons = Array.from(new Set(diagnostics.blockedReasons));
  return { items, diagnostics };
}

function helperInputPayload(dbPaths, mode, processInfo) {
  return {
    contractVersion: DB_HELPER_CONTRACT_VERSION,
    requestedAt: new Date().toISOString(),
    mode,
    dbPaths,
    dbCandidateDetails: dbPaths.map(describeDbCandidate).slice(0, 40),
    roots: wechatRoots(),
    process: {
      processId: processInfo.processId,
      processName: processInfo.processName,
      executablePath: processInfo.executablePath,
      commandLine: processInfo.commandLine,
	      wechatFilesPath: processInfo.wechatFilesPath,
	      wechatFilesPaths: processInfo.wechatFilesPaths,
	      wechatProcesses: Array.isArray(processInfo.wechatProcesses) ? processInfo.wechatProcesses : [],
	      mainWindowHandle: processInfo.mainWindowHandle,
	      windowTitle: processInfo.windowTitle,
	      wechatVersion: processInfo.wechatVersion,
	    },
	    processes: Array.isArray(processInfo.wechatProcesses) ? processInfo.wechatProcesses : [],
	    limits: {
      randomLimit: RANDOM_DB_LIMIT,
      allLimit: ALL_DB_LIMIT,
    },
    expectedOutput: {
      ok: 'boolean',
      items: 'Array<{ wxid, nickname, remark, alias, tags }>',
      contacts: 'optional string[] display fallback',
      diagnostics: 'optional helper diagnostics',
    },
  };
}

function collectHelperItems(parsed, source) {
  const rawItems = Array.isArray(parsed.items)
    ? parsed.items
    : Array.isArray(parsed.contacts)
      ? parsed.contacts
      : [];
  const items = [];
  for (const raw of rawItems) {
    if (raw && typeof raw === 'object') {
      addContact(
        items,
        raw.wxid || raw.id || raw.userName || raw.username,
        raw.nickname || raw.nickName || raw.displayName || raw.name,
        raw.remark || raw.remarkName,
        raw.alias,
        source,
        raw.tags,
      );
    } else {
      addContact(items, raw, raw, '', '', source);
    }
  }
  return items;
}

function collectByHelper(helperInfo, dbPaths, mode, processInfo) {
  const diagnostics = {
    helperPath: helperInfo && helperInfo.path,
    decryptionHelperPath: helperInfo && helperInfo.path,
    helperKind: helperInfo && helperInfo.kind,
    helperContractVersion: DB_HELPER_CONTRACT_VERSION,
    helperStatus: helperInfo ? 'starting' : 'missing',
    helperContactCount: 0,
    helperError: '',
  };
  if (!helperInfo) {
    diagnostics.helperStatus = 'missing';
    diagnostics.helperError = 'db helper not found';
    return { items: [], diagnostics };
  }
  if (!helperInfo.runnable) {
    diagnostics.helperStatus = 'detected-not-runnable';
    diagnostics.helperError = 'db helper candidate is not executable';
    return { items: [], diagnostics };
  }
  const launch = helperLaunchSpec(helperInfo);
  if (!launch) {
    diagnostics.helperStatus = 'failed-launch-spec';
    diagnostics.helperError = 'db helper launch spec unavailable';
    return { items: [], diagnostics };
  }

  const input = JSON.stringify(helperInputPayload(dbPaths, mode, processInfo));
  const timeout = mode === 'all' ? 180000 : 45000;
  const result = run(
    launch.command,
    [...launch.args, 'contacts', '--contract', DB_HELPER_CONTRACT_VERSION, '--mode', mode],
    {
      timeout,
      input,
      env: {
        ...process.env,
        AI_CONTENT_WECHAT_HELPER_CONTRACT: DB_HELPER_CONTRACT_VERSION,
      },
    },
  );
  diagnostics.helperExitCode = result.status;
  diagnostics.helperSignal = result.signal;
  diagnostics.helperStdoutTail = String(result.stdout || '').slice(-1000);
  diagnostics.helperStderrTail = String(result.stderr || '').slice(-1000);

  const jsonLine = findLastJsonLine(result.stdout);
  if (!jsonLine) {
    diagnostics.helperStatus = result.status === 0 ? 'failed-no-json' : 'failed-exit';
    diagnostics.helperError = compactText(result.stderr || result.stdout || `helper exit ${result.status}`);
    return { items: [], diagnostics };
  }
  const parsed = safeJsonParse(jsonLine);
  if (parsed.parseError) {
    diagnostics.helperStatus = 'failed-json-parse';
    diagnostics.helperError = `helper json parse failed: ${parsed.parseError}`;
    return { items: [], diagnostics };
  }
  if (parsed.ok === false) {
    diagnostics.helperStatus = 'failed-contract';
    diagnostics.helperError = compactText(parsed.error || parsed.message || result.stderr || 'helper returned ok=false');
    diagnostics.helperDiagnostics = parsed.diagnostics;
    return { items: [], diagnostics };
  }
  if (result.status !== 0) {
    diagnostics.helperStatus = 'failed-exit';
    diagnostics.helperError = compactText(result.stderr || result.stdout || `helper exit ${result.status}`);
    diagnostics.helperDiagnostics = parsed.diagnostics;
    return { items: [], diagnostics };
  }

  const source = compactText(parsed.source || 'wechat-native-db-helper');
  const items = collectHelperItems(parsed, source);
  diagnostics.helperStatus = items.length ? 'completed' : 'completed-empty';
  diagnostics.helperSource = source;
  diagnostics.helperContactCount = items.length;
  diagnostics.helperDiagnostics = parsed.diagnostics;
  if (parsed.diagnostics && typeof parsed.diagnostics === 'object') {
    const helperDiagnostics = parsed.diagnostics;
    if (helperDiagnostics.dbKeyStatus) diagnostics.dbKeyStatus = compactText(helperDiagnostics.dbKeyStatus);
    if (helperDiagnostics.wechatVersion) diagnostics.wechatVersion = compactText(helperDiagnostics.wechatVersion);
    if (helperDiagnostics.selectedDbPath) diagnostics.selectedDbPath = compactText(helperDiagnostics.selectedDbPath);
    if (helperDiagnostics.selectedDbAccountFolder) diagnostics.selectedDbAccountFolder = compactText(helperDiagnostics.selectedDbAccountFolder);
    if (helperDiagnostics.selectedDbBaseWxid) diagnostics.selectedDbBaseWxid = compactText(helperDiagnostics.selectedDbBaseWxid);
    if (helperDiagnostics.selectedDbActiveMtime) diagnostics.selectedDbActiveMtime = compactText(helperDiagnostics.selectedDbActiveMtime);
    if (Number.isFinite(Number(helperDiagnostics.selectedDbScore))) diagnostics.selectedDbScore = Number(helperDiagnostics.selectedDbScore);
    if (Array.isArray(helperDiagnostics.warnings)) diagnostics.warnings = helperDiagnostics.warnings;
  }
  return { items, diagnostics };
}

function probeDbHelper(helperInfo) {
  const diagnostics = {
    helperPath: helperInfo && helperInfo.path,
    helperKind: helperInfo && helperInfo.kind,
    helperContractVersion: DB_HELPER_CONTRACT_VERSION,
    helperProbeStatus: helperInfo ? 'starting' : 'missing',
    helperProbeError: '',
  };
  if (!helperInfo) {
    diagnostics.helperProbeStatus = 'missing';
    return diagnostics;
  }
  if (!helperInfo.runnable) {
    diagnostics.helperProbeStatus = 'detected-not-runnable';
    diagnostics.helperProbeError = 'helper candidate is not executable';
    return diagnostics;
  }
  const launch = helperLaunchSpec(helperInfo);
  if (!launch) {
    diagnostics.helperProbeStatus = 'failed-launch-spec';
    diagnostics.helperProbeError = 'helper launch spec unavailable';
    return diagnostics;
  }
  const result = run(
    launch.command,
    [...launch.args, 'diagnose', '--contract', DB_HELPER_CONTRACT_VERSION],
    {
      timeout: 8000,
      input: JSON.stringify({
        contractVersion: DB_HELPER_CONTRACT_VERSION,
        requestedAt: new Date().toISOString(),
        purpose: 'capability-probe',
      }),
      env: {
        ...process.env,
        AI_CONTENT_WECHAT_HELPER_CONTRACT: DB_HELPER_CONTRACT_VERSION,
      },
    },
  );
  diagnostics.helperProbeExitCode = result.status;
  diagnostics.helperProbeStdoutTail = String(result.stdout || '').slice(-1000);
  diagnostics.helperProbeStderrTail = String(result.stderr || '').slice(-1000);
  const jsonLine = findLastJsonLine(result.stdout);
  if (!jsonLine) {
    diagnostics.helperProbeStatus = result.status === 0 ? 'no-contract-json' : 'failed-exit';
    diagnostics.helperProbeError = compactText(result.stderr || result.stdout || `helper probe exit ${result.status}`);
    return diagnostics;
  }
  const parsed = safeJsonParse(jsonLine);
  if (parsed.parseError) {
    diagnostics.helperProbeStatus = 'json-parse-failed';
    diagnostics.helperProbeError = parsed.parseError;
    return diagnostics;
  }
  if (parsed.ok === false) {
    diagnostics.helperProbeStatus = 'contract-rejected';
    diagnostics.helperProbeError = compactText(parsed.error || parsed.message || 'helper rejected contract probe');
    diagnostics.helperProbeDiagnostics = parsed.diagnostics;
    return diagnostics;
  }
  diagnostics.helperProbeStatus = result.status === 0 ? 'contract-ready' : 'contract-json-with-nonzero-exit';
  diagnostics.helperProbeCapabilities = Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
  diagnostics.helperVersion = compactText(parsed.helperVersion || parsed.version || '');
  diagnostics.helperProbeDiagnostics = parsed.diagnostics;
  return diagnostics;
}

function collectByUia(mode) {
  const snapshot = collectUiaSnapshot(mode === 'all');
  const diagnostics = {
    uiaContactCount: 0,
    rawTextCount: 0,
    uiaNodeCount: 0,
    pagesScanned: 0,
    uiaStatus: 'not-started',
    uiaError: '',
    uiaStopReason: '',
    uiaScrollAttempts: 0,
    uiaScrollResetAttempts: 0,
    uiaScrollTargetCount: 0,
    uiaContactNavigationAction: '',
    uiaContactNavigationTarget: '',
    uiaNodeReadErrors: 0,
    uiaNodeLimitHit: false,
    uiaDuplicatePages: 0,
    uiaPageTextCounts: [],
    uiaPageSummaries: [],
    uiaFirstLast: buildUiaFirstLast([]),
    uiaSource: uiaSourceForMode(mode),
    uiaConfidence: 'unknown',
    rawPreview: [],
    warnings: [],
  };
  if (snapshot.error) {
    diagnostics.uiaStatus = /window not found/i.test(snapshot.error) ? 'window-not-found' : 'failed';
    diagnostics.uiaError = snapshot.error;
    diagnostics.warnings.push(snapshot.error);
    return { items: [], diagnostics };
  }

  const rawTexts = uniqueText(snapshot.texts || []);
  const signalText = `${snapshot.windowTitle || ''} ${rawTexts.slice(0, 80).join(' ')}`;
  const hasWechatSignal = /微信|WeChat|Weixin|通讯录|新的朋友|标签|朋友权限|企业微信联系人/.test(signalText);
  diagnostics.rawTextCount = rawTexts.length;
  diagnostics.uiaNodeCount = Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0;
  diagnostics.pagesScanned = Array.isArray(snapshot.pages) ? snapshot.pages.length : 1;
  diagnostics.uiaStatus = 'scanned';
  diagnostics.uiaStopReason = compactText(snapshot.stopReason || '');
  diagnostics.uiaMaxPagesRequested = Number(snapshot.maxPagesRequested) || (mode === 'all' ? UIA_ALL_MAX_PAGES : 1);
  diagnostics.uiaScrollAttempts = Number(snapshot.scrollAttempts) || 0;
  diagnostics.uiaScrollResetAttempts = Number(snapshot.scrollResetAttempts) || 0;
  diagnostics.uiaScrollTargetCount = Number(snapshot.scrollTargetCount) || 0;
  diagnostics.uiaContactNavigationAction = compactText(snapshot.contactNavigation && snapshot.contactNavigation.action);
  diagnostics.uiaContactNavigationTarget = compactText(snapshot.contactNavigation && snapshot.contactNavigation.target);
  diagnostics.uiaNodeReadErrors = Number(snapshot.nodeReadErrors) || 0;
  diagnostics.uiaNodeLimitHit = Boolean(snapshot.nodeLimitHit);
  diagnostics.uiaPageTextCounts = Array.isArray(snapshot.pages)
    ? snapshot.pages.map((page) => Number(page.textCount) || 0)
    : [];
  diagnostics.uiaDuplicatePages = Array.isArray(snapshot.pages)
    ? snapshot.pages.filter((page) => Boolean(page.duplicate)).length
    : 0;
  const allPageSummaries = Array.isArray(snapshot.pages)
    ? snapshot.pages.map((page) => ({
        page: page.page,
        textCount: page.textCount,
        nodeCount: page.nodeCount,
        scrollableCount: page.scrollableCount,
        duplicate: Boolean(page.duplicate),
        firstText: compactText(page.firstText),
        lastText: compactText(page.lastText),
        firstLast: {
          firstText: compactText(page.firstText),
          lastText: compactText(page.lastText),
        },
        scrollPercentBefore: page.scrollPercentBefore,
        scrollPercentAfter: page.scrollPercentAfter,
      }))
    : [];
  diagnostics.uiaPageSummaries = allPageSummaries.slice(0, 12);
  diagnostics.uiaFirstLast = buildUiaFirstLast(allPageSummaries);
  diagnostics.rawPreview = rawTexts.slice(0, 20);
  diagnostics.processName = snapshot.processName;
  diagnostics.processId = snapshot.processId;
  diagnostics.windowTitle = snapshot.windowTitle;
  diagnostics.windowRect = snapshot.windowRect;
  diagnostics.screen = snapshot.screen;

  if (!hasWechatSignal) {
    diagnostics.uiaStatus = 'not-wechat-contacts-page';
    diagnostics.uiaError = 'UIA did not look like a WeChat contacts page';
    diagnostics.warnings.push('UIA did not look like a WeChat contacts page');
    return { items: [], diagnostics };
  }

  const items = [];
  for (const text of rawTexts) {
    const clean = normalizeContactText(text);
    if (!clean) continue;
    addContact(items, clean, clean, '', '', 'wechat-native-uia');
    if (mode !== 'all' && items.length >= RANDOM_UIA_LIMIT) break;
  }

  diagnostics.uiaContactCount = items.length;
  diagnostics.uiaFirstLast = buildUiaFirstLast(allPageSummaries, items);
  diagnostics.uiaStatus = items.length ? 'completed' : 'completed-empty';
  return { items, diagnostics };
}

function stripPrivateKeys(items) {
  return items.map(({ _key, ...item }) => item);
}

function runContacts() {
  const mode = argValue('--mode', process.env.AI_CONTENT_WECHAT_CONTACT_SYNC_MODE || 'random') === 'all' ? 'all' : 'random';
  const now = new Date().toISOString();
  const allowUiaContactFallback = process.env.AI_CONTENT_WECHAT_ALLOW_UIA_CONTACT_FALLBACK === '1';
  const processInfo = discoverWechatProcess();
  const dbPaths = findContactDbCandidates(processInfo);
  const helperInfos = describeDbHelpers(findDecryptionHelpers());
  const helperInfo = firstRunnableHelper(helperInfos);
  const diagnostics = baseDiagnostics(mode, dbPaths, helperInfos, processInfo);

  if (process.platform !== 'win32') {
    diagnostics.stage = 'native-platform-blocked';
    diagnostics.platformError = 'runtime platform is not win32';
    diagnostics.failureLayer = 'platform';
    diagnostics.failureReason = 'not-windows';
    diagnostics.layers.platform = {
      ...diagnostics.layers.platform,
      status: 'unsupported',
      error: diagnostics.platformError,
    };
    emit({
      ok: false,
      contractVersion: CONTACTS_CONTRACT_VERSION,
      mode,
      error: 'kaypal-wechat-native-runtime 只能在 Windows 上采集微信联系人',
      diagnostics,
    }, 2);
  }

  const dbResult = collectBySqlite(dbPaths, mode);
  Object.assign(diagnostics, dbResult.diagnostics);
  diagnostics.layers.db = {
    ...diagnostics.layers.db,
    status: diagnostics.dbStatus,
    sqlitePath: diagnostics.sqlitePath,
    contactCount: diagnostics.dbContactCount,
    queryAttempts: diagnostics.dbQueryAttempts,
    keyStatus: diagnostics.dbKeyStatus,
    error: diagnostics.dbError,
  };
  if (dbResult.items.length) {
    const items = stripPrivateKeys(dbResult.items);
    const currentWechatId = diagnostics.selectedDbAccountFolder || diagnostics.selectedDbBaseWxid || '';
    emit({
      ok: true,
      contractVersion: CONTACTS_CONTRACT_VERSION,
      mode,
      source: 'windows-wechat-native-db',
      contacts: items.map((item) => item.nickname || item.remark || item.wxid).filter(Boolean),
      items,
      count: items.length,
      currentWechatId,
      syncedAt: now,
      diagnostics: {
        ...diagnostics,
        stage: 'native-db-completed',
        dbContactCount: items.length,
        layers: {
          ...diagnostics.layers,
          db: {
            ...diagnostics.layers.db,
            status: 'completed',
            contactCount: items.length,
          },
        },
      },
    });
  }

  if (helperInfo) {
    const helperResult = collectByHelper(helperInfo, dbPaths, mode, processInfo);
    Object.assign(diagnostics, helperResult.diagnostics);
    diagnostics.warnings = mergeWarnings(diagnostics.warnings, helperResult.diagnostics.warnings);
    diagnostics.layers.helper = {
      ...diagnostics.layers.helper,
      status: diagnostics.helperStatus,
      path: diagnostics.helperPath || diagnostics.decryptionHelperPath,
      kind: diagnostics.helperKind,
      contactCount: diagnostics.helperContactCount,
      exitCode: diagnostics.helperExitCode,
      error: diagnostics.helperError,
      stdoutTail: diagnostics.helperStdoutTail,
      stderrTail: diagnostics.helperStderrTail,
      helperDiagnostics: diagnostics.helperDiagnostics,
    };
    if (helperResult.items.length) {
      const items = stripPrivateKeys(helperResult.items);
      const helperSource = diagnostics.helperSource === 'windows-wechat-db-decrypted'
        ? 'windows-wechat-db-decrypted'
        : 'windows-wechat-native-helper';
      const currentWechatId = diagnostics.selectedDbAccountFolder || diagnostics.selectedDbBaseWxid || '';
      emit({
        ok: true,
        contractVersion: CONTACTS_CONTRACT_VERSION,
        mode,
        source: helperSource,
        contacts: items.map((item) => item.nickname || item.remark || item.wxid).filter(Boolean),
        items,
        count: items.length,
        currentWechatId,
        syncedAt: now,
        diagnostics: {
          ...diagnostics,
          stage: 'native-helper-completed',
          helperContactCount: items.length,
          layers: {
            ...diagnostics.layers,
            helper: {
              ...diagnostics.layers.helper,
              status: 'completed',
              contactCount: items.length,
            },
          },
        },
      });
    }
  } else {
    diagnostics.layers.helper = {
      ...diagnostics.layers.helper,
      status: diagnostics.helperStatus,
      error: diagnostics.helperStatus === 'missing' ? 'db helper not found' : 'no runnable db helper found',
    };
  }

  if (diagnostics.dbKeyStatus === 'encrypted-or-locked' && helperInfo) {
    diagnostics.warnings.push('encrypted WeChat DB detected; helper contract did not produce decrypted contacts');
  } else if (diagnostics.dbKeyStatus === 'encrypted-or-locked') {
    diagnostics.warnings.push('encrypted WeChat DB detected; no decryption helper is bundled');
  }

  if (!allowUiaContactFallback) {
    const dbOnlyReason = diagnostics.helperError ||
      diagnostics.dbError ||
      diagnostics.warnings.join('；') ||
      'DB/helper did not return contacts; UIA/OCR screen collection is disabled by default';
    diagnostics.uiaStatus = 'skipped-db-helper-required';
    diagnostics.uiaSource = uiaSourceForMode(mode);
    diagnostics.confidence = 'db-required';
    diagnostics.failureLayer = diagnostics.helperStatus && diagnostics.helperStatus !== 'missing' ? 'helper' : 'db';
    diagnostics.failureReason = dbOnlyReason;
    diagnostics.warnings = mergeWarnings(diagnostics.warnings, [
      'UIA/OCR screen collection was skipped; WeChat contacts must come from the database/helper chain.',
    ]);
    diagnostics.layers.uia = {
      ...diagnostics.layers.uia,
      status: 'skipped-db-helper-required',
      source: diagnostics.uiaSource,
      diagnosticOnly: true,
      skippedReason: 'db-helper-required',
    };
    emit({
      ok: false,
      contractVersion: CONTACTS_CONTRACT_VERSION,
      mode,
      confidence: diagnostics.confidence,
      error: mode === 'all'
        ? 'Windows 微信联系人全量同步失败：数据库/helper 主链路没有拿到联系人，已跳过 UIA/OCR 屏幕采集'
        : 'Windows 微信联系人同步失败：数据库/helper 主链路没有拿到联系人，已跳过 UIA/OCR 屏幕采集',
      diagnostics: {
        ...diagnostics,
        stage: 'native-db-helper-blocked',
      },
    }, 3);
  }

  const uiaResult = collectByUia(mode);
  Object.assign(diagnostics, {
    ...uiaResult.diagnostics,
    warnings: mergeWarnings(diagnostics.warnings, (uiaResult.diagnostics && uiaResult.diagnostics.warnings) || []),
  });
  const uiaSource = uiaSourceForMode(mode);
  const lowConfidenceReason = lowConfidenceUiaReason(mode, uiaResult.items, diagnostics);
  const uiaConfidence = uiaConfidenceForMode(mode, lowConfidenceReason);
  diagnostics.uiaSource = uiaSource;
  diagnostics.uiaConfidence = uiaConfidence;
  diagnostics.confidence = uiaConfidence;
  if (!allowUiaContactFallback) {
    diagnostics.warnings = mergeWarnings(diagnostics.warnings, [
      'UIA/OCR contact collection is diagnostic-only; DB/helper sync is required for a successful contact sync.',
    ]);
  } else {
    diagnostics.resultSource = uiaSource;
  }
  if (lowConfidenceReason) {
    diagnostics.uiaStatus = diagnostics.uiaStatus === 'completed' ? 'low-confidence' : diagnostics.uiaStatus;
    diagnostics.failureLayer = 'uia';
    diagnostics.failureReason = lowConfidenceReason;
    diagnostics.warnings = mergeWarnings(diagnostics.warnings, [lowConfidenceReason]);
  }
  diagnostics.layers.uia = {
    ...diagnostics.layers.uia,
    status: diagnostics.uiaStatus,
    source: uiaSource,
    confidence: uiaConfidence,
    contactCount: diagnostics.uiaContactCount,
    pagesScanned: diagnostics.pagesScanned,
    maxPagesRequested: diagnostics.uiaMaxPagesRequested,
    stopReason: diagnostics.uiaStopReason,
    scrollAttempts: diagnostics.uiaScrollAttempts,
    scrollResetAttempts: diagnostics.uiaScrollResetAttempts,
    contactNavigationAction: diagnostics.uiaContactNavigationAction,
    contactNavigationTarget: diagnostics.uiaContactNavigationTarget,
    duplicatePages: diagnostics.uiaDuplicatePages,
    nodeLimitHit: diagnostics.uiaNodeLimitHit,
    error: diagnostics.uiaError,
    pageSummaries: diagnostics.uiaPageSummaries,
    firstLast: diagnostics.uiaFirstLast,
    lowConfidenceReason: lowConfidenceReason || undefined,
  };
  if (uiaResult.items.length) {
    const items = withUiaConfidence(stripPrivateKeys(uiaResult.items), uiaConfidence);
    if (!allowUiaContactFallback) {
      diagnostics.layers.uia = {
        ...diagnostics.layers.uia,
        status: diagnostics.uiaStatus,
        contactCount: items.length,
        confidence: uiaConfidence,
        firstLast: diagnostics.uiaFirstLast,
        diagnosticOnly: true,
      };
      diagnostics.failureLayer = diagnostics.failureLayer || 'helper';
      diagnostics.failureReason = diagnostics.failureReason ||
        'DB/helper did not return contacts; UIA/OCR result is diagnostic-only and is not accepted as contact sync success';
    } else if (lowConfidenceReason) {
      diagnostics.layers.uia = {
        ...diagnostics.layers.uia,
        status: diagnostics.uiaStatus,
        contactCount: items.length,
        confidence: uiaConfidence,
        firstLast: diagnostics.uiaFirstLast,
        lowConfidenceReason,
      };
    } else {
      emit({
        ok: true,
        contractVersion: CONTACTS_CONTRACT_VERSION,
        mode,
        source: uiaSource,
        confidence: uiaConfidence,
        contacts: items.map((item) => item.nickname || item.remark || item.wxid).filter(Boolean),
        items,
        count: items.length,
        syncedAt: now,
        diagnostics: {
          ...diagnostics,
          source: uiaSource,
          resultSource: uiaSource,
          confidence: uiaConfidence,
          stage: mode === 'all'
            ? 'native-uia-scroll-completed'
            : 'native-uia-visible-completed',
          uiaContactCount: items.length,
          layers: {
            ...diagnostics.layers,
            uia: {
              ...diagnostics.layers.uia,
              status: 'completed',
              contactCount: items.length,
              confidence: uiaConfidence,
              firstLast: diagnostics.uiaFirstLast,
            },
          },
        },
      });
    }
  }

  diagnostics.failureLayer = diagnostics.failureLayer || resolveFailureLayer(diagnostics);
  diagnostics.failureReason = diagnostics.failureReason || resolveFailureReason(diagnostics);
  emit({
    ok: false,
    contractVersion: CONTACTS_CONTRACT_VERSION,
    mode,
    ...(diagnostics.resultSource ? { source: diagnostics.resultSource } : {}),
    ...(diagnostics.confidence ? { confidence: diagnostics.confidence } : {}),
    error: mode === 'all'
      ? 'Windows 微信联系人全量同步失败：native runtime 没有拿到可用联系人'
      : 'Windows 微信联系人同步失败：native runtime 没有拿到可用联系人',
    diagnostics: {
      ...diagnostics,
      stage: 'native-no-contacts',
    },
  }, 3);
}

function runDiagnose() {
  const processInfo = discoverWechatProcess();
  const dbPaths = findContactDbCandidates(processInfo);
  const helperInfos = describeDbHelpers(findDecryptionHelpers());
  const helperInfo = firstRunnableHelper(helperInfos);
  const commandRunners = Object.fromEntries(
    CONTROLLED_COMMANDS.map((controlledCommand) => {
      const candidates = describeCommandRunners(
        findCommandRunnerCandidates(controlledCommand),
        controlledCommand,
      );
      const runnable = candidates.find((item) => item.runnable);
      return [
        controlledCommand,
        {
          status: runnable ? 'ready' : candidates.length ? 'detected-not-runnable' : 'missing',
          path: runnable && runnable.path,
          kind: runnable && runnable.kind,
          candidates,
        },
      ];
    }),
  );
  const diagnostics = baseDiagnostics('random', dbPaths, helperInfos, processInfo);
  const helperProbe = probeDbHelper(helperInfo);
  Object.assign(diagnostics, helperProbe);
  diagnostics.stage = 'native-diagnose';
  diagnostics.sqlitePath = findSqlitePath();
  diagnostics.externalCommandRunners = commandRunners;
  diagnostics.layers.db = {
    ...diagnostics.layers.db,
    status: dbPaths.length ? 'candidate-found' : 'not-found',
    sqlitePath: diagnostics.sqlitePath,
  };
  diagnostics.layers.helper = {
    ...diagnostics.layers.helper,
    status: helperProbe.helperProbeStatus,
    probeError: helperProbe.helperProbeError,
    probeCapabilities: helperProbe.helperProbeCapabilities,
    helperVersion: helperProbe.helperVersion,
  };
  emit({
    ok: true,
    contractVersion: CONTACTS_CONTRACT_VERSION,
    source: ENGINE_NAME,
    diagnostics,
  });
}

function runContract() {
  emit({
    ok: true,
    source: ENGINE_NAME,
    contactsContractVersion: CONTACTS_CONTRACT_VERSION,
    unifiedCommandContractVersion: UNIFIED_COMMAND_CONTRACT_VERSION,
    output: {
      contractVersion: UNIFIED_COMMAND_CONTRACT_VERSION,
      supportedCommands: SUPPORTED_COMMANDS,
      implementedCommands: SUPPORTED_COMMANDS,
      controlledCommands: CONTROLLED_COMMANDS,
      blockedCommands: [],
      dryRun: {
        request: 'context.safety.dryRun:true or AI_CONTENT_WECHAT_DRY_RUN=1',
        status: 'ok:true, status:"skipped", errorCode:"success"',
        guarantees: [
          'validates command input before any platform or runner execution',
          'does not launch external runners',
          'does not touch WeChat windows, files, clipboard, or DB state',
          'always returns raw.realWechatActionAttempted:false',
        ],
      },
      inputValidation: {
        'group-broadcast': ['targets[] with searchable id/name/searchText', 'message.text or attachments[]', 'attachment paths must exist'],
        'contact-add': ['targets[] with searchable id/name/searchText', 'global or per-target verifyMessage'],
        'moments-publish': ['content.text or content.assets[]', 'asset paths must exist'],
        'moments-marketing': ['browse, like, or comment action', 'fixedText when comment=true', 'targets[] or browseLimit for feed browsing'],
        'chat-history': ['action sync|sessions|messages|visible', 'limit 1-500', 'sessionId when action=messages'],
      },
      unsupportedPlatform: {
        appliesTo: CONTROLLED_COMMANDS,
        status: 'ok:false, status:"blocked", errorCode:"unsupported_platform"',
        bypassForSmokeOnly: 'AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER=1',
      },
      realExecutionEvidence: {
        writeLikeCommands: [
          'raw.realWechatActionAttempted:true or diagnostics.raw.realWechatActionAttempted:true',
          'matched readback on output.readback or output.results[].readback',
          'evidence[] or screenshotPath on output/results/diagnostics',
        ],
        chatHistory: [
          'output.source must not be empty/dry-run/not_connected',
          'output.sessions[] or output.messages[] must be non-empty',
          'evidence[] or screenshotPath on output/diagnostics',
        ],
      },
    },
    statusSchema: {
      success: '命令完成且有可信输出。',
      partial: '命令部分完成，调用方必须检查 output 和 diagnostics。',
      blocked: '命令被能力、平台、权限、风控或实现状态阻断；不得当作成功。',
      failed: '命令执行失败，调用方应读取 errorCode/errorDetail/diagnostics。',
      skipped: '命令按策略跳过。',
    },
    responseShape: {
      ok: 'boolean; false means blocked/failed/skipped and must not be treated as success',
      command: 'contacts|group-broadcast|contact-add|moments-publish|moments-marketing|chat-history',
      status: 'success|partial|blocked|failed|skipped',
      errorCode: 'success or a stable machine-readable failure code',
      nextAction: 'operator-safe next step',
      output: 'command-specific output; blocked commands return empty/blocked output only',
      diagnostics: 'command/stage/runtime/layer diagnostics',
      errorDetail: 'structured failure details when ok=false',
    },
    commandMatrix: [
      {
        command: 'contacts',
        implementation: 'implemented',
        supportsAutoSend: false,
        realSendSupported: false,
        platforms: ['win32'],
        notes: 'Reads contacts through plaintext DB, self-developed helper contract, or Windows UIAutomation fallback.',
      },
      {
        command: 'group-broadcast',
        implementation: 'bundled-windows-runner-or-controlled-preflight',
        supportsAutoSend: 'only when a self-developed external runner returns readback evidence',
        realSendSupported: 'runner-dependent',
        platforms: ['win32'],
        notes: 'Invokes a configured self-developed runner first; otherwise validates targets/content/rate limit and blocks without sending.',
      },
      {
        command: 'contact-add',
        implementation: 'bundled-windows-runner-or-controlled-preflight',
        supportsAutoSend: 'only when a self-developed external runner returns readback evidence',
        realSendSupported: 'runner-dependent',
        platforms: ['win32'],
        notes: 'Invokes a configured self-developed runner first; otherwise validates targets, verify message, blacklist tags, remark policy and blocks.',
      },
      {
        command: 'moments-publish',
        implementation: 'bundled-windows-runner-or-controlled-preflight',
        supportsAutoSend: 'only when a self-developed external runner returns readback evidence',
        realSendSupported: 'runner-dependent',
        platforms: ['win32'],
        notes: 'Invokes a configured self-developed runner first; otherwise validates copy/media paths and blocks before publish.',
      },
      {
        command: 'moments-marketing',
        implementation: 'bundled-windows-runner-or-controlled-preflight',
        supportsAutoSend: 'only when a self-developed external runner returns readback evidence',
        realSendSupported: 'runner-dependent',
        platforms: ['win32'],
        notes: 'Invokes a configured self-developed runner first; otherwise validates mode/actions/comment material and blocks.',
      },
      {
        command: 'chat-history',
        implementation: 'bundled-windows-runner-or-controlled-read-preflight',
        supportsAutoSend: false,
        realSendSupported: 'runner-dependent',
        platforms: ['win32'],
        notes: 'Invokes a configured self-developed reader first; otherwise returns a stable blocked read contract and never fabricates sessions or messages.',
      },
    ],
    commercialLimitations: [
      'No command in this runtime performs real bulk sending, contact adding, Moments publishing, liking, commenting, or chat extraction beyond the implemented contacts collector.',
      'Write-like WeChat tasks may call a configured self-developed external runner, but success is rejected unless real action/readback evidence is returned.',
      'Without a configured runner, write-like WeChat tasks move through an audited controlled-preflight runner and stay blocked.',
      'Do not copy or embed third-party WeChat automation/decryption code.',
    ],
    externalRunner: {
      contractVersion: UNIFIED_COMMAND_CONTRACT_VERSION,
      discovery: [
        'AI_CONTENT_WECHAT_COMMAND_RUNNER_<COMMAND>',
        'AI_CONTENT_WECHAT_NATIVE_COMMAND_RUNNER',
        'AI_CONTENT_WECHAT_WRITE_RUNNER',
        'AI_CONTENT_WECHAT_NATIVE_RUNNER_DIR',
        '../wechat-native-runners/kaypal-wechat-<command>-runner.exe|.js',
      ],
      invocation: `runner <command> --contract ${UNIFIED_COMMAND_CONTRACT_VERSION}`,
      stdin: {
        contractVersion: UNIFIED_COMMAND_CONTRACT_VERSION,
        command: 'group-broadcast|contact-add|moments-publish|moments-marketing|chat-history',
        input: 'command-specific payload',
        context: '{ runId, account, safety, metadata }',
        diagnostics: 'request diagnostics',
      },
      successRequirements: [
      'write-like commands must return raw.realWechatActionAttempted:true or diagnostics.raw.realWechatActionAttempted:true',
      'write-like commands must return readback.matched:true on top-level output or at least one result',
      'write-like commands must return evidence[] or screenshotPath on output/results/diagnostics',
      'chat-history must return a real source plus non-empty sessions[] or messages[]',
      'chat-history must return evidence[] or screenshotPath on output/diagnostics',
      ],
    },
    contacts: contractSummary('random'),
    helper: {
      version: DB_HELPER_CONTRACT_VERSION,
      invocation: `helper contacts --contract ${DB_HELPER_CONTRACT_VERSION} --mode random|all`,
      stdin: {
        contractVersion: DB_HELPER_CONTRACT_VERSION,
        mode: 'random|all',
        dbPaths: 'string[] discovered WeChat DB candidates',
        roots: 'string[] discovered WeChat data roots',
        process: '{ processId, processName, executablePath, mainWindowHandle, windowTitle, wechatVersion }',
        limits: '{ randomLimit, allLimit }',
      },
      stdout: {
        ok: true,
        source: 'wechat-native-db-helper',
        items: 'Array<{ wxid, nickname, remark, alias, tags }>',
        contacts: 'optional string[] fallback display names',
        diagnostics: '{ dbKeyStatus, helperVersion, warnings }',
      },
      failureStdout: {
        ok: false,
        error: 'user-safe helper failure',
        diagnostics: 'helper-specific diagnostics',
      },
    },
  });
}

function readCommandRequest(command) {
  let raw = argValue('--request-json', '') || process.env.AI_CONTENT_WECHAT_NATIVE_COMMAND_REQUEST || '';
  if (!raw && !process.stdin.isTTY) {
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          raw = fs.readFileSync(0, 'utf8').trim();
          break;
        } catch (error) {
          if (error && error.code === 'EAGAIN' && attempt < 4) {
            sleepMs(30 * (attempt + 1));
            continue;
          }
          throw error;
        }
      }
    } catch {
      raw = '';
    }
  }
  if (!raw) {
    return {
      input: {},
      context: {},
      diagnostics: {
        requestSource: 'empty',
      },
    };
  }
  const parsed = safeJsonParse(raw);
  if (parsed.parseError) {
    return {
      input: {},
      context: {},
      diagnostics: {
        requestSource: 'invalid-json',
        requestBytes: raw.length,
        requestParseError: parsed.parseError,
        warnings: [`${command} request JSON parse failed: ${parsed.parseError}`],
      },
    };
  }
  const envelopeInput =
    parsed && typeof parsed === 'object' && parsed.input && typeof parsed.input === 'object'
      ? parsed.input
      : parsed;
  return {
    input: envelopeInput && typeof envelopeInput === 'object' ? envelopeInput : {},
    context: parsed && typeof parsed === 'object' && parsed.context && typeof parsed.context === 'object'
      ? parsed.context
      : {},
    diagnostics: {
      requestSource: parsed && parsed.contractVersion ? 'command-envelope' : 'raw-input',
      requestCommand: compactText(parsed && parsed.command),
      requestBytes: raw.length,
      warnings: parsed && parsed.command && parsed.command !== command
        ? [`request command ${parsed.command} does not match argv command ${command}; argv command wins`]
        : [],
    },
  };
}

function commandRunnerPayload(command, request) {
  return {
    contractVersion: UNIFIED_COMMAND_CONTRACT_VERSION,
    command,
    input: request.input || {},
    context: request.context || {},
    diagnostics: request.diagnostics || {},
  };
}

function extractOutputObject(payload) {
  return payload && payload.output && typeof payload.output === 'object' && !Array.isArray(payload.output)
    ? payload.output
    : {};
}

function readbackMatched(value) {
  const record = asRecord(value);
  if (record.matched === true) return true;
  if (/success|matched|confirmed/i.test(compactText(record.status))) return true;
  return false;
}

function payloadHasReadbackEvidence(command, payload) {
  if (command === 'chat-history') {
    const output = extractOutputObject(payload);
    const sessions = Array.isArray(output.sessions) ? output.sessions : Array.isArray(payload.sessions) ? payload.sessions : null;
    const messages = Array.isArray(output.messages) ? output.messages : Array.isArray(payload.messages) ? payload.messages : null;
    const source = compactText(output.source || payload.source);
    const hasRows =
      (Array.isArray(sessions) && sessions.length > 0) ||
      (Array.isArray(messages) && messages.length > 0);
    return Boolean(hasRows && source && !/^(empty|dry-run|not_connected|not-connected|none)$/i.test(source));
  }
  const output = extractOutputObject(payload);
  if (readbackMatched(payload.readback) || readbackMatched(output.readback)) return true;
  const results = Array.isArray(output.results) ? output.results : Array.isArray(payload.results) ? payload.results : [];
  return results.some((item) => readbackMatched(asRecord(item).readback));
}

function evidenceArrayHasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function payloadHasExecutionEvidence(payload) {
  const output = extractOutputObject(payload);
  const diagnostics = asRecord(payload.diagnostics);
  if (evidenceArrayHasItems(payload.evidence) || evidenceArrayHasItems(output.evidence)) return true;
  if (compactText(payload.screenshotPath || output.screenshotPath || diagnostics.screenshotPath)) return true;
  const results = Array.isArray(output.results) ? output.results : Array.isArray(payload.results) ? payload.results : [];
  return results.some((item) => evidenceArrayHasItems(asRecord(item).evidence));
}

function payloadAttemptedRealWechatAction(payload) {
  const diagnostics = asRecord(payload.diagnostics);
  const raw = asRecord(payload.raw);
  const diagnosticsRaw = asRecord(diagnostics.raw);
  return raw.realWechatActionAttempted === true || diagnosticsRaw.realWechatActionAttempted === true;
}

function withExternalRunnerDiagnostics(command, payload, runnerInfo, result, status, extra = {}) {
  const diagnostics = asRecord(payload.diagnostics);
  return {
    ...payload,
    diagnostics: {
      ...diagnostics,
      externalRunner: {
        status,
        command,
        path: runnerInfo && runnerInfo.path,
        kind: runnerInfo && runnerInfo.kind,
        exitCode: result && result.status,
        signal: result && result.signal,
        stdoutTail: result ? String(result.stdout || '').slice(-1000) : '',
        stderrTail: result ? String(result.stderr || '').slice(-1000) : '',
        ...extra,
      },
      attemptedSources: uniqueText([
        ...(
          Array.isArray(diagnostics.attemptedSources)
            ? diagnostics.attemptedSources.map(compactText)
            : []
        ),
        'native-external-runner',
      ]),
    },
  };
}

function enforceExternalRunnerSuccessEvidence(command, payload, request, runnerInfo, result) {
  if (payload.ok !== true || !/^(success|partial)?$/i.test(compactText(payload.status || 'success'))) {
    return withExternalRunnerDiagnostics(command, payload, runnerInfo, result, 'completed');
  }
  if (
    payloadHasReadbackEvidence(command, payload) &&
    payloadHasExecutionEvidence(payload) &&
    (command === 'chat-history' || payloadAttemptedRealWechatAction(payload))
  ) {
    return withExternalRunnerDiagnostics(command, payload, runnerInfo, result, 'completed');
  }
  const message = command === 'chat-history'
    ? '外部 chat-history runner 返回成功，但缺少真实会话/消息来源或证据字段，已拒绝作为成功。'
    : '外部微信 runner 返回成功，但缺少真实动作标记、动作后读回或证据字段，已拒绝作为成功。';
  const diagnostics = asRecord(payload.diagnostics);
  return withExternalRunnerDiagnostics(command, {
    ...payload,
    ok: false,
    status: 'blocked',
    errorCode: 'readback_failed',
    error: message,
    message,
    nextAction: '补齐外部 runner 的真实动作标记、截图/文本读回和对象级证据后再开放自动执行。',
    retryable: true,
    manualActionRequired: true,
    diagnostics: {
      ...diagnostics,
      stage: `${command}-external-runner-readback-rejected`,
      warnings: uniqueText([
        ...(Array.isArray(diagnostics.warnings) ? diagnostics.warnings : []),
        message,
        `requestSource=${compactText(request.diagnostics && request.diagnostics.requestSource) || 'unknown'}`,
      ]),
    },
    raw: {
      ...asRecord(payload.raw),
      externalRunnerRejected: true,
      realWechatActionAttempted: payloadAttemptedRealWechatAction(payload),
      readbackEvidencePresent: payloadHasReadbackEvidence(command, payload),
      executionEvidencePresent: payloadHasExecutionEvidence(payload),
    },
  }, runnerInfo, result, 'readback-rejected');
}

function runExternalCommandRunner(command, request) {
  const runnerInfo = firstRunnableCommandRunner(command);
  if (!runnerInfo) return null;
  const launch = commandRunnerLaunchSpec(runnerInfo, command);
  if (!launch) {
    return {
      ok: false,
      command,
      status: 'blocked',
      errorCode: 'runtime_unavailable',
      error: '外部微信 runner 启动参数不可用。',
      nextAction: '检查 runner 文件类型和执行权限。',
      diagnostics: {
        stage: `${command}-external-runner-launch-spec-missing`,
        externalRunner: {
          status: 'failed-launch-spec',
          path: runnerInfo.path,
          kind: runnerInfo.kind,
        },
      },
    };
  }
  const timeoutMs = Number(request.context && request.context.timeoutMs) || Number(process.env.AI_CONTENT_WECHAT_RUNNER_TIMEOUT_MS) || 120000;
  const payload = commandRunnerPayload(command, request);
  const result = run(launch.command, launch.args, {
    timeout: Math.max(5000, timeoutMs),
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      AI_CONTENT_WECHAT_NATIVE_COMMAND: command,
      AI_CONTENT_WECHAT_NATIVE_COMMAND_CONTRACT: UNIFIED_COMMAND_CONTRACT_VERSION,
    },
  });
  const jsonLine = findLastJsonLine(result.stdout);
  if (!jsonLine) {
    return withExternalRunnerDiagnostics(command, {
      ok: false,
      command,
      status: 'blocked',
      errorCode: result.error && result.error.code === 'ETIMEDOUT' ? 'timeout' : 'runtime_unavailable',
      error: `外部微信 runner 没有返回 JSON：${compactText(result.stderr || result.stdout || result.error && result.error.message || 'no output')}`,
      nextAction: '检查外部 runner 是否按统一合同向 stdout 输出单个 JSON 对象。',
      retryable: true,
      manualActionRequired: true,
      diagnostics: {
        stage: `${command}-external-runner-no-json`,
      },
    }, runnerInfo, result, 'no-json');
  }
  const parsed = safeJsonParse(jsonLine);
  if (parsed.parseError) {
    return withExternalRunnerDiagnostics(command, {
      ok: false,
      command,
      status: 'blocked',
      errorCode: 'runtime_unavailable',
      error: `外部微信 runner JSON 解析失败：${parsed.parseError}`,
      nextAction: '检查外部 runner 输出格式，只保留最后一行 JSON。',
      retryable: true,
      manualActionRequired: true,
      diagnostics: {
        stage: `${command}-external-runner-json-parse-failed`,
      },
    }, runnerInfo, result, 'json-parse-failed');
  }
  return enforceExternalRunnerSuccessEvidence(command, {
    ...asRecord(parsed),
    command,
  }, request, runnerInfo, result);
}

function targetDisplayName(target, index) {
  const record = asRecord(target);
  return compactText(
    record.displayName ||
      record.remark ||
      record.nickname ||
      record.targetName ||
      record.searchText ||
      record.wxid ||
      record.id ||
      (typeof target === 'string' ? target : '') ||
      `target-${index + 1}`,
  );
}

function targetSelector(target) {
  const record = asRecord(target);
  return compactText(
    record.searchText ||
      record.wxid ||
      record.id ||
      record.displayName ||
      record.remark ||
      record.nickname ||
      record.targetName ||
      (typeof target === 'string' ? target : ''),
  );
}

function assetPath(asset) {
  const record = asRecord(asset);
  return compactText(record.path || (typeof asset === 'string' ? asset : ''));
}

function commandTargets(command, input) {
  if (command === 'group-broadcast' || command === 'contact-add') {
    return Array.isArray(input.targets) ? input.targets : [];
  }
  if (command === 'moments-marketing') {
    if (Array.isArray(input.targets)) return input.targets;
    if (Array.isArray(input.contacts)) return input.contacts;
  }
  return [];
}

function plannedBatchTargets(command, input) {
  const targets = commandTargets(command, input);
  if (command === 'moments-marketing' && !targets.length) {
    const limit = boundedInteger(input.browseLimit || 1, 1, 1, 100);
    return Array.from({ length: limit }, (_, index) => ({
      id: `moments-feed-${index + 1}`,
      displayName: `朋友圈第 ${index + 1} 条`,
      ordinal: index + 1,
      synthetic: true,
    }));
  }
  return targets;
}

function actionForCommand(command, input) {
  if (command === 'contact-add') return 'add-contact';
  if (command === 'moments-marketing') {
    if (input && input.actions && input.actions.comment) return 'comment';
    if (input && input.actions && input.actions.like) return 'like';
    return 'browse';
  }
  return 'send';
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

function sendModeFromContext(context) {
  const safety = context && typeof context.safety === 'object' ? context.safety : {};
  return compactText(safety.sendMode || process.env.AI_CONTENT_WECHAT_SEND_MODE || 'approval') || 'approval';
}

function isDryRunContext(context) {
  const safety = context && typeof context.safety === 'object' ? context.safety : {};
  return Boolean(safety.dryRun) || booleanValue(process.env.AI_CONTENT_WECHAT_DRY_RUN);
}

function canRunNonWindowsCommandRunner() {
  return process.env.AI_CONTENT_WECHAT_ALLOW_NON_WINDOWS_COMMAND_RUNNER === '1';
}

function shouldBlockCommandPlatform(context) {
  return process.platform !== 'win32' && !isDryRunContext(context) && !canRunNonWindowsCommandRunner();
}

function controlledRunnerBlockedReason(command, context) {
  if (command === 'chat-history') {
    return {
      errorCode: 'runtime_unavailable',
      message: '会话历史真实 DB/UIA/OCR 读取器尚未接入可用 runner，不能伪造会话或消息。',
      nextAction: '请在 Windows 真机接入已验收的 chat-history runner，或使用 dry-run 仅验证输入合同。',
    };
  }
  const sendMode = sendModeFromContext(context);
  if (sendMode === 'auto-send' && !isDryRunContext(context)) {
    return {
      errorCode: 'approval_required',
      message: 'Windows 微信自动执行尚未通过真实读回验收，已阻断真实发送/发布/添加动作。',
      nextAction: '请先在 Windows 真机完成该命令的读回证据验收；当前只能生成受控执行计划。',
    };
  }
  return {
    errorCode: 'approval_required',
    message: '已完成受控预检，但当前 runner 不执行真实微信写入动作。',
    nextAction: '按执行计划人工核对目标和内容；接入真实 UIA/OCR 读回后再开启自动执行。',
  };
}

function evidenceRef(label, value, trusted = true) {
  return {
    type: 'text',
    label,
    value: compactText(value),
    createdAt: new Date().toISOString(),
    trusted,
  };
}

function normalizeAssetRefs(assets) {
  return (Array.isArray(assets) ? assets : [])
    .map((asset) => {
      const record = asRecord(asset);
      const filePath = assetPath(asset);
      return {
        path: filePath,
        role: compactText(record.role),
        exists: filePath ? fs.existsSync(filePath) : false,
      };
    })
    .filter((asset) => asset.path);
}

function targetHasAnyTag(target, tags) {
  const record = asRecord(target);
  const sourceTags = []
    .concat(Array.isArray(record.tags) ? record.tags : [])
    .concat(Array.isArray(record.riskLabels) ? record.riskLabels : [])
    .map(compactText)
    .filter(Boolean);
  const wanted = new Set((Array.isArray(tags) ? tags : []).map(compactText).filter(Boolean));
  return sourceTags.some((tag) => wanted.has(tag));
}

function rateLimitedTargets(targets, rateLimit = {}) {
  const limit = Math.max(0, Number(rateLimit.dailyLimit || rateLimit.batchSize || targets.length) || targets.length);
  return {
    runnable: targets.slice(0, limit),
    overLimit: targets.slice(limit),
    limit,
  };
}

function controlledBatchOutput(command, input, validation, context) {
  const targets = plannedBatchTargets(command, input);
  const action = actionForCommand(command, input);
  const now = new Date().toISOString();
  const blockedReason = controlledRunnerBlockedReason(command, context);
  const results = [];
  const rateLimit = rateLimitedTargets(targets, input.rateLimit || {});
  const blacklistTags = command === 'contact-add' && Array.isArray(input.blacklistTags)
    ? input.blacklistTags
    : [];

  targets.forEach((target, index) => {
    const targetName = targetDisplayName(target, index);
    const record = asRecord(target);
    let status = 'blocked';
    let ok = false;
    let message = blockedReason.message;
    let errorCode = blockedReason.errorCode;

    if (validation.errorCode) {
      message = validation.message;
      errorCode = validation.errorCode;
    } else if (!rateLimit.runnable.includes(target)) {
      status = 'skipped';
      message = `超过本次执行上限 ${rateLimit.limit}，该对象留待下一批。`;
      errorCode = 'rate_limited';
    } else if (command === 'contact-add' && !targetSelector(target)) {
      status = 'failed';
      message = '缺少加好友搜索目标。';
      errorCode = 'target_missing';
    } else if (command === 'contact-add' && targetHasAnyTag(target, blacklistTags)) {
      status = 'skipped';
      message = '命中黑名单标签，已跳过。';
      errorCode = 'target_not_found';
    }

    results.push({
      targetId: compactText(record.id || record.wxid || record.searchText),
      targetName,
      action,
      ok,
      status,
      message,
      errorCode,
      evidence: [
        evidenceRef('controlled-preflight', `${command} ${targetName}: ${message}`),
        evidenceRef('send-mode', sendModeFromContext(context)),
        ...(isDryRunContext(context) ? [evidenceRef('dry-run', 'true')] : []),
      ],
      readback: {
        expectedText: validation.expectedText || '',
        actualText: '',
        matched: false,
        targetName,
        capturedAt: now,
      },
      raw: {
        controlledRunner: true,
        dryRun: isDryRunContext(context),
        realWechatActionAttempted: false,
      },
    });
  });

  return {
    summary: {
      total: targets.length,
      succeeded: 0,
      failed: results.filter((item) => item.status === 'failed').length,
      blocked: results.filter((item) => item.status === 'blocked').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
    },
    results,
  };
}

function validateBatchCommand(command, rawInput) {
  const input = asRecord(rawInput);
  const targets = commandTargets(command, input);
  if (!targets.length) {
    if (command === 'moments-marketing' && boundedInteger(input.browseLimit || 1, 1, 1, 100) > 0) {
      // Browsing the visible Moments feed is valid without named contacts.
    } else {
      return {
        errorCode: 'target_missing',
        message: command === 'moments-marketing' ? '缺少朋友圈营销对象或浏览数量。' : '缺少微信执行目标。',
      };
    }
  }
  if (command === 'group-broadcast') {
    if (targets.some((target) => !targetSelector(target))) {
      return { errorCode: 'target_missing', message: '群发目标缺少可搜索的微信号、昵称、备注或展示名。' };
    }
    const text = compactText(input.message && input.message.text);
    const attachments = input.message && Array.isArray(input.message.attachments) ? input.message.attachments : [];
    if (!text && !attachments.length) {
      return { errorCode: 'content_invalid', message: '群发内容和附件不能同时为空。' };
    }
    const assets = normalizeAssetRefs(attachments);
    const missing = assets.filter((asset) => !asset.exists);
    if (missing.length) {
      return {
        errorCode: 'media_missing',
        message: `群发附件不存在：${missing.map((asset) => asset.path).join('；')}`,
      };
    }
    return { expectedText: text };
  }
  if (command === 'contact-add') {
    if (targets.some((target) => !targetSelector(target))) {
      return { errorCode: 'target_missing', message: '加好友目标缺少可搜索的微信号、昵称、备注或展示名。' };
    }
    const verifyMessage = compactText(input.verifyMessage);
    const targetVerifyMessages = targets.map((target) => compactText(asRecord(target).verifyMessage || verifyMessage));
    const hasMissingVerifyMessage = targetVerifyMessages.some((message) => !message);
    if (hasMissingVerifyMessage) {
      return { errorCode: 'content_invalid', message: '缺少加好友验证消息。' };
    }
    return { expectedText: verifyMessage || targetVerifyMessages[0] || '' };
  }
  if (command === 'moments-marketing') {
    const actions = input.actions && typeof input.actions === 'object' ? input.actions : {};
    const browseLimit = input.browseLimit === undefined ? 1 : Number(input.browseLimit);
    if (!Number.isFinite(browseLimit) || browseLimit < 1 || browseLimit > 100) {
      return { errorCode: 'content_invalid', message: '朋友圈营销 browseLimit 必须是 1-100 之间的数字。' };
    }
    if (actions.browse === false && actions.like !== true && actions.comment !== true) {
      return { errorCode: 'content_invalid', message: '朋友圈营销至少要选择浏览、点赞或评论之一。' };
    }
    if (targets.some((target) => !targetSelector(asRecord(target).contact || target))) {
      return { errorCode: 'target_missing', message: '朋友圈营销目标缺少可搜索的微信号、昵称、备注或展示名。' };
    }
    const wantsComment = Boolean(actions.comment);
    const comment = input.comment && typeof input.comment === 'object' ? input.comment : {};
    const fixedText = compactText(comment.fixedText);
    if (wantsComment && !fixedText) {
      return { errorCode: 'content_invalid', message: '朋友圈营销需要评论时，当前 Windows runner 需要固定评论 fixedText。' };
    }
    return { expectedText: wantsComment ? fixedText : '' };
  }
  return {};
}

function controlledMomentsPublishOutput(input, validation, context) {
  const content = input && input.content && typeof input.content === 'object' ? input.content : {};
  const assets = normalizeAssetRefs(content.assets);
  const blockedReason = validation.errorCode
    ? { errorCode: validation.errorCode, message: validation.message }
    : controlledRunnerBlockedReason('moments-publish', context);
  return {
    status: validation.errorCode ? 'failed' : 'blocked',
    contentText: compactText(content.text),
    assetPaths: assets.map((asset) => asset.path),
    evidence: [
      evidenceRef('controlled-preflight', blockedReason.message),
      evidenceRef('asset-check', assets.map((asset) => `${asset.exists ? 'ok' : 'missing'}:${asset.path}`).join('\n')),
      evidenceRef('send-mode', sendModeFromContext(context)),
    ],
    readback: {
      expectedText: compactText(content.text),
      actualText: '',
      matched: false,
      capturedAt: new Date().toISOString(),
    },
  };
}

function validateMomentsPublish(input) {
  const content = input && input.content && typeof input.content === 'object' ? input.content : {};
  const text = compactText(content.text);
  const assets = normalizeAssetRefs(content.assets);
  if (!text && !assets.length) {
    return { errorCode: 'content_invalid', message: '朋友圈发布文案和素材不能同时为空。' };
  }
  const missing = assets.filter((asset) => !asset.exists);
  if (missing.length) {
    return {
      errorCode: 'media_missing',
      message: `朋友圈素材不存在：${missing.map((asset) => asset.path).join('；')}`,
    };
  }
  return {};
}

function validateChatHistory(rawInput) {
  const input = asRecord(rawInput);
  const action = compactText(input.action || 'sync');
  if (!['sync', 'sessions', 'messages', 'visible'].includes(action)) {
    return { errorCode: 'content_invalid', message: '会话历史 action 仅支持 sync、sessions、messages 或 visible。' };
  }
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    return { errorCode: 'content_invalid', message: '会话历史 limit 必须是 1-500 之间的数字。' };
  }
  if (action === 'messages' && !compactText(input.sessionId)) {
    return { errorCode: 'target_missing', message: '读取指定会话消息时缺少 sessionId。' };
  }
  return { expectedText: compactText(input.sessionId || action) };
}

function controlledChatHistoryOutput(input, context = {}) {
  const now = new Date().toISOString();
  const action = compactText(input.action || 'sync');
  const sessionId = compactText(input.sessionId);
  return {
    source: 'empty',
    sessions: [],
    messages: [],
    sessionId,
    count: 0,
    syncedAt: now,
    evidence: [
      evidenceRef(isDryRunContext(context) ? 'dry-run-plan' : 'controlled-preflight', `chat-history:${action}:${sessionId || 'visible'}`),
    ],
    readback: {
      expectedText: sessionId || action,
      actualText: '',
      matched: false,
      capturedAt: now,
    },
  };
}

function controlledOutputForCommand(command, input, validation, context) {
  if (command === 'moments-publish') return controlledMomentsPublishOutput(input, validation, context);
  if (command === 'chat-history') return controlledChatHistoryOutput(input, context);
  return controlledBatchOutput(command, input, validation, context);
}

function controlledDiagnosticsForCommand(command, input, requestDiagnostics, context, validation) {
  const targets = plannedBatchTargets(command, input);
  const blockedReason = validation.errorCode
    ? { errorCode: validation.errorCode, message: validation.message, nextAction: '请先补齐输入，再重新执行预检。' }
    : controlledRunnerBlockedReason(command, context);
  const warnings = uniqueText([
    ...(Array.isArray(requestDiagnostics.warnings) ? requestDiagnostics.warnings : []),
    'Controlled preflight only: no real WeChat write/read action was attempted.',
    'Auto execution must remain blocked until Windows real-machine readback evidence is available.',
  ]);
  const diagnostics = {
    ...requestDiagnostics,
    stage: validation.errorCode ? `${command}-controlled-preflight-failed` : `${command}-controlled-preflight-blocked`,
    blocker: validation.errorCode ? validation.errorCode : 'manual_approval_required',
    platform: process.platform,
    attemptedSources: ['native-controlled-preflight'],
    permissions: [
      {
        key: 'input-contract',
        status: validation.errorCode ? 'blocked' : 'ready',
        message: validation.errorCode ? validation.message : '命令输入已通过基础合同校验。',
      },
      {
        key: 'commercial-safety',
        status: 'blocked',
        message: blockedReason.message,
      },
      {
        key: 'readback',
        status: 'blocked',
        message: '尚未接入真实 Windows 微信动作后读回，不能自动标记成功。',
      },
    ],
    evidence: [
      evidenceRef('controlled-runner', `${command} controlled preflight`),
      evidenceRef('next-action', blockedReason.nextAction || '修复阻断后重试。'),
    ],
    warnings,
    raw: {
      controlledRunner: true,
      realWechatActionAttempted: false,
      sendMode: sendModeFromContext(context),
      dryRun: isDryRunContext(context),
    },
  };
  if (command === 'group-broadcast' || command === 'contact-add' || command === 'moments-marketing') {
    const output = controlledBatchOutput(command, input, validation, context);
    diagnostics.batch = {
      requestedTargets: targets.length,
      attemptedTargets: 0,
      succeededTargets: 0,
      failedTargets: output.summary.failed,
      blockedTargets: output.summary.blocked,
      rateLimited: output.summary.skipped > 0,
    };
  }
  if (command === 'moments-publish') {
    const content = input && input.content && typeof input.content === 'object' ? input.content : {};
    const assets = normalizeAssetRefs(content.assets);
    diagnostics.momentsPublish = {
      assetCount: assets.length,
      assetPaths: assets.map((asset) => asset.path),
      publishButtonDetected: false,
      publishResultDetected: false,
    };
  }
  if (command === 'chat-history') {
    diagnostics.chatHistory = {
      sessionsScanned: 0,
      messagesScanned: 0,
      sessionId: compactText(input.sessionId),
      source: 'not_connected',
    };
  }
  return diagnostics;
}

function dryRunOutputForCommand(command, input, validation, context) {
  const output = controlledOutputForCommand(command, input, validation, context);
  if (command === 'chat-history') {
    return {
      ...output,
      source: 'dry-run',
      evidence: [
        ...(Array.isArray(output.evidence) ? output.evidence : []),
        evidenceRef('dry-run', 'true'),
      ],
    };
  }
  if (command === 'moments-publish') {
    return {
      ...output,
      status: 'dry_run',
      evidence: [
        ...(Array.isArray(output.evidence) ? output.evidence : []),
        evidenceRef('dry-run', 'true'),
      ],
    };
  }
  const results = Array.isArray(output.results)
    ? output.results.map((item) => ({
        ...item,
        ok: true,
        status: 'skipped',
        errorCode: 'success',
        message: 'dry-run 仅校验输入和生成执行计划，没有触碰微信窗口。',
        evidence: [
          ...(Array.isArray(item.evidence) ? item.evidence : []),
          evidenceRef('dry-run', 'true'),
        ],
        raw: {
          ...asRecord(item.raw),
          controlledRunner: true,
          dryRun: true,
          realWechatActionAttempted: false,
        },
      }))
    : [];
  return {
    ...output,
    summary: {
      total: results.length,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      skipped: results.length,
    },
    results,
  };
}

function dryRunResponseForCommand(command, request, validation) {
  const diagnostics = controlledDiagnosticsForCommand(
    command,
    request.input,
    request.diagnostics,
    request.context,
    validation,
  );
  return {
    ok: true,
    command,
    status: 'skipped',
    errorCode: 'success',
    message: 'dry-run 已完成输入校验和执行计划生成，未执行真实微信动作。',
    nextAction: '可在 Windows 真机取消 dry-run 后执行；真实成功仍必须返回读回和证据字段。',
    output: dryRunOutputForCommand(command, request.input, validation, request.context),
    diagnostics: {
      ...diagnostics,
      stage: `${command}-dry-run`,
      blocker: undefined,
      permissions: [
        {
          key: 'input-contract',
          status: 'ready',
          message: '命令输入已通过基础合同校验。',
        },
        {
          key: 'dry-run',
          status: 'ready',
          message: 'dry-run 不启动外部 runner，不触碰微信窗口。',
        },
      ],
      warnings: uniqueText([
        ...(Array.isArray(request.diagnostics.warnings) ? request.diagnostics.warnings : []),
        'Dry-run only: no real WeChat action was attempted.',
      ]),
      raw: {
        ...asRecord(diagnostics.raw),
        dryRun: true,
        realWechatActionAttempted: false,
      },
    },
    raw: {
      controlledRunner: true,
      dryRun: true,
      realWechatActionAttempted: false,
    },
  };
}

function controlledValidation(command, input) {
  if (command === 'moments-publish') return validateMomentsPublish(input);
  if (command === 'chat-history') return validateChatHistory(input);
  return validateBatchCommand(command, input);
}

function runControlledCommand(command) {
  const request = readCommandRequest(command);
  const validation = controlledValidation(command, request.input);
  if (validation.errorCode) {
    fail(command, {
      status: 'blocked',
      errorCode: validation.errorCode,
      blocker: validation.errorCode,
      error: validation.message,
      nextAction: '请先补齐输入，再重新执行预检。',
      output: controlledOutputForCommand(command, request.input, validation, request.context),
      diagnostics: controlledDiagnosticsForCommand(command, request.input, request.diagnostics, request.context, validation),
      retryable: true,
      manualActionRequired: true,
    }, 2);
    return;
  }
  if (isDryRunContext(request.context)) {
    respond(dryRunResponseForCommand(command, request, validation), 0);
    return;
  }
  if (shouldBlockCommandPlatform(request.context)) {
    const platformValidation = {
      errorCode: 'unsupported_platform',
      message: 'Kaypal 微信 native command runner 只能在 Windows 10/11 桌面微信环境执行。',
    };
    fail(command, {
      status: 'blocked',
      errorCode: 'unsupported_platform',
      blocker: 'unsupported_platform',
      error: platformValidation.message,
      nextAction: '请在 Windows 真机或 Windows 模拟器内运行安装包并打开桌面微信；仅合同校验可使用 dry-run。',
      output: controlledOutputForCommand(command, request.input, platformValidation, request.context),
      diagnostics: {
        ...controlledDiagnosticsForCommand(command, request.input, request.diagnostics, request.context, platformValidation),
        stage: `${command}-platform-blocked`,
        platformStatus: 'unsupported',
        failureLayer: 'platform',
        failureReason: 'not-windows',
      },
      retryable: true,
      manualActionRequired: true,
      raw: {
        controlledRunner: true,
        realWechatActionAttempted: false,
      },
    }, 2);
    return;
  }
  const externalRunnerResult = runExternalCommandRunner(command, request);
  if (externalRunnerResult) {
    respond(
      externalRunnerResult,
      externalRunnerResult.ok === true &&
        /^(success|partial)$/i.test(compactText(externalRunnerResult.status || 'success'))
        ? 0
        : 2,
    );
    return;
  }
  const blockedReason = controlledRunnerBlockedReason(command, request.context);
  fail(command, {
    status: 'blocked',
    errorCode: blockedReason.errorCode,
    blocker: command === 'chat-history' ? 'runtime_unavailable' : 'manual_approval_required',
    error: blockedReason.message,
    nextAction: blockedReason.nextAction,
    output: controlledOutputForCommand(command, request.input, validation, request.context),
    diagnostics: controlledDiagnosticsForCommand(command, request.input, request.diagnostics, request.context, validation),
    retryable: true,
    manualActionRequired: true,
  }, 2);
}

const command = process.argv[2] || 'contacts';
try {
  if (command === 'contacts') {
    runContacts();
  } else if (command === 'diagnose') {
    runDiagnose();
  } else if (command === 'contract' || command === 'helper-contract') {
    runContract();
  } else if (CONTROLLED_COMMANDS.includes(command)) {
    runControlledCommand(command);
  } else {
    fail(command, {
      status: 'failed',
      errorCode: 'unknown',
      error: `Unknown command: ${command}`,
      nextAction: `Use one of: ${SUPPORTED_COMMANDS.join(', ')}, diagnose, contract.`,
      diagnostics: {
        stage: 'unknown-command',
        supportedCommands: SUPPORTED_COMMANDS,
      },
      retryable: false,
      manualActionRequired: true,
    }, 64);
  }
} catch (error) {
  fail(command || 'unknown', {
    status: 'failed',
    errorCode: 'unknown',
    error: 'WeChat native runtime failed before completing the command.',
    technicalMessage: error instanceof Error ? error.message : String(error),
    nextAction: '请查看 diagnostics.raw.exception 后修复 runtime 入口异常再重试。',
    diagnostics: {
      stage: 'runtime-unhandled-exception',
      raw: {
        exception: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
      },
    },
    retryable: false,
    manualActionRequired: true,
  }, 70);
}
