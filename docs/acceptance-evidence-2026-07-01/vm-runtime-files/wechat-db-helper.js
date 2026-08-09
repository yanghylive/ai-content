#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HELPER_NAME = 'kaypal-wechat-db-helper';
const HELPER_VERSION = '0.2.0';
const CONTRACT_VERSION = 'kaypal-wechat-db-helper/v1';
const DEFAULT_RANDOM_LIMIT = 500;
const DEFAULT_ALL_LIMIT = 50000;
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FILES = 80;
const DECRYPTED_DB_ROOT = path.join(os.tmpdir(), 'ai-content-wechat-contact-db');
const FALLBACK_WECHAT_DB_DECRYPTOR_SOURCE_BASE64 = '';

let emitted = false;

function compactText(value) {
  return String(value || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function emit(payload, code = 0) {
  if (emitted) return;
  emitted = true;
  const base = {
    ok: Boolean(payload && payload.ok),
    helper: HELPER_NAME,
    helperVersion: HELPER_VERSION,
    contractVersion: CONTRACT_VERSION,
  };
  process.stdout.write(`${JSON.stringify({ ...base, ...(payload || {}) })}\n`);
  process.exit(code);
}

process.on('uncaughtException', (error) => {
  emit({
    ok: false,
    status: 'failed',
    error: 'wechat db helper crashed',
    diagnostics: {
      stage: 'uncaught-exception',
      message: compactText(error && error.message ? error.message : error),
    },
  }, 70);
});

process.on('unhandledRejection', (reason) => {
  emit({
    ok: false,
    status: 'failed',
    error: 'wechat db helper rejected unexpectedly',
    diagnostics: {
      stage: 'unhandled-rejection',
      message: compactText(reason && reason.message ? reason.message : reason),
    },
  }, 70);
});

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function allArgValues(names) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (!names.includes(process.argv[index])) continue;
    if (process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function readJsonStdin() {
  if (process.stdin.isTTY) {
    return { value: {}, raw: '', hasInput: false };
  }
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (error) {
    return {
      value: {},
      raw: '',
      hasInput: false,
      error: `stdin read failed: ${compactText(error.message)}`,
    };
  }
  if (!raw.trim()) return { value: {}, raw, hasInput: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      value: parsed && typeof parsed === 'object' ? parsed : {},
      raw,
      hasInput: true,
    };
  } catch (error) {
    return {
      value: {},
      raw,
      hasInput: true,
      error: `stdin json parse failed: ${compactText(error.message)}`,
    };
  }
}

function uniquePaths(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    let full = '';
    try {
      full = path.resolve(String(item));
    } catch {
      continue;
    }
    const key = process.platform === 'win32' ? full.toLowerCase() : full;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(full);
  }
  return out;
}

function pathExists(candidate) {
  try {
    return Boolean(candidate && fs.existsSync(candidate));
  } catch {
    return false;
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function toBase64Utf8(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    return { parseError: compactText(error.message || error) };
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

function sqliteCandidates(input) {
  return [
    argValue('--sqlite'),
    argValue('--sqlite-path'),
    input.sqlitePath,
    input.sqliteExe,
    process.env.AI_CONTENT_SQLITE_EXE,
    process.env.SQLITE_EXE,
    path.join(__dirname, 'sqlite3.exe'),
    path.join(__dirname, 'sqlite3'),
    'sqlite3.exe',
    'sqlite3',
  ].filter(Boolean);
}

function resolveSqlite(input = {}) {
  const attempts = [];
  for (const candidate of sqliteCandidates(input)) {
    const text = String(candidate);
    const isPathLike = text.includes(path.sep) || text.includes('/') || /^[A-Za-z]:[\\/]/.test(text);
    if (isPathLike && !pathExists(text)) {
      attempts.push({ path: text, status: 'missing' });
      continue;
    }
    const result = run(text, ['-version'], { timeout: 5000 });
    const status = result.status === 0 ? 'ready' : 'failed';
    attempts.push({
      path: text,
      status,
      exitCode: result.status,
      error: compactText((result.error && result.error.message) || result.stderr || result.stdout),
    });
    if (result.status === 0) {
      return { path: text, attempts };
    }
  }
  return { path: '', attempts };
}

function isPlainSqliteDatabase(dbPath) {
  try {
    const fd = fs.openSync(dbPath, 'r');
    try {
      const header = Buffer.alloc(16);
      const read = fs.readSync(fd, header, 0, header.length, 0);
      return read === header.length && header.equals(Buffer.from('SQLite format 3\0', 'ascii'));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function backendBundleCandidates(input = {}) {
  return uniquePaths([
    input.backendBundlePath,
    process.env.AI_CONTENT_BACKEND_BUNDLE,
    path.join(__dirname, '..', 'backend', 'index.js'),
    path.join(__dirname, '..', '..', '..', 'backend', 'dist-bundle-sqlite', 'index.js'),
    path.join(__dirname, '..', '..', '..', 'backend', 'src', 'modules', 'local-engine', 'local-engine.service.ts'),
    path.join(process.cwd(), 'backend', 'dist-bundle-sqlite', 'index.js'),
    path.join(process.cwd(), 'backend', 'src', 'modules', 'local-engine', 'local-engine.service.ts'),
  ]).filter(pathExists);
}

function extractDecryptorSourceBase64(text) {
  const matches = String(text || '').matchAll(/FromBase64String\('([A-Za-z0-9+/=]{10000,})'\)/g);
  for (const match of matches) {
    const candidate = match[1];
    try {
      const source = Buffer.from(candidate, 'base64').toString('utf8');
      if (source.includes('class KaypalWechatDbDecryptor') && source.includes('DecryptWithMemoryKey')) {
        return candidate;
      }
    } catch {
      // Try the next embedded source.
    }
  }
  return '';
}

function resolveDecryptorSourceBase64(input = {}, diagnostics = {}) {
  if (FALLBACK_WECHAT_DB_DECRYPTOR_SOURCE_BASE64) {
    diagnostics.decryptorSource = 'helper-fallback';
    return FALLBACK_WECHAT_DB_DECRYPTOR_SOURCE_BASE64;
  }
  const attempts = [];
  for (const candidate of backendBundleCandidates(input)) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      const sourceBase64 = extractDecryptorSourceBase64(text);
      attempts.push({ path: candidate, status: sourceBase64 ? 'found' : 'not-found' });
      if (sourceBase64) {
        diagnostics.decryptorSource = candidate;
        diagnostics.decryptorSourceAttempts = attempts;
        return sourceBase64;
      }
    } catch (error) {
      attempts.push({ path: candidate, status: 'failed', error: compactText(error.message || error) });
    }
  }
  diagnostics.decryptorSourceAttempts = attempts;
  return '';
}

function stableDecryptedDbPath(dbPath) {
  const key = sha256Hex(`${dbPath}|${safeStatFingerprint(dbPath)}`).slice(0, 32);
  return path.join(DECRYPTED_DB_ROOT, `contact-${key}.db`);
}

function safeStatFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}|${Number(stat.mtimeMs) || 0}`;
  } catch {
    return '';
  }
}

function writePowerShellScript(script) {
  const scriptPath = path.join(
    os.tmpdir(),
    `kaypal-wechat-db-decrypt-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
  );
  const body = Buffer.from(String(script || ''), 'utf16le');
  fs.writeFileSync(scriptPath, Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
  return scriptPath;
}

function runPowerShellScript(script, timeout) {
  const scriptPath = writePowerShellScript(script);
  try {
    return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    try {
      fs.rmSync(scriptPath, { force: true });
    } catch {
      // Best effort temp cleanup.
    }
  }
}

function decryptWithMemoryKey(dbPath, input, diagnostics, originalDbPath = dbPath) {
  const attempts = diagnostics.decryptAttempts || [];
  diagnostics.decryptAttempts = attempts;
  if (process.platform !== 'win32') {
    attempts.push({ path: originalDbPath, sourcePath: dbPath, status: 'skipped', reason: 'non-windows' });
    return null;
  }
  const sourceBase64 = resolveDecryptorSourceBase64(input, diagnostics);
  if (!sourceBase64) {
    attempts.push({ path: originalDbPath, sourcePath: dbPath, status: 'blocked', reason: 'decryptor-source-missing' });
    diagnostics.decryptionStatus = 'decryptor-missing';
    diagnostics.keyHelperStatus = 'missing';
    return null;
  }
  const outPath = stableDecryptedDbPath(originalDbPath);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  } catch {
    // Directory creation is checked by the decryptor result below.
  }
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $dbPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(dbPath)}'))
  $outPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${toBase64Utf8(outPath)}'))
  $source = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${sourceBase64}'))
  Add-Type -TypeDefinition $source -Language CSharp
  if (Test-Path -LiteralPath $outPath) { Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue }
  $key = [KaypalWechatDbDecryptor]::DecryptWithMemoryKey($dbPath, $outPath)
  $keyFound = -not [string]::IsNullOrWhiteSpace($key)
  $keyFingerprint = ''
  if ($keyFound) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $keyFingerprint = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') })
      if ($keyFingerprint.Length -gt 16) { $keyFingerprint = $keyFingerprint.Substring(0, 16) }
    } finally {
      $sha.Dispose()
    }
  }
  $exists = Test-Path -LiteralPath $outPath
  $bytes = if ($exists) { (Get-Item -LiteralPath $outPath).Length } else { 0 }
  [ordered]@{
    ok = ($keyFound -and $exists -and $bytes -gt 0)
    keyFound = $keyFound
    keyFingerprint = $keyFingerprint
    outputPath = $outPath
    outputBytes = $bytes
    decryptor = 'KaypalWechatDbDecryptor'
  } | ConvertTo-Json -Compress
} catch {
  [ordered]@{
    ok = $false
    error = $_.Exception.Message
    errorType = $_.Exception.GetType().FullName
    decryptor = 'KaypalWechatDbDecryptor'
  } | ConvertTo-Json -Compress
  exit 3
}
`;
  const result = runPowerShellScript(script, 180000);
  const jsonLine = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .pop();
  const parsed = jsonLine ? safeJsonParse(jsonLine) : {};
  const attempt = {
    path: originalDbPath,
    sourcePath: dbPath,
    status: parsed.ok && isPlainSqliteDatabase(outPath) ? 'decrypted' : 'failed',
    exitCode: result.status,
    keyFound: Boolean(parsed.keyFound),
    keyFingerprint: parsed.keyFingerprint || '',
    outputPath: parsed.outputPath || outPath,
    outputBytes: Number(parsed.outputBytes) || 0,
    error: compactText(parsed.error || parsed.parseError || result.stderr || result.stdout || result.error?.message || ''),
  };
  attempts.push(attempt);
  if (attempt.status === 'decrypted') {
    diagnostics.decryptionStatus = 'completed';
    diagnostics.keyHelperStatus = 'memory-key-found';
    diagnostics.dbKeyStatus = 'decrypted-with-memory-key';
    diagnostics.decryptedDbPaths = uniquePaths([...(diagnostics.decryptedDbPaths || []), outPath]);
    return { path: outPath, source: 'windows-wechat-db-decrypted', attempt };
  }
  diagnostics.decryptionStatus = diagnostics.decryptionStatus || 'failed';
  diagnostics.keyHelperStatus = attempt.keyFound ? 'memory-key-found' : 'memory-key-missing';
  return null;
}

function findFilesLimited(root, names, maxDepth = MAX_SCAN_DEPTH, maxCount = MAX_SCAN_FILES) {
  const found = [];
  if (!root || !pathExists(root)) return found;
  const wanted = new Set(names.map((item) => item.toLowerCase()));
  const queue = [{ dir: path.resolve(root), depth: 0 }];
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
        found.push(full);
        if (found.length >= maxCount) break;
      }
    }
  }
  return found;
}

function dbPathCandidates(input = {}) {
  const explicit = []
    .concat(allArgValues(['--db', '--db-path']))
    .concat(Array.isArray(input.dbPaths) ? input.dbPaths : [])
    .concat(input.dbPath ? [input.dbPath] : [])
    .concat(process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH ? [process.env.AI_CONTENT_WECHAT_CONTACT_DB_PATH] : []);
  const fromRoots = [];
  const roots = []
    .concat(Array.isArray(input.roots) ? input.roots : [])
    .concat(input.root ? [input.root] : [])
    .concat(process.env.AI_CONTENT_WECHAT_CONTACT_DB_DIR ? [process.env.AI_CONTENT_WECHAT_CONTACT_DB_DIR] : []);
  for (const root of roots) {
    fromRoots.push(...findFilesLimited(root, ['contact.db', 'Contact.db', 'MicroMsg.db', 'MSG.db']));
  }
  return uniquePaths(explicit.concat(fromRoots)).filter(pathExists);
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

function normalizeContactText(value) {
  const text = compactText(value);
  const compact = text.replace(/\s+/g, '');
  if (!compact || compact.length < 2 || compact.length > 80) return '';
  if (/^(WeChat|Weixin|Contacts|Friends|OfficialAccounts|FileTransfer|Settings|Search)$/i.test(compact)) return '';
  if (/^[\d\s:.,/\\-]+$/.test(compact)) return '';
  if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(compact)) return '';
  return text;
}

function addContact(items, wxid, nickname, remark, alias, tags = [], source = 'wechat-native-db-helper') {
  if (isSystemContactId(wxid)) return;
  const cleanWxid = compactText(wxid);
  const cleanNickname = normalizeContactText(nickname);
  const cleanRemark = normalizeContactText(remark);
  const cleanAlias = normalizeContactText(alias);
  if (!cleanWxid && !cleanNickname && !cleanRemark && !cleanAlias) return;
  const key = [cleanWxid, cleanNickname, cleanRemark, cleanAlias]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
  if (!key || items.some((item) => item._key === key)) return;
  items.push({
    _key: key,
    wxid: cleanWxid || cleanAlias || cleanNickname || cleanRemark,
    nickname: cleanNickname || cleanRemark || cleanAlias || cleanWxid,
    remark: cleanRemark,
    alias: cleanAlias,
    tags: Array.isArray(tags) ? tags.map(compactText).filter(Boolean).slice(0, 30) : [],
    source,
  });
}

function stripPrivateKeys(items) {
  return items.map(({ _key, ...item }) => item);
}

function prepareReadTarget(dbPath, diagnostics) {
  const ext = path.extname(dbPath) || '.db';
  const snapshotPath = path.join(
    os.tmpdir(),
    `kaypal-wechat-db-helper-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
  try {
    fs.copyFileSync(dbPath, snapshotPath);
    diagnostics.dbSnapshotPaths.push(snapshotPath);
    return { queryPath: snapshotPath, snapshotPath };
  } catch (error) {
    diagnostics.dbCopyErrors.push({
      path: dbPath,
      error: compactText(error.message || error),
    });
    return { queryPath: dbPath, snapshotPath: '' };
  }
}

function cleanupReadTarget(target) {
  if (!target || !target.snapshotPath) return;
  try {
    fs.rmSync(target.snapshotPath, { force: true });
  } catch {
    // Best effort temp cleanup.
  }
}

function classifySqliteFailure(text) {
  const message = compactText(text);
  if (/database is locked|locked/i.test(message)) {
    return {
      status: 'blocked',
      dbStatus: 'encrypted-or-locked',
      dbKeyStatus: 'encrypted-or-locked',
      reason: 'database-locked',
    };
  }
  if (/file is not a database|encrypted|malformed|not an error|unsupported file format|cipher|hmac|bad decrypt/i.test(message)) {
    return {
      status: 'blocked',
      dbStatus: 'encrypted-or-locked',
      dbKeyStatus: 'encrypted-or-locked',
      reason: 'encrypted-or-key-missing',
    };
  }
  if (/permission denied|access is denied|eperm|eacces/i.test(message)) {
    return {
      status: 'blocked',
      dbStatus: 'locked-or-permission-denied',
      dbKeyStatus: 'unknown',
      reason: 'permission-denied',
    };
  }
  if (/no such table|no such column/i.test(message)) {
    return {
      status: 'schema-mismatch',
      dbStatus: 'plaintext-readable',
      dbKeyStatus: 'plaintext-readable',
      reason: 'contact-schema-not-found',
    };
  }
  return {
    status: 'failed',
    dbStatus: 'query-failed',
    dbKeyStatus: 'unknown',
    reason: 'sqlite-query-failed',
  };
}

function queryContacts(sqlitePath, dbPaths, mode, limits, input = {}) {
  const items = [];
  const limit = mode === 'all' ? limits.allLimit : limits.randomLimit;
  const order = mode === 'all' ? '' : ' ORDER BY RANDOM()';
  const queries = [
    `SELECT user_name, nick_name, remark, alias FROM user_info WHERE user_name IS NOT NULL AND user_name NOT LIKE '%@chatroom' AND user_name NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
    `SELECT username, nick_name, remark, alias FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND COALESCE(delete_flag, 0) = 0${order} LIMIT ${limit};`,
    `SELECT username, nickname, remark, alias FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
    `SELECT UserName, NickName, Remark, Alias FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
    `SELECT UserName, NickName, Remark, Alias FROM rcontact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%'${order} LIMIT ${limit};`,
  ];
  const diagnostics = {
    stage: 'contacts-query',
    sqlitePath,
    dbPaths,
    dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
    dbKeyStatus: 'unknown',
    dbQueryAttempts: 0,
    dbContactCount: 0,
    dbErrors: [],
    dbCopyErrors: [],
    dbSnapshotPaths: [],
    decryptedDbPaths: [],
    decryptAttempts: [],
    decryptionStatus: process.platform === 'win32' ? 'available' : 'unsupported-platform',
    keyHelperStatus: process.platform === 'win32' ? 'available-memory-scan' : 'unsupported-platform',
    resultSource: '',
    blockedReasons: [],
    warnings: [],
  };

  let sawPlaintext = false;
  let sawBlocked = false;

  for (const dbPath of dbPaths) {
    let candidatePath = dbPath;
    let candidateSource = 'wechat-native-db-helper';
    if (!isPlainSqliteDatabase(dbPath)) {
      sawBlocked = true;
      diagnostics.dbStatus = 'encrypted-or-locked';
      diagnostics.dbKeyStatus = 'encrypted-or-locked';
      diagnostics.blockedReasons.push('encrypted-or-key-missing');
      const encryptedTarget = prepareReadTarget(dbPath, diagnostics);
      try {
        const decrypted = decryptWithMemoryKey(encryptedTarget.queryPath, input, diagnostics, dbPath);
        if (decrypted && decrypted.path) {
          candidatePath = decrypted.path;
          candidateSource = decrypted.source;
          sawPlaintext = true;
        }
      } finally {
        cleanupReadTarget(encryptedTarget);
      }
    }
    const target = prepareReadTarget(candidatePath, diagnostics);
    try {
      for (const query of queries) {
        diagnostics.dbQueryAttempts++;
        const result = run(sqlitePath, ['-batch', '-noheader', '-separator', '\t', target.queryPath, query], {
          timeout: mode === 'all' ? 90000 : 30000,
        });
        if (result.status !== 0) {
          const errorText = compactText((result.error && result.error.message) || result.stderr || result.stdout || `sqlite exit ${result.status}`);
          const classification = classifySqliteFailure(errorText);
          if (classification.status === 'blocked') sawBlocked = true;
          if (classification.dbKeyStatus === 'plaintext-readable') sawPlaintext = true;
          diagnostics.dbStatus = classification.dbStatus;
          diagnostics.dbKeyStatus = classification.dbKeyStatus;
          diagnostics.dbErrors.push({
            path: dbPath,
            status: classification.status,
            reason: classification.reason,
            error: errorText,
          });
          if (classification.status === 'blocked') {
            diagnostics.blockedReasons.push(classification.reason);
            break;
          }
          continue;
        }

        sawPlaintext = true;
        diagnostics.resultSource = candidateSource;
        diagnostics.dbStatus = candidateSource === 'windows-wechat-db-decrypted' ? 'decrypted-readable' : 'plaintext-readable';
        diagnostics.dbKeyStatus = candidateSource === 'windows-wechat-db-decrypted' ? 'decrypted-with-memory-key' : 'plaintext-readable';
        for (const line of String(result.stdout || '').split(/\r?\n/)) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          addContact(items, parts[0], parts[1], parts[2], parts[3], [], candidateSource);
        }
        if (items.length) {
          diagnostics.dbContactCount = items.length;
          diagnostics.dbStatus = 'completed';
          return { items: stripPrivateKeys(items), diagnostics };
        }
      }
    } finally {
      cleanupReadTarget(target);
    }
  }

  diagnostics.dbContactCount = items.length;
  if (sawPlaintext && diagnostics.dbKeyStatus === 'decrypted-with-memory-key') {
    diagnostics.dbStatus = 'completed-empty';
    diagnostics.resultSource = diagnostics.resultSource || 'windows-wechat-db-decrypted';
  } else if (sawPlaintext) {
    diagnostics.dbStatus = 'completed-empty';
    diagnostics.dbKeyStatus = 'plaintext-readable';
    diagnostics.resultSource = diagnostics.resultSource || 'wechat-native-db-helper';
  } else if (sawBlocked) {
    diagnostics.dbStatus = 'encrypted-or-locked';
    diagnostics.dbKeyStatus = 'encrypted-or-locked';
  }
  diagnostics.blockedReasons = Array.from(new Set(diagnostics.blockedReasons));
  return { items: stripPrivateKeys(items), diagnostics };
}

function displayContacts(items) {
  return items
    .map((item) => item.remark || item.nickname || item.alias || item.wxid)
    .map(compactText)
    .filter(Boolean);
}

function contractPayload() {
  return {
    ok: true,
    source: HELPER_NAME,
    status: 'ready',
    capabilities: [
      'json-stdin-stdout',
      'plaintext-sqlite-contact-db',
      'encrypted-db-block-detection',
      'locked-db-block-detection',
      'process-memory-key-scan',
      'sqlcipher-page-decryption',
      'windows-wechat-db-decrypted',
      'key-fingerprint-only-diagnostics',
    ],
    unsupported: [
      'native-wechat-api',
      'key-logging',
    ],
    commands: {
      contract: 'node wechat-db-helper.js contract',
      diagnose: `node wechat-db-helper.js diagnose --contract ${CONTRACT_VERSION}`,
      contacts: `node wechat-db-helper.js contacts --contract ${CONTRACT_VERSION} --mode random|all`,
    },
    stdin: {
      contacts: {
        contractVersion: CONTRACT_VERSION,
        mode: 'random|all',
        dbPaths: 'string[] plaintext SQLite contact DB candidates',
        roots: 'optional string[] roots to scan for contact DB candidates',
        limits: '{ randomLimit, allLimit }',
      },
    },
    stdout: {
      success: {
        ok: true,
        status: 'completed|completed-empty',
        source: 'wechat-native-db-helper',
        contacts: 'string[] display names',
        items: 'Array<{ wxid, nickname, remark, alias, tags, source }>',
        diagnostics: '{ dbStatus, dbKeyStatus, sqlitePath, warnings }',
      },
      blocked: {
        ok: false,
        status: 'blocked',
        blocked: true,
        error: 'helper could not decrypt encrypted/locked/key-missing DB',
        diagnostics: '{ dbStatus, dbKeyStatus, blockedReasons }',
      },
    },
  };
}

function validateContractArg(command) {
  const supplied = argValue('--contract', process.env.AI_CONTENT_WECHAT_HELPER_CONTRACT || '');
  if (!supplied && command === 'diagnose') return '';
  if (supplied === CONTRACT_VERSION) return '';
  return supplied ? `unsupported contract ${supplied}` : `missing --contract ${CONTRACT_VERSION}`;
}

function runContract() {
  emit(contractPayload());
}

function runDiagnose() {
  const inputState = readJsonStdin();
  const contractError = validateContractArg('diagnose');
  const sqlite = resolveSqlite(inputState.value);
  const dbPaths = dbPathCandidates(inputState.value);
  const diagnostics = {
    stage: 'diagnose',
    platform: process.platform,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    helperPath: __filename,
    stdinStatus: inputState.error ? 'invalid-json' : inputState.hasInput ? 'parsed' : 'empty',
    stdinError: inputState.error || '',
    sqlitePath: sqlite.path,
    sqliteStatus: sqlite.path ? 'ready' : 'missing',
    sqliteCandidates: sqlite.attempts,
    dbPaths,
    dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
    dbKeyStatus: 'unknown',
    decryptionStatus: process.platform === 'win32' ? 'available' : 'unsupported-platform',
    keyHelperStatus: process.platform === 'win32' ? 'available-memory-scan' : 'unsupported-platform',
    decryptorAvailable: Boolean(resolveDecryptorSourceBase64(inputState.value, {})),
    warnings: process.platform === 'win32' ? [] : ['SQLCipher memory-key decrypt is only available on Windows'],
  };
  if (contractError) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      error: contractError,
      diagnostics,
    }, 64);
  }
  emit({
    ok: true,
    status: sqlite.path ? 'ready' : 'blocked',
    source: HELPER_NAME,
    capabilities: contractPayload().capabilities,
    unsupported: contractPayload().unsupported,
    diagnostics,
  }, sqlite.path ? 0 : 2);
}

function runContacts() {
  const inputState = readJsonStdin();
  if (inputState.error) {
    emit({
      ok: false,
      status: 'failed',
      error: inputState.error,
      diagnostics: {
        stage: 'stdin-parse',
      },
    }, 65);
  }

  const contractError = validateContractArg('contacts');
  const requestedMode = argValue('--mode', inputState.value.mode || process.env.AI_CONTENT_WECHAT_CONTACT_SYNC_MODE || 'random');
  const mode = requestedMode === 'all' ? 'all' : requestedMode === 'random' ? 'random' : '';
  const inputLimits = inputState.value && typeof inputState.value.limits === 'object' ? inputState.value.limits : {};
  const limits = {
    randomLimit: Math.max(1, Math.min(Number(inputLimits.randomLimit) || DEFAULT_RANDOM_LIMIT, DEFAULT_ALL_LIMIT)),
    allLimit: Math.max(1, Math.min(Number(inputLimits.allLimit) || DEFAULT_ALL_LIMIT, DEFAULT_ALL_LIMIT)),
  };
  const sqlite = resolveSqlite(inputState.value);
  const dbPaths = dbPathCandidates(inputState.value);
  const baseDiagnostics = {
    stage: 'contacts-start',
    platform: process.platform,
    helperPath: __filename,
    stdinStatus: inputState.hasInput ? 'parsed' : 'empty',
    sqlitePath: sqlite.path,
    sqliteStatus: sqlite.path ? 'ready' : 'missing',
    sqliteCandidates: sqlite.attempts,
    dbPaths,
    limits,
    decryptionStatus: process.platform === 'win32' ? 'available' : 'unsupported-platform',
    keyHelperStatus: process.platform === 'win32' ? 'available-memory-scan' : 'unsupported-platform',
    warnings: process.platform === 'win32' ? [] : ['SQLCipher memory-key decrypt is only available on Windows'],
  };

  if (contractError) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode: requestedMode || '',
      error: contractError,
      diagnostics: baseDiagnostics,
    }, 64);
  }
  if (!mode) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode: requestedMode || '',
      error: 'mode must be random or all',
      diagnostics: baseDiagnostics,
    }, 64);
  }
  if (!sqlite.path) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode,
      error: 'sqlite3 executable not found',
      diagnostics: {
        ...baseDiagnostics,
        stage: 'contacts-sqlite-missing',
        dbStatus: dbPaths.length ? 'candidate-found' : 'not-found',
        dbKeyStatus: 'unknown',
      },
    }, 2);
  }
  if (!dbPaths.length) {
    emit({
      ok: false,
      status: 'blocked',
      blocked: true,
      mode,
      error: 'wechat contact database not found',
      diagnostics: {
        ...baseDiagnostics,
        stage: 'contacts-db-missing',
        dbStatus: 'not-found',
        dbKeyStatus: 'unknown',
      },
    }, 2);
  }

  const result = queryContacts(sqlite.path, dbPaths, mode, limits, inputState.value);
  const diagnostics = {
    ...baseDiagnostics,
    ...result.diagnostics,
    warnings: Array.from(new Set([...(baseDiagnostics.warnings || []), ...((result.diagnostics && result.diagnostics.warnings) || [])])),
  };
  if (result.items.length || diagnostics.dbKeyStatus === 'plaintext-readable' || diagnostics.dbKeyStatus === 'decrypted-with-memory-key') {
    const status = result.items.length ? 'completed' : 'completed-empty';
    const source = diagnostics.resultSource || (diagnostics.dbKeyStatus === 'decrypted-with-memory-key'
      ? 'windows-wechat-db-decrypted'
      : 'wechat-native-db-helper');
    emit({
      ok: true,
      status,
      source,
      mode,
      contacts: displayContacts(result.items),
      items: result.items,
      count: result.items.length,
      syncedAt: new Date().toISOString(),
      diagnostics: {
        ...diagnostics,
        stage: status,
        dbStatus: status,
        dbContactCount: result.items.length,
      },
    });
  }

  emit({
    ok: false,
    status: 'blocked',
    blocked: true,
    source: 'wechat-native-db-helper',
    mode,
    error: 'wechat contact database is encrypted, locked, or missing a readable key; helper could not decrypt it',
    diagnostics: {
      ...diagnostics,
      stage: 'contacts-blocked',
      dbStatus: diagnostics.dbStatus || 'encrypted-or-locked',
      dbKeyStatus: diagnostics.dbKeyStatus || 'encrypted-or-locked',
      blockedReasons: diagnostics.blockedReasons && diagnostics.blockedReasons.length
        ? diagnostics.blockedReasons
        : ['encrypted-or-locked-or-key-missing'],
    },
  }, 3);
}

const command = process.argv[2] || 'contract';
if (command === 'contract' || command === 'helper-contract') {
  runContract();
} else if (command === 'diagnose') {
  runDiagnose();
} else if (command === 'contacts') {
  runContacts();
} else {
  emit({
    ok: false,
    status: 'failed',
    error: `unknown command: ${compactText(command)}`,
    diagnostics: {
      stage: 'argv',
      supportedCommands: ['contract', 'diagnose', 'contacts'],
    },
  }, 64);
}
