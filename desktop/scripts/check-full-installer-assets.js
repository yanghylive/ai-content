#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  assertMainRuntimePolicy,
  assertPackagedReleaseGuards,
  assertSourceReleaseGuards,
  createGuardContext,
  nodeRuntimePathForPlatform,
  sqliteSeedContainsLoggedInUser,
} = require('./release-guards');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='));
const phase = phaseArg ? phaseArg.split('=')[1] : 'post';
const platformArg = process.argv.find((arg) => arg.startsWith('--platform=') || arg.startsWith('--target='));
const cliPlatform = platformArg ? platformArg.split('=')[1] : null;
const detectedPlatform =
  process.platform === 'darwin' && process.arch === 'arm64'
    ? 'mac-arm64'
    : process.platform === 'darwin'
      ? 'mac-x64'
      : process.platform === 'win32'
        ? 'win-x64'
        : 'linux-x64';
const buildPlatform = cliPlatform || process.env.BUILD_PLATFORM || detectedPlatform;

// v1.1.105（复核 P1-1）：--installer=<exe|zip> 时**只**检查指定安装包（7z 解包
// 真实 NSIS exe / 解压 mac zip），禁止回退中间目录——中间目录（win-unpacked /
// mac-arm64 目录）与最终安装包可能不一致（8/30 曾用 mac runtime 打出
// win-unpacked+exe 双坏包且检查通过）。
const installerArg = process.argv.find((arg) => arg.startsWith('--installer='));
const cliInstaller = installerArg ? installerArg.split('=')[1] : null;

function distResourcesRootForPlatform(platform) {
  switch (platform) {
    case 'mac-arm64':
      return path.join(desktopRoot, 'dist', 'mac-arm64', 'JIUZHANG AI 内容创作平台.app', 'Contents', 'Resources');
    case 'mac-x64':
      return path.join(desktopRoot, 'dist', 'mac', 'JIUZHANG AI 内容创作平台.app', 'Contents', 'Resources');
    case 'linux-x64':
      return path.join(desktopRoot, 'dist', 'linux-unpacked', 'resources');
    case 'win-x64':
    default:
      return path.join(desktopRoot, 'dist', 'win-unpacked', 'resources');
  }
}

// --installer 解包：win NSIS 用 7z 抽 $PLUGINSDIR/app-64.7z；mac zip 用 unzip。
// 解包到临时目录，进程结束时清理。返回 resources 根；失败返回 null（调用方 fail）。
function resolveInstallerResources(installerPath) {
  const absPath = path.isAbsolute(installerPath)
    ? installerPath
    : path.resolve(process.cwd(), installerPath);
  if (!fs.existsSync(absPath)) {
    console.error(`- installer not found: ${absPath}`);
    return null;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfa-installer-'));
  try {
    if (/\.exe$/i.test(absPath)) {
      const { execSync, spawnSync } = require('node:child_process');
      execSync(`7z x -y -o"${tmp}" "${absPath}" >/dev/null 2>&1`);
      const plugin = path.join(tmp, '$PLUGINSDIR', 'app-64.7z');
      if (!fs.existsSync(plugin)) {
        console.error(`- installer app-64.7z not found: ${absPath}`);
        fs.rmSync(tmp, { recursive: true, force: true });
        return null;
      }
      const appOut = path.join(tmp, 'app');
      const r = spawnSync('7z', ['x', '-y', `-o${appOut}`, plugin], { encoding: 'utf8' });
      if (r.status !== 0) {
        console.error(`- 7z extract app-64.7z failed: ${r.stderr || r.stdout}`);
        fs.rmSync(tmp, { recursive: true, force: true });
        return null;
      }
      // v1.1.106（复核 P2-B）：成功路径不删 tmp——由调用方 try/finally 统一清理，
      // 否则每次 --installer 解包都在 os.tmpdir 留下完整安装包内容（曾泄漏 7 个）。
      return { resources: path.join(appOut, 'resources'), tmp };
    }
    if (/\.zip$/i.test(absPath)) {
      const { execSync } = require('node:child_process');
      const appDir = path.join(tmp, 'app');
      fs.mkdirSync(appDir, { recursive: true });
      execSync(`unzip -q -o "${absPath}" -d "${appDir}"`);
      const candidate = path.join(appDir, 'JIUZHANG AI 内容创作平台.app', 'Contents', 'Resources');
      if (fs.existsSync(candidate)) return { resources: candidate, tmp };
      console.error(`- mac zip app bundle not found: ${absPath}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      return null;
    }
    console.error(`- unsupported installer type: ${absPath}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  } catch (error) {
    console.error(`- installer extraction failed: ${error.message}`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    return null;
  }
}

let installerResourcesRoot = null;
let installerTempRoot = null;
if (cliInstaller) {
  const resolved = resolveInstallerResources(cliInstaller);
  if (!resolved) {
    console.error('- FAILED: --installer 解包失败，禁止回退中间目录');
    process.exit(1);
  }
  installerResourcesRoot = resolved.resources;
  installerTempRoot = resolved.tmp;
  console.log(`检查安装包（精确绑定）: ${cliInstaller}`);
}
const distResourcesRoot = installerResourcesRoot || distResourcesRootForPlatform(buildPlatform);
const appAsarPath = path.join(distResourcesRoot, 'app.asar');

let failed = false;

function fail(message) {
  console.error(`- ${message}`);
  failed = true;
}

function assertPath(label, filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`${label}: ${filePath}`);
  }
}

function assertFileContains(label, filePath, pattern) {
  if (!fs.existsSync(filePath)) {
    fail(`${label}: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!pattern.test(content)) {
    fail(`${label}: ${filePath} does not match ${pattern}`);
  }
}

function assertBinaryFileContains(label, filePath, markers) {
  if (!fs.existsSync(filePath)) {
    fail(`${label}: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(filePath);
  for (const marker of markers) {
    if (!content.includes(Buffer.from(marker))) {
      fail(`${label}: ${filePath} missing marker ${marker}`);
    }
  }
}

function assertCleanDesktopSeedDatabase(label, filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`${label}: ${filePath}`);
    return;
  }
  if (sqliteSeedContainsLoggedInUser(filePath)) {
    fail(`${label}: seed appears to contain login session markers`);
  }
}

/**
 * 大王铁律（2026-08-20）：安装包不得携带本地运行时数据。
 * 打包产物 backend/ 下只允许：bundle js / schema / 种子库 prisma/seed.db /
 * 引擎 / node_modules（sharp/playwright 等白名单）。
 * 出现 kaypal-ai.sqlite、*.log、*.wal/*.shm、.local-logs/、browser-profiles/ 即 fail。
 */
function assertNoRuntimeDataFiles(label, backendRoot) {
  const forbidden = [
    /\.sqlite$/i, /\.sqlite-wal$/i, /\.sqlite-shm$/i,
    /\.db$/i, /\.log$/i, /\.wal$/i, /\.shm$/i,
    /\.local-logs$/i, /browser-profiles$/i,
  ];
  const hits = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(backendRoot, full);
      // 白名单：prisma/seed.db 种子库
      if (rel === path.join('prisma', 'seed.db')) continue;
      if (e.isDirectory()) {
        if (e.name === '.local-logs' || e.name === 'browser-profiles') {
          hits.push(rel); continue;
        }
        walk(full);
      } else if (forbidden.some((re) => re.test(e.name))) {
        hits.push(rel);
      }
    }
  })(backendRoot);
  if (hits.length) {
    fail(`${label}: ${hits.join(', ')}`);
  }
}

function assertFileNotContains(label, filePath, pattern) {
  if (!fs.existsSync(filePath)) {
    fail(`${label}: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (pattern.test(content)) {
    fail(`${label}: ${filePath} should not match ${pattern}`);
  }
}

function assertBackendBundleChunks(sourceRoot, packagedRoot = null) {
  if (!fs.existsSync(sourceRoot)) {
    fail(`backend bundle source missing: ${sourceRoot}`);
    return;
  }
  const javascriptFiles = fs.readdirSync(sourceRoot)
    .filter((entry) => entry.endsWith('.js'));
  if (!javascriptFiles.includes('index.js')) {
    fail(`backend bundle source has no index.js: ${sourceRoot}`);
  }
  if (!packagedRoot) return;
  for (const fileName of javascriptFiles) {
    assertPath(`packaged backend JavaScript chunk ${fileName}`, path.join(packagedRoot, fileName));
  }
}

function assertBackendUsesBundledPlaywrightRuntime(label, filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`${label}: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (/chromium_headless_shell|chrome-headless-shell/.test(content)) {
    fail(`${label}: ${filePath} must not reference Playwright headless shell`);
  }
  if (!/PlaywrightBrowserRuntimeService/.test(content)) {
    fail(`${label}: ${filePath} must include PlaywrightBrowserRuntimeService`);
  }
  if (!/executablePath/.test(content)) {
    fail(`${label}: ${filePath} must launch Chromium with an explicit executablePath`);
  }
  if (/chromium\.launch\(\{\s*headless:\s*true\s*\}\)/.test(content)) {
    fail(`${label}: ${filePath} must not use chromium.launch({ headless: true }) without executablePath`);
  }
  if (/playwright_1\.chromium\.launch\(\{\s*headless:\s*true\s*\}\)/.test(content)) {
    fail(`${label}: ${filePath} must not use bundled output chromium.launch({ headless: true }) without executablePath`);
  }
}

function assertInstallerManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    fail(`installer manifest: ${manifestPath}`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`installer manifest is invalid JSON: ${error.message}`);
    return;
  }

  if (!manifest.deps || typeof manifest.deps !== 'object' || Array.isArray(manifest.deps)) {
    fail('installer manifest deps must be an object');
    return;
  }

  for (const depName of ['python', 'postgres', 'redis', 'node', 'chrome']) {
    if (manifest.deps[depName]) {
      fail(`installer manifest must not require ${depName} in one-click desktop mode`);
    }
  }

  for (const [depName, dep] of Object.entries(manifest.deps)) {
    if (!dep.url || !/^https:\/\/kaypal\.oss-cn-hangzhou\.aliyuncs\.com\/deps\/.+/.test(dep.url)) {
      fail(`installer manifest dep must use Kaypal OSS URL for ${depName}: ${dep.url || '<empty>'}`);
    }
    if (!dep.filename || !dep.size || !dep.sha256 || typeof dep.silentArgs !== 'string') {
      fail(`installer manifest missing filename/size/sha256/silentArgs for ${depName}`);
    }
  }
}

function readInstallerManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function assertBundledDependencyInstallers(root, manifestPath) {
  const manifest = readInstallerManifest(manifestPath);
  if (!manifest?.deps) {
    fail(`installer bundled deps cannot read manifest: ${manifestPath}`);
    return;
  }

  for (const [depName, dep] of Object.entries(manifest.deps)) {
    if (!dep?.filename) {
      fail(`installer bundled deps missing filename for ${depName}`);
      continue;
    }

    const filePath = path.join(root, dep.filename);
    if (!fs.existsSync(filePath)) {
      fail(`installer bundled dep missing: ${depName} ${filePath}`);
      continue;
    }

    const stat = fs.statSync(filePath);
    if (dep.size && stat.size !== Number(dep.size)) {
      fail(`installer bundled dep size mismatch: ${depName} expected ${dep.size}, got ${stat.size}`);
    }
  }
}

function assertNoPath(label, filePath) {
  if (fs.existsSync(filePath)) {
    fail(`${label} should not be packaged: ${filePath}`);
  }
}

function assertAsarEntry(entries, label, entryPath) {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const candidates = [
    normalized,
    `/${normalized}`,
    normalized.replace(/\//g, '\\'),
    `\\${normalized.replace(/\//g, '\\')}`,
  ];
  if (!candidates.some((candidate) => entries.has(candidate))) {
    fail(`${label}: ${entryPath}`);
  }
}

function prismaEngineFileForPlatform(platform) {
  switch (platform) {
    case 'win-x64':
      return 'query_engine-windows.dll.node';
    case 'mac-arm64':
      return 'libquery_engine-darwin-arm64.dylib.node';
    case 'mac-x64':
      return 'libquery_engine-darwin.dylib.node';
    case 'linux-x64':
      return 'libquery_engine-debian-openssl-3.0.x.so.node';
    default:
      return null;
  }
}

function forbiddenPrismaEngineFilesForPlatform(platform) {
  const allEngines = [
    'query_engine-windows.dll.node',
    'libquery_engine-darwin-arm64.dylib.node',
    'libquery_engine-darwin.dylib.node',
    'libquery_engine-debian-openssl-3.0.x.so.node',
  ];
  const required = prismaEngineFileForPlatform(platform);
  return allEngines.filter((engine) => engine !== required);
}

function sharpNativePackagesForPlatform(platform) {
  switch (platform) {
    case 'mac-arm64':
      return ['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64'];
    case 'win-x64':
      return ['@img/sharp-win32-x64', '@img/sharp-libvips-win32-x64'];
    default:
      return [];
  }
}

function chromiumExecutableNamesForPlatform(platform) {
  switch (platform) {
    case 'win-x64':
      return ['chrome.exe'];
    case 'mac-arm64':
    case 'mac-x64':
      return ['Google Chrome for Testing'];
    case 'linux-x64':
      return ['chrome'];
    default:
      if (process.platform === 'win32') return ['chrome.exe'];
      if (process.platform === 'darwin') return ['Google Chrome for Testing'];
      return ['chrome'];
  }
}

function findBundledChromiumExecutable(root, platform) {
  if (!fs.existsSync(root)) return null;
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

function assertBundledChromium(label, root, platform) {
  const executable = findBundledChromiumExecutable(root, platform);
  if (!executable) {
    fail(`${label}: missing Playwright Chromium executable for ${platform || process.platform} under ${root}`);
  }
}

function assertFrontendApiBase(frontendOutRoot) {
  const chunksDir = path.join(frontendOutRoot, '_next', 'static', 'chunks');
  if (!fs.existsSync(chunksDir)) {
    fail(`frontend chunks: ${chunksDir}`);
    return;
  }
  // 单入口改造（v1.1.70）：桌面注入 NEXT_PUBLIC_API_BASE=/api，产物必须走同源，
  // 不得残留绝对 3011 字面量（否则绕过反代、回归旧架构）
  const forbidden = /http:\/\/localhost:3011\/api|http:\/\/127\.0\.0\.1:3011\/api/;
  const files = fs.readdirSync(chunksDir).filter((entry) => entry.endsWith('.js'));
  const leaked = files.filter((entry) => {
    const fullPath = path.join(chunksDir, entry);
    return forbidden.test(fs.readFileSync(fullPath, 'utf8'));
  });
  if (leaked.length > 0) {
    fail(`frontend API base: chunks still contain absolute 3011 base (must be same-origin /api): ${leaked.slice(0, 3).join(', ')}`);
    return;
  }
  // 正向确认：至少一个 chunk 含同源默认 return"/api"（getApiBase 简化后的产物）
  const sameOrigin = files.some((entry) => {
    const fullPath = path.join(chunksDir, entry);
    return /return"\/api"/.test(fs.readFileSync(fullPath, 'utf8'));
  });
  if (!sameOrigin) {
    fail(`frontend API base: no chunk contains same-origin "/api" default (getApiBase refactor not applied)`);
  }
}

const forbiddenExternalRuntimePattern =
  /Test-Python|Test-Node|Test-Postgres|Test-Redis|Test-Chrome|PythonCore|Python312|python\.exe|node\.exe|psql\.exe|redis-server|chrome\.exe|DetectedDeps\["python"\]|DetectedDeps\["node"\]|DetectedDeps\["postgres"\]|DetectedDeps\["redis"\]|DetectedDeps\["chrome"\]/i;

function assertInstallerHelperNoExternalRuntimeDeps() {
  const helperManifestPath = path.join(desktopRoot, 'installer-helper', 'resources', 'deps-manifest.json');
  if (fs.existsSync(helperManifestPath)) {
    assertInstallerManifest(helperManifestPath);
  }
  assertFileNotContains(
    'installer helper detector must not require external runtime deps',
    path.join(desktopRoot, 'installer-helper', 'resources', 'detect-deps.ps1'),
    forbiddenExternalRuntimePattern
  );
  assertFileNotContains(
    'installer helper main must not order postgres',
    path.join(desktopRoot, 'installer-helper', 'main.js'),
    /depOrder\s*=\s*\[[^\]]*postgres|postgres:\s*['"]PostgreSQL/
  );
  assertFileNotContains(
    'installer helper UI must not ask users to install external deps',
    path.join(desktopRoot, 'installer-helper', 'renderer.html'),
    /一键安装缺失环境|下载官方运行环境安装包|PostgreSQL、Redis 和 Chrome 不再阻断安装/
  );
}

function finish() {
  // v1.1.106（复核 P2-B）：统一出口清理 --installer 解包临时目录（成功/断言失败
  // 都走这里；process.exit 会跳过 finally，故不放外层 try/finally）。
  if (installerTempRoot) {
    try {
      fs.rmSync(installerTempRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn(`- 临时目录清理失败（不覆盖检查结果）: ${error.message}`);
    }
    installerTempRoot = null;
  }
  if (failed) {
    console.error('');
    console.error(`Full installer asset check failed (${phase}, target=${buildPlatform || process.platform}).`);
    process.exit(1);
  }

  console.log(`Full installer asset check passed (${phase}, target=${buildPlatform || process.platform}).`);
}

function checkPreBuildAssets() {
  const requiredSources = [
    ['desktop main entry', path.join(desktopRoot, 'main.js')],
    ['desktop credential key store', path.join(desktopRoot, 'credential-key-store.js')],
    ['desktop icon', path.join(desktopRoot, 'assets', 'icon.ico')],
    ['electron-store dependency', path.join(desktopRoot, 'node_modules', 'electron-store', 'package.json')],
    ['fix-path dependency', path.join(desktopRoot, 'node_modules', 'fix-path', 'package.json')],
    ['backend SQLite bundle', path.join(repoRoot, 'backend', 'dist-bundle-sqlite', 'index.js')],
    ['backend runtime package boundary', path.join(repoRoot, 'backend', 'dist-bundle-sqlite', 'package.json')],
    ['backend SQLite Prisma schema', path.join(repoRoot, 'backend', 'prisma', 'schema.sqlite.prisma')],
    ['backend SQLite seed database', path.join(repoRoot, 'backend', 'prisma', 'seed.db')],
    ['frontend static export', path.join(repoRoot, 'frontend', 'out', 'index.html')],
    ['frontend Next assets', path.join(repoRoot, 'frontend', 'out', '_next')],
    ['Playwright MCP CLI', path.join(repoRoot, 'backend', 'node_modules', '@playwright', 'mcp', 'cli.js')],
    ['Playwright MCP bundled dependencies', path.join(repoRoot, 'backend', 'node_modules', '@playwright', 'mcp', 'node_modules')],
    ['Playwright package', path.join(repoRoot, 'backend', 'node_modules', 'playwright', 'package.json')],
    ['Playwright Core package', path.join(repoRoot, 'backend', 'node_modules', 'playwright-core', 'package.json')],
    ['bundled Playwright browser root', path.join(desktopRoot, 'runtime', 'playwright-browsers')],
  ];
  const engineFile = prismaEngineFileForPlatform(buildPlatform);
  if (engineFile) {
    requiredSources.push(['Prisma target query engine', path.join(repoRoot, 'backend', 'node_modules', '.prisma', 'client', engineFile)]);
    requiredSources.push(['Prisma bundle runtime query engine copy', path.join(repoRoot, 'backend', 'dist-bundle-sqlite', engineFile)]);
  }

  for (const [label, filePath] of requiredSources) {
    assertPath(label, filePath);
  }
  const sourceGuard = createGuardContext();
  assertSourceReleaseGuards(
    sourceGuard,
    {
      desktopRoot,
      mainJs: path.join(desktopRoot, 'main.js'),
      backendEnv: path.join(desktopRoot, 'backend.env.example'),
      backendBundle: path.join(repoRoot, 'backend', 'dist-bundle-sqlite', 'index.js'),
      sqliteSeed: path.join(repoRoot, 'backend', 'prisma', 'seed.db'),
    },
    buildPlatform,
  );
  sourceGuard.failures.forEach(fail);
  assertBinaryFileContains(
    'backend SQLite seed schema markers',
    path.join(repoRoot, 'backend', 'prisma', 'seed.db'),
    ['schedule_configs', 'kaypal_user_id', 'commercial_execution_allowed', 'plan_mode', 'user_sessions']
  );
  assertCleanDesktopSeedDatabase(
    'backend SQLite seed must not include a logged-in user',
    path.join(repoRoot, 'backend', 'prisma', 'seed.db'),
  );
  assertBundledChromium(
    'bundled Playwright Chromium',
    path.join(desktopRoot, 'runtime', 'playwright-browsers'),
    buildPlatform,
  );
  assertBackendUsesBundledPlaywrightRuntime(
    'backend browser runtime launch guard',
    path.join(repoRoot, 'backend', 'dist-bundle-sqlite', 'index.js')
  );
  assertFileContains(
    'backend runtime package uses CommonJS boundary',
    path.join(repoRoot, 'backend', 'dist-bundle-sqlite', 'package.json'),
    /"type"\s*:\s*"commonjs"/
  );
  assertBackendBundleChunks(path.join(repoRoot, 'backend', 'dist-bundle-sqlite'));

  assertFileContains(
    'desktop SQLite DATABASE_URL',
    path.join(desktopRoot, 'backend.env.example'),
    /^DATABASE_URL=file:\.\/kaypal-ai\.sqlite/m
  );
  assertFileContains(
    'desktop SQLite database mode switch',
    path.join(desktopRoot, 'backend.env.example'),
    /^KAYPAL_DESKTOP_DATABASE_MODE=sqlite/m
  );
  assertFileContains(
    'desktop SQLite database URL',
    path.join(desktopRoot, 'backend.env.example'),
    /^SQLITE_DATABASE_URL=file:\.\/kaypal-ai\.sqlite/m
  );
  assertFileContains(
    'desktop Kaypal auth base URL',
    path.join(desktopRoot, 'backend.env.example'),
    /^KAYPAL_AUTH_BASE_URL=https:\/\/(test\.)?kaypal\.cn/m
  );
  assertFileContains(
    'desktop uses Node interaction runtime',
    path.join(desktopRoot, 'backend.env.example'),
    /^KAYPAL_NODE_AGENT_RUNTIME=1/m
  );
  assertFileNotContains(
    'desktop startup must not depend on system sqlite3',
    path.join(desktopRoot, 'main.js'),
    /execFileSync\(\s*['"]sqlite3['"]|spawnSync\(\s*['"]sqlite3['"]|sqlite3['"]\s*,\s*\[filePath/
  );
  assertFileNotContains(
    'packaged startup must not probe system Node with which node',
    path.join(desktopRoot, 'main.js'),
    /which node/
  );
  const mainGuard = createGuardContext();
  assertMainRuntimePolicy(mainGuard, path.join(desktopRoot, 'main.js'));
  mainGuard.failures.forEach(fail);
  assertFileContains(
    'packaged backend starts bundled Node directly',
    path.join(desktopRoot, 'main.js'),
    /spawn\(nodeBin,\s*\[backendEntry\]/
  );
  assertFileNotContains(
    'packaged backend startup must not go through shell wrapper',
    path.join(desktopRoot, 'main.js'),
    /spawn\('\/bin\/zsh', \['-lc', script\]/
  );

  assertFrontendApiBase(path.join(repoRoot, 'frontend', 'out'));

  assertInstallerManifest(path.join(desktopRoot, 'installer', 'deps-manifest.json'));
  assertInstallerHelperNoExternalRuntimeDeps();
  assertFileContains(
    'NSIS one-click bundled runtime policy',
    path.join(desktopRoot, 'installer.nsh'),
    /使用应用内置运行时，不要求用户单独安装 Python\/Node\/Postgres\/Redis\/Chrome/
  );
  assertFileContains(
    'NSIS post install does not abort on bootstrap warnings',
    path.join(desktopRoot, 'installer.nsh'),
    /安装后初始化有警告/
  );
  assertFileNotContains(
    'NSIS custom install must not abort after post install warning',
    path.join(desktopRoot, 'installer.nsh'),
    /MessageBox MB_ICONSTOP|^\s*Abort\s*$/m
  );
  assertFileNotContains(
    'bootstrap post install must not abort on database init warning',
    path.join(desktopRoot, 'installer', 'bootstrap-installer.ps1'),
    /本地数据库初始化失败,请查看失败原因/
  );
  assertFileNotContains(
    'bootstrap post install must not abort on self check warning',
    path.join(desktopRoot, 'installer', 'bootstrap-installer.ps1'),
    /安装后自检失败,请查看失败原因/
  );
  assertFileNotContains(
    'legacy post install must not abort on self check warning',
    path.join(desktopRoot, 'installer', 'post-install.ps1'),
    /安装后自检失败,主程序不可用/
  );
  assertFileNotContains(
    'legacy post install must not throw at startup',
    path.join(desktopRoot, 'installer', 'post-install.ps1'),
    /post-install\.ps1 已废弃/
  );
  assertFileNotContains(
    'dependency detector must not require external runtime deps',
    path.join(desktopRoot, 'installer', 'detect-deps.ps1'),
    forbiddenExternalRuntimePattern
  );
  assertFileNotContains(
    'installer bootstrap must not ask users to install external deps',
    path.join(desktopRoot, 'installer', 'bootstrap-installer.ps1'),
    /一键安装缺失环境|从 Kaypal 阿里云 OSS 下载并安装|下载缺失运行环境/
  );
  assertFileNotContains(
    'dependency upload script must not publish Python or external runtime installers',
    path.join(desktopRoot, 'installer', 'scripts', 'upload-deps.js'),
    /name:\s*["']python["']|PYTHON_INSTALLER|python-3\.12|PostgreSQL|Redis|Chrome/i
  );
  assertFileNotContains(
    'bootstrap must not initialize postgres',
    path.join(desktopRoot, 'installer', 'bootstrap-installer.ps1'),
    /init-postgres|PostgreSQL 初始化|Get-DepOrder\s*\{[\s\S]*postgres/
  );
  assertFileNotContains(
    'desktop package must not include legacy external dependency scripts',
    path.join(desktopRoot, 'package.json'),
    /"\*\*\/\*\.ps1"|"scripts\/\*\*\/\*\.js"|init-postgres\.ps1|download-deps\.ps1|post-install\.ps1/
  );
  assertFileNotContains(
    'desktop package must not package Python Agent-S sidecar or wheelhouse',
    path.join(desktopRoot, 'package.json'),
    /sidecars\/agent-s-executor|agent-s-executor|wheelhouse\/\*\*/
  );
  assertFileNotContains(
    'self check must not require postgres',
    path.join(desktopRoot, 'installer', 'self-check.ps1'),
    /Test-Postgres|PostgreSQL ai_content|psql\.exe/
  );
  assertFileContains(
    'NSIS post install mode',
    path.join(desktopRoot, 'installer.nsh'),
    /customInstall[\s\S]+-Mode PostInstall/
  );
  assertFileContains(
    'bootstrap preflight mode',
    path.join(desktopRoot, 'installer', 'bootstrap-installer.ps1'),
    /ValidateSet\("Preflight", "PostInstall", "Full"\)/
  );

  finish();
}

function checkPostBuildAssets() {
  assertPath('app.asar', appAsarPath);

  if (fs.existsSync(appAsarPath)) {
    let asar;
    try {
      asar = require('@electron/asar');
    } catch (error) {
      fail(`@electron/asar dependency is unavailable: ${error.message}`);
    }

    if (asar) {
      let entries = new Set();
      try {
        entries = new Set(asar.listPackage(appAsarPath));
      } catch (error) {
        fail(`cannot read app.asar: ${error.message}`);
      }

      if (entries.size > 0) {
        const requiredAsarEntries = [
          ['app main entry', 'main.js'],
          ['credential key store', 'credential-key-store.js'],
          ['app icon', 'assets/icon.ico'],
          ['electron-store dependency', 'node_modules/electron-store'],
          ['fix-path dependency', 'node_modules/fix-path'],
          // v1.1.106（复核修复）：8/11 起悬浮球 preload 缺失致 window.hoverBallAPI
          // undefined（Cannot read properties of undefined reading runAction）——
          // build.files 漏了 preload-hoverball.js，1.1.99~1.1.105 全版本包里都缺。
          ['hover ball html', 'hover-ball.html'],
          ['hover ball preload', 'preload-hoverball.js'],
        ];

        for (const [label, entryPath] of requiredAsarEntries) {
          assertAsarEntry(entries, label, entryPath);
        }
      }
    }
  }

  const requiredResources = [
    ['backend resource', path.join(distResourcesRoot, 'backend', 'index.js')],
    ['backend runtime package boundary', path.join(distResourcesRoot, 'backend', 'package.json')],
    ['backend env', path.join(distResourcesRoot, 'backend', '.env')],
    ['backend SQLite Prisma schema', path.join(distResourcesRoot, 'backend', 'prisma', 'schema.sqlite.prisma')],
    ['backend SQLite seed database', path.join(distResourcesRoot, 'backend', 'prisma', 'seed.db')],
    ['backend Prisma migrations', path.join(distResourcesRoot, 'backend', 'prisma', 'migrations')],
    ['frontend resource', path.join(distResourcesRoot, 'frontend', 'index.html')],
    ['frontend Next assets', path.join(distResourcesRoot, 'frontend', '_next')],
    ['installer bootstrap resource', path.join(distResourcesRoot, 'installer', 'bootstrap-installer.ps1')],
    ['installer self-check resource', path.join(distResourcesRoot, 'installer', 'self-check.ps1')],
    ['installer manifest resource', path.join(distResourcesRoot, 'installer', 'deps-manifest.json')],
    ['Playwright package resource', path.join(distResourcesRoot, 'backend', 'node_modules', 'playwright', 'package.json')],
    ['Playwright Core package resource', path.join(distResourcesRoot, 'backend', 'node_modules', 'playwright-core', 'package.json')],
    ['Sharp package resource', path.join(distResourcesRoot, 'backend', 'node_modules', 'sharp', 'package.json')],
    ['bundled Playwright browser resource', path.join(distResourcesRoot, 'playwright-browsers')],
    ['bundled Node runtime', nodeRuntimePathForPlatform(distResourcesRoot, buildPlatform)],
  ];
  const engineFile = prismaEngineFileForPlatform(buildPlatform);
  if (engineFile) {
    requiredResources.push(['Prisma target query engine', path.join(distResourcesRoot, 'backend', 'client', engineFile)]);
    requiredResources.push(['Prisma runtime query engine copy', path.join(distResourcesRoot, 'backend', engineFile)]);
  }
  for (const packageName of sharpNativePackagesForPlatform(buildPlatform)) {
    requiredResources.push([
      `Sharp native package ${packageName}`,
      path.join(distResourcesRoot, 'backend', 'node_modules', ...packageName.split('/'), 'package.json'),
    ]);
  }

  for (const [label, filePath] of requiredResources) {
    assertPath(label, filePath);
  }
  // v1.1.105（复核 P1-1）：平台互斥——后端 client 目录不得混入**非当前平台**的
  // Prisma 引擎（win 包出现 darwin 引擎 = 交叉构建资源串包，8/30 曾实锤）。
  const backendClientRoot = path.join(distResourcesRoot, 'backend', 'client');
  if (fs.existsSync(backendClientRoot)) {
    const allowedEngine = prismaEngineFileForPlatform(buildPlatform);
    const foreignEngines = fs
      .readdirSync(backendClientRoot)
      .filter((f) => /(?:libquery_engine|query_engine)[^/]*\.(?:node|dylib|so)/i.test(f))
      .filter((f) => allowedEngine && f !== allowedEngine);
    for (const engine of foreignEngines) {
      fail(`平台互斥：${buildPlatform} 包混入非本平台 Prisma 引擎 ${engine}（交叉构建资源串包）`);
    }
  }
  const packagedGuard = createGuardContext();
  assertPackagedReleaseGuards(packagedGuard, distResourcesRoot, buildPlatform);
  packagedGuard.failures.forEach(fail);
  assertBinaryFileContains(
    'packaged SQLite seed schema markers',
    path.join(distResourcesRoot, 'backend', 'prisma', 'seed.db'),
    ['schedule_configs', 'kaypal_user_id', 'commercial_execution_allowed', 'plan_mode', 'user_sessions']
  );
  assertCleanDesktopSeedDatabase(
    'packaged SQLite seed must not include a logged-in user',
    path.join(distResourcesRoot, 'backend', 'prisma', 'seed.db'),
  );
  assertNoRuntimeDataFiles(
    'packaged backend must not include local runtime data',
    path.join(distResourcesRoot, 'backend'),
  );
  assertBundledChromium(
    'packaged Playwright Chromium',
    path.join(distResourcesRoot, 'playwright-browsers'),
    buildPlatform,
  );
  assertBackendUsesBundledPlaywrightRuntime(
    'packaged backend browser runtime launch guard',
    path.join(distResourcesRoot, 'backend', 'index.js')
  );
  assertFileContains(
    'packaged backend runtime package uses CommonJS boundary',
    path.join(distResourcesRoot, 'backend', 'package.json'),
    /"type"\s*:\s*"commonjs"/
  );
  assertBackendBundleChunks(
    path.join(repoRoot, 'backend', 'dist-bundle-sqlite'),
    path.join(distResourcesRoot, 'backend'),
  );

  assertFileContains(
    'packaged SQLite DATABASE_URL',
    path.join(distResourcesRoot, 'backend', '.env'),
    /^DATABASE_URL=file:\.\/kaypal-ai\.sqlite/m
  );
  assertFileContains(
    'packaged SQLite database mode switch',
    path.join(distResourcesRoot, 'backend', '.env'),
    /^KAYPAL_DESKTOP_DATABASE_MODE=sqlite/m
  );
  assertFileContains(
    'packaged SQLite database URL',
    path.join(distResourcesRoot, 'backend', '.env'),
    /^SQLITE_DATABASE_URL=file:\.\/kaypal-ai\.sqlite/m
  );
  assertFileContains(
    'packaged Kaypal auth base URL',
    path.join(distResourcesRoot, 'backend', '.env'),
    /^KAYPAL_AUTH_BASE_URL=https:\/\/(test\.)?kaypal\.cn/m
  );

  assertInstallerManifest(path.join(distResourcesRoot, 'installer', 'deps-manifest.json'));
  for (const engine of forbiddenPrismaEngineFilesForPlatform(buildPlatform)) {
    assertNoPath(`foreign Prisma engine ${engine}`, path.join(distResourcesRoot, 'backend', 'client', engine));
  }
  assertNoPath('installer bundled deps', path.join(distResourcesRoot, 'installer', 'deps'));
  assertNoPath('legacy postgres init script', path.join(distResourcesRoot, 'installer', 'init-postgres.ps1'));
  assertNoPath('runtime browser profiles', path.join(distResourcesRoot, 'backend', 'data'));
  assertNoPath('legacy auto-upload sidecar', path.join(distResourcesRoot, 'auto-upload'));
  assertNoPath('Python Agent-S sidecar', path.join(distResourcesRoot, 'agent-s-executor'));
  assertNoPath('Python wheelhouse', path.join(distResourcesRoot, 'installer', 'wheelhouse'));

  finish();
}

if (phase === 'pre') {
  checkPreBuildAssets();
} else if (phase === 'post') {
  checkPostBuildAssets();
} else {
  console.error(`Unknown phase: ${phase}`);
  console.error('Use --phase=pre or --phase=post.');
  process.exit(1);
}
