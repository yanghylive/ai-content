const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COMMON_SQLITE_SCHEMA_MARKERS = [
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

const AGENT_S_MOCK_MARKERS = [
  /runner_mode:\s*['"]mock['"]/,
  /browserControl:\s*false/,
  /mock-compatible/,
  /browserExecution:\s*false/,
  /Phase 1 mock-compatible runtime/,
];

function createGuardContext() {
  const failures = [];
  return {
    failures,
    fail(message) {
      failures.push(message);
    },
    ok() {
      return failures.length === 0;
    },
  };
}

function rel(root, filePath) {
  return path.relative(root, filePath) || '.';
}

function fileExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function dirExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}

function nodeRuntimePathForPlatform(resourcesRoot, platform) {
  return path.join(
    resourcesRoot,
    'runtime',
    'node',
    'bin',
    platform === 'win-x64' ? 'node.exe' : 'node',
  );
}

function chromiumExecutableNamesForPlatform(platform) {
  if (platform === 'win-x64') return ['chrome.exe'];
  if (platform === 'linux-x64') return ['chrome'];
  return ['Google Chrome for Testing'];
}

function findBundledChromiumExecutable(root, platform) {
  if (!dirExists(root)) return null;
  const names = new Set(chromiumExecutableNamesForPlatform(platform));
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (names.has(entry.name) && /chromium|chrome-(win|mac|linux)|Chrome for Testing/i.test(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function readFileText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readSqliteBytes(filePath, maxBytes = 32 * 1024 * 1024) {
  if (!fileExists(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size < 1024) return null;
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, 0);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function sqliteSeedLooksValid(filePath, markers = COMMON_SQLITE_SCHEMA_MARKERS) {
  const buffer = readSqliteBytes(filePath);
  if (!buffer) return false;
  if (!buffer.subarray(0, 16).toString('ascii').startsWith('SQLite format 3')) return false;
  const content = buffer.toString('latin1');
  return markers.every((marker) => content.includes(marker));
}

function sqliteSeedContainsLoggedInUser(filePath) {
  const buffer = readSqliteBytes(filePath);
  if (!buffer) return false;
  const content = buffer.toString('latin1');
  return /ai_content_session|kaypal_desktop_session/i.test(content);
}

function readSqliteVarint(buffer, offset) {
  let value = 0n;
  for (let i = 0; i < 9; i += 1) {
    if (offset + i >= buffer.length) {
      throw new Error('SQLite varint out of bounds');
    }
    const byte = buffer[offset + i];
    if (i === 8) {
      value = (value << 8n) | BigInt(byte);
      return { value: Number(value), bytes: 9 };
    }
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value: Number(value), bytes: i + 1 };
    }
  }
  throw new Error('Invalid SQLite varint');
}

function readSqliteSignedInteger(buffer, offset, bytes) {
  let value = 0n;
  for (let i = 0; i < bytes; i += 1) {
    value = (value << 8n) | BigInt(buffer[offset + i] || 0);
  }
  const bits = BigInt(bytes * 8);
  const signBit = 1n << (bits - 1n);
  if ((value & signBit) !== 0n) {
    value -= 1n << bits;
  }
  return Number(value);
}

function sqliteSerialTypeSize(serialType) {
  if (serialType === 0 || serialType === 8 || serialType === 9) return 0;
  if (serialType === 1) return 1;
  if (serialType === 2) return 2;
  if (serialType === 3) return 3;
  if (serialType === 4) return 4;
  if (serialType === 5) return 6;
  if (serialType === 6 || serialType === 7) return 8;
  if (serialType >= 12) return Math.floor((serialType - 12) / 2);
  throw new Error(`Unsupported SQLite serial type ${serialType}`);
}

function decodeSqliteRecord(buffer, payloadOffset, payloadLength) {
  const payloadEnd = payloadOffset + payloadLength;
  const headerSizeVarint = readSqliteVarint(buffer, payloadOffset);
  const headerEnd = payloadOffset + headerSizeVarint.value;
  let cursor = payloadOffset + headerSizeVarint.bytes;
  const serialTypes = [];

  while (cursor < headerEnd) {
    const serialType = readSqliteVarint(buffer, cursor);
    serialTypes.push(serialType.value);
    cursor += serialType.bytes;
  }

  cursor = headerEnd;
  return serialTypes.map((serialType) => {
    const size = sqliteSerialTypeSize(serialType);
    if (cursor + size > payloadEnd) {
      throw new Error('SQLite record payload out of bounds');
    }
    let value = null;
    if (serialType === 0) {
      value = null;
    } else if (serialType >= 1 && serialType <= 6) {
      value = readSqliteSignedInteger(buffer, cursor, size);
    } else if (serialType === 7) {
      value = buffer.readDoubleBE(cursor);
    } else if (serialType === 8) {
      value = 0;
    } else if (serialType === 9) {
      value = 1;
    } else if (serialType >= 13 && serialType % 2 === 1) {
      value = buffer.subarray(cursor, cursor + size).toString('utf8');
    } else if (serialType >= 12 && serialType % 2 === 0) {
      value = buffer.subarray(cursor, cursor + size);
    }
    cursor += size;
    return value;
  });
}

function sqlitePageOffset(pageSize, pageNo) {
  return (pageNo - 1) * pageSize;
}

function readSqlitePageHeader(buffer, pageSize, pageNo) {
  const pageOffset = sqlitePageOffset(pageSize, pageNo);
  const headerOffset = pageOffset + (pageNo === 1 ? 100 : 0);
  if (headerOffset + 8 > buffer.length) {
    throw new Error(`SQLite page ${pageNo} header out of bounds`);
  }
  const pageType = buffer[headerOffset];
  const cellCount = buffer.readUInt16BE(headerOffset + 3);
  const headerSize = pageType === 0x05 || pageType === 0x02 ? 12 : 8;
  const rightMostPointer =
    pageType === 0x05 || pageType === 0x02
      ? buffer.readUInt32BE(headerOffset + 8)
      : null;
  return {
    pageOffset,
    headerOffset,
    pageType,
    cellCount,
    headerSize,
    rightMostPointer,
  };
}

function sqliteCellPointers(buffer, pageHeader) {
  const pointers = [];
  for (let i = 0; i < pageHeader.cellCount; i += 1) {
    const pointerOffset = pageHeader.headerOffset + pageHeader.headerSize + i * 2;
    pointers.push(pageHeader.pageOffset + buffer.readUInt16BE(pointerOffset));
  }
  return pointers;
}

function countSqliteTableRows(buffer, pageSize, rootPage, seen = new Set()) {
  if (!rootPage || seen.has(rootPage)) return null;
  seen.add(rootPage);
  const pageHeader = readSqlitePageHeader(buffer, pageSize, rootPage);

  if (pageHeader.pageType === 0x0d) {
    return pageHeader.cellCount;
  }

  if (pageHeader.pageType !== 0x05) {
    return null;
  }

  let total = 0;
  for (const cellOffset of sqliteCellPointers(buffer, pageHeader)) {
    const childPage = buffer.readUInt32BE(cellOffset);
    const childCount = countSqliteTableRows(buffer, pageSize, childPage, seen);
    if (childCount === null) return null;
    total += childCount;
  }
  const rightCount = countSqliteTableRows(buffer, pageSize, pageHeader.rightMostPointer, seen);
  if (rightCount === null) return null;
  return total + rightCount;
}

function sqliteSchemaTableRootPages(buffer, pageSize, pageNo = 1, seen = new Set()) {
  if (seen.has(pageNo)) return new Map();
  seen.add(pageNo);
  const pageHeader = readSqlitePageHeader(buffer, pageSize, pageNo);
  const tables = new Map();

  if (pageHeader.pageType === 0x0d) {
    for (const cellOffset of sqliteCellPointers(buffer, pageHeader)) {
      const payloadLength = readSqliteVarint(buffer, cellOffset);
      const rowId = readSqliteVarint(buffer, cellOffset + payloadLength.bytes);
      const payloadOffset = cellOffset + payloadLength.bytes + rowId.bytes;
      const record = decodeSqliteRecord(buffer, payloadOffset, payloadLength.value);
      const [type, name, , rootPage] = record;
      if (type === 'table' && typeof name === 'string' && Number.isFinite(rootPage)) {
        tables.set(name, rootPage);
      }
    }
    return tables;
  }

  if (pageHeader.pageType !== 0x05) {
    return tables;
  }

  for (const cellOffset of sqliteCellPointers(buffer, pageHeader)) {
    const childPage = buffer.readUInt32BE(cellOffset);
    for (const [name, rootPage] of sqliteSchemaTableRootPages(buffer, pageSize, childPage, seen)) {
      tables.set(name, rootPage);
    }
  }
  for (const [name, rootPage] of sqliteSchemaTableRootPages(buffer, pageSize, pageHeader.rightMostPointer, seen)) {
    tables.set(name, rootPage);
  }
  return tables;
}

function sqliteTableCount(filePath, tableName) {
  if (!fileExists(filePath)) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    if (!buffer.subarray(0, 16).toString('ascii').startsWith('SQLite format 3')) {
      return null;
    }
    const rawPageSize = buffer.readUInt16BE(16);
    const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
    const rootPages = sqliteSchemaTableRootPages(buffer, pageSize);
    const rootPage = rootPages.get(tableName);
    if (!rootPage) return null;
    return countSqliteTableRows(buffer, pageSize, rootPage);
  } catch {
    return null;
  }
}

function sqliteSeedContainsPackagedUserData(filePath) {
  const tables = [
    ['users', 'Kaypal users'],
    ['user_sessions', 'Kaypal user sessions'],
    ['publish_accounts', 'platform task accounts'],
  ];
  const nonEmpty = [];
  for (const [tableName, label] of tables) {
    const count = sqliteTableCount(filePath, tableName);
    if (count === null || count > 0) {
      nonEmpty.push(`${label}${count === null ? '' : `=${count}`}`);
    }
  }
  return nonEmpty;
}

function assertNoLegacyPythonRequirements(ctx, root, label = root) {
  const forbidden = [
    'agent-s-executor',
    path.join('installer', 'wheelhouse'),
    'auto-upload',
    'python',
    path.join('runtime', 'python'),
  ];
  for (const entry of forbidden) {
    const full = path.join(root, entry);
    if (fs.existsSync(full)) {
      ctx.fail(`${label} must not package legacy Python dependency: ${entry}`);
    }
  }
}

function assertNodeRuntimeLayout(ctx, root, platform, label = root) {
  const nodePath = nodeRuntimePathForPlatform(root, platform);
  if (!fileExists(nodePath)) {
    ctx.fail(`${label} missing bundled Node runtime: ${rel(root, nodePath)}`);
  }
  const legacyWindowsPath = path.join(root, 'runtime', 'node', 'node.exe');
  if (platform === 'win-x64' && fileExists(legacyWindowsPath)) {
    ctx.fail(`${label} contains stale Windows Node path; use runtime/node/bin/node.exe`);
  }
  return nodePath;
}

function assertBundledNodeExecutable(ctx, nodePath, platform) {
  if (!fileExists(nodePath)) return;
  // macOS 交叉构建 win-x64 包：win 的 node.exe 是 PE 格式，无法在本机执行，跳过执行验证（文件存在即可）
  if (platform === 'win-x64' && process.platform !== 'win32') {
    return;
  }
  const result = spawnSync(nodePath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  });
  if (result.error || result.status !== 0 || !/^v20\./.test((result.stdout || '').trim())) {
    ctx.fail(`bundled Node runtime is not executable or not v20: ${nodePath}`);
  }
}

function assertPlaywrightAssets(ctx, root, platform, label = root) {
  const required = [
    path.join('backend', 'node_modules', '@playwright', 'mcp', 'cli.js'),
    path.join('backend', 'node_modules', '@playwright', 'mcp', 'node_modules'),
    path.join('backend', 'node_modules', 'playwright', 'package.json'),
    path.join('backend', 'node_modules', 'playwright-core', 'package.json'),
  ];
  for (const entry of required) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) {
      ctx.fail(`${label} missing Playwright/MCP asset: ${entry}`);
    }
  }
  const browsersRoot = path.join(root, 'playwright-browsers');
  const chromium = findBundledChromiumExecutable(browsersRoot, platform);
  if (!chromium) {
    ctx.fail(`${label} missing bundled Playwright Chromium executable under playwright-browsers`);
  }
  return chromium;
}

function assertBackendBundleUsesPackagedBrowser(ctx, bundlePath, label = bundlePath) {
  const content = readFileText(bundlePath);
  if (!content) {
    ctx.fail(`${label} missing backend bundle`);
    return;
  }
  if (!/PlaywrightBrowserRuntimeService/.test(content) || !/executablePath/.test(content)) {
    ctx.fail(`${label} must resolve PlaywrightBrowserRuntimeService with explicit executablePath`);
  }
  if (/chromium_headless_shell|chrome-headless-shell/.test(content)) {
    ctx.fail(`${label} must not reference Playwright headless shell`);
  }
  if (/chromium\.launch\(\{\s*headless:\s*true\s*\}\)/.test(content)) {
    ctx.fail(`${label} must not use chromium.launch({ headless: true }) without executablePath`);
  }
}

function assertAgentSNotMockInBundle(ctx, bundlePath, label = bundlePath, options = {}) {
  const content = readFileText(bundlePath);
  if (!content) {
    ctx.fail(`${label} missing backend bundle for Agent-S release guard`);
    return;
  }
  const markers = AGENT_S_MOCK_MARKERS.filter((pattern) => pattern.test(content));
  if (markers.length > 0) {
    ctx.fail(
      `${label} blocks release: /api/agent-s/health bundle still exposes mock Agent-S or browserControl=false (${markers.map(String).join(', ')})`,
    );
  }
  if (!/runner_mode:\s*['"]node-playwright['"]|runner_mode["']?\s*:\s*["']real["']/.test(content)) {
    ctx.fail(`${label} blocks release: Agent-S health must expose a non-mock runner_mode`);
  }
  if (!/browserControl:\s*true/.test(content)) {
    ctx.fail(`${label} blocks release: Agent-S health must expose capabilities.browserControl=true`);
  }
  if (options.requireEvidence !== false && !/evidenceStore:\s*true/.test(content)) {
    ctx.fail(`${label} blocks release: Agent-S health must expose evidenceStore=true`);
  }
}

function assertSqliteSeed(ctx, seedPath, label = seedPath) {
  if (!sqliteSeedLooksValid(seedPath)) {
    ctx.fail(`${label} missing SQLite header or required schema markers`);
  }
  if (sqliteSeedContainsLoggedInUser(seedPath)) {
    ctx.fail(`${label} appears to contain logged-in session/user tokens; seed must be clean`);
  }
  const packagedUserData = sqliteSeedContainsPackagedUserData(seedPath);
  if (packagedUserData.length > 0) {
    ctx.fail(`${label} contains packaged user/platform account data: ${packagedUserData.join(', ')}`);
  }
}

function assertMainRuntimePolicy(ctx, mainPath) {
  const content = readFileText(mainPath);
  if (!content) {
    ctx.fail(`desktop main missing: ${mainPath}`);
    return;
  }
  if (!/runtime['"], ['"]node['"], ['"]bin['"], ['"]node\.exe/.test(content)) {
    ctx.fail('desktop/main.js must look for Windows Node at runtime/node/bin/node.exe');
  }
  if (/runtime['"], ['"]node['"], ['"]node\.exe/.test(content)) {
    ctx.fail('desktop/main.js still looks for stale Windows Node path runtime/node/node.exe');
  }
  if (/falling back to Electron as Node|return process\.execPath;/.test(content)) {
    ctx.fail('packaged desktop must not fall back to Electron/system Node when bundled Node is missing');
  }
  if (/app\.isPackaged[\s\S]{0,220}startAgentSService[\s\S]{0,220}agent-s-executor/.test(content)) {
    ctx.fail('packaged desktop must not start legacy Python Agent-S sidecar');
  }
  if (!/PLAYWRIGHT_MCP_CLI_PATH/.test(content)) {
    ctx.fail('desktop/main.js must inject packaged @playwright/mcp cli path into backend env');
  }
  if (!/autoHideMenuBar:\s*true/.test(content)) {
    ctx.fail('desktop/main.js must hide the default Windows/Linux menu bar with autoHideMenuBar');
  }
  if (!/Menu\.setApplicationMenu\(null\)/.test(content)) {
    ctx.fail('desktop/main.js must remove the default Windows/Linux application menu');
  }
  if (!/createWindowsPackagedBaseEnv/.test(content)) {
    ctx.fail('desktop/main.js must build a Windows packaged backend environment explicitly');
  }
  if (!/safeStorage/.test(content) || !/ensureCredentialMasterKey/.test(content)) {
    ctx.fail('desktop/main.js must initialize a device-protected credential master key');
  }
  if (!/envVars\[CREDENTIAL_MASTER_KEY_ENV\]\s*=\s*credentialKey\.value/.test(content)) {
    ctx.fail('desktop/main.js must inject the protected credential master key into the backend environment');
  }
  for (const key of ['SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'TEMP', 'TMP', 'ComSpec']) {
    if (!content.includes(key)) {
      ctx.fail(`desktop/main.js must preserve Windows env var ${key} for packaged backend startup`);
    }
  }
}

function assertBackendEnvPolicy(ctx, envPath) {
  const content = readFileText(envPath);
  const required = [
    /^DATABASE_URL=file:\.\/kaypal-ai\.sqlite/m,
    /^KAYPAL_DESKTOP_DATABASE_MODE=sqlite/m,
    /^SQLITE_DATABASE_URL=file:\.\/kaypal-ai\.sqlite/m,
    /^KAYPAL_NODE_AGENT_RUNTIME=1/m,
    /^KAYPAL_AUTH_BASE_URL=https:\/\/test\.kaypal\.cn/m,
  ];
  if (!content) {
    ctx.fail(`backend env missing: ${envPath}`);
    return;
  }
  for (const pattern of required) {
    if (!pattern.test(content)) {
      ctx.fail(`backend env missing required production setting ${pattern}`);
    }
  }
  if (/postgresql:\/\/|POSTGRES_|REDIS_URL|REDIS_HOST|REDIS_PORT/i.test(content)) {
    ctx.fail('backend.env must not require Postgres or Redis in one-click desktop package');
  }
  if (/^KAYPAL_CREDENTIAL_MASTER_KEY\s*=\s*\S+/m.test(content)) {
    ctx.fail('backend.env must not ship a shared credential master key');
  }
}

function assertSourceReleaseGuards(ctx, paths, platform) {
  const backendRoot = paths.backendRoot || path.resolve(path.dirname(paths.backendBundle), '..');
  assertMainRuntimePolicy(ctx, paths.mainJs);
  assertBackendEnvPolicy(ctx, paths.backendEnv);
  assertNodeRuntimeLayout(ctx, paths.desktopRoot, platform);
  const sourcePlaywrightRequired = [
    path.join(backendRoot, 'node_modules', '@playwright', 'mcp', 'cli.js'),
    path.join(backendRoot, 'node_modules', '@playwright', 'mcp', 'node_modules'),
    path.join(backendRoot, 'node_modules', 'playwright', 'package.json'),
    path.join(backendRoot, 'node_modules', 'playwright-core', 'package.json'),
  ];
  for (const filePath of sourcePlaywrightRequired) {
    if (!fs.existsSync(filePath)) {
      ctx.fail(`source missing Playwright/MCP asset: ${filePath}`);
    }
  }
  const chromium = findBundledChromiumExecutable(
    path.join(paths.desktopRoot, 'runtime', 'playwright-browsers'),
    platform,
  );
  if (!chromium) {
    ctx.fail('source missing bundled Playwright Chromium under desktop/runtime/playwright-browsers');
  }
  assertBackendBundleUsesPackagedBrowser(ctx, paths.backendBundle, 'backend SQLite bundle');
  assertAgentSNotMockInBundle(ctx, paths.backendBundle, 'backend SQLite bundle');
  assertSqliteSeed(ctx, paths.sqliteSeed, 'backend SQLite seed');
}

function assertPackagedReleaseGuards(ctx, resourcesRoot, platform) {
  assertNoLegacyPythonRequirements(ctx, resourcesRoot, 'packaged resources');
  const nodePath = assertNodeRuntimeLayout(ctx, resourcesRoot, platform, 'packaged resources');
  assertBundledNodeExecutable(ctx, nodePath, platform);
  assertPlaywrightAssets(ctx, resourcesRoot, platform, 'packaged resources');
  assertBackendBundleUsesPackagedBrowser(
    ctx,
    path.join(resourcesRoot, 'backend', 'index.js'),
    'packaged backend',
  );
  assertAgentSNotMockInBundle(
    ctx,
    path.join(resourcesRoot, 'backend', 'index.js'),
    'packaged backend',
  );
  assertSqliteSeed(
    ctx,
    path.join(resourcesRoot, 'backend', 'prisma', 'dev.db'),
    'packaged SQLite seed',
  );
  assertBackendEnvPolicy(ctx, path.join(resourcesRoot, 'backend', '.env'));
}

function requestJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode || 'unknown'} ${data.slice(0, 240)}`));
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch (error) {
          reject(new Error(`invalid JSON: ${error.message}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function unwrapAgentSHealth(payload) {
  if (payload?.data?.health) return payload.data.health;
  if (payload?.sidecar?.health) return payload.sidecar.health;
  return payload;
}

async function assertLiveAgentSHealth(ctx, baseUrl = 'http://127.0.0.1:3011') {
  let health;
  try {
    health = unwrapAgentSHealth(await requestJson(`${baseUrl}/api/agent-s/health`, 5000));
  } catch (error) {
    ctx.fail(`/api/agent-s/health unreachable: ${error.message}`);
    return;
  }

  const runnerMode = health?.runner_mode;
  const browserControl = health?.capabilities?.browserControl;
  if (runnerMode === 'mock') {
    ctx.fail('/api/agent-s/health blocks release: runner_mode=mock');
  }
  if (browserControl !== true) {
    ctx.fail(`/api/agent-s/health blocks release: browserControl=${browserControl}`);
  }
  if (health?.ok !== true || !['ready', 'degraded'].includes(String(health?.status))) {
    ctx.fail(`/api/agent-s/health is not ready: ${JSON.stringify(health)}`);
  }
}

async function assertLivePlaywrightMcp(ctx, baseUrl = 'http://127.0.0.1:3011') {
  let status;
  try {
    status = await requestJson(`${baseUrl}/api/mcp/status`, 5000);
  } catch (error) {
    ctx.fail(`/api/mcp/status unreachable: ${error.message}`);
    return;
  }
  const playwright = status?.data?.playwright || status?.playwright;
  if (!playwright?.childProcessRunning || !playwright?.online) {
    ctx.fail(`/api/mcp/status blocks release: Playwright MCP is not online (${JSON.stringify(playwright)})`);
  }
}

function printFailuresAndExit(ctx, title) {
  if (ctx.ok()) return;
  console.error(title);
  for (const failure of ctx.failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

module.exports = {
  COMMON_SQLITE_SCHEMA_MARKERS,
  assertAgentSNotMockInBundle,
  assertBackendBundleUsesPackagedBrowser,
  assertBackendEnvPolicy,
  assertBundledNodeExecutable,
  assertLiveAgentSHealth,
  assertLivePlaywrightMcp,
  assertMainRuntimePolicy,
  assertNoLegacyPythonRequirements,
  assertNodeRuntimeLayout,
  assertPackagedReleaseGuards,
  assertPlaywrightAssets,
  assertSourceReleaseGuards,
  assertSqliteSeed,
  createGuardContext,
  findBundledChromiumExecutable,
  nodeRuntimePathForPlatform,
  printFailuresAndExit,
  sqliteSeedContainsPackagedUserData,
  sqliteSeedContainsLoggedInUser,
  sqliteSeedLooksValid,
};
