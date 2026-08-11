const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const distDir = path.join(desktopRoot, 'dist');
const packagePath = path.join(desktopRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const expectedVersion = (process.env.RELEASE_VERSION || pkg.version || '').trim();
const localOnly = process.argv.includes('--local-only') || process.env.RELEASE_VERIFY_LOCAL_ONLY === 'true';
const updateBaseUrl = (
  process.env.AI_CONTENT_UPDATE_URL ||
  pkg?.build?.publish?.url ||
  pkg.homepage ||
  ''
).trim();

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function normalizePackagePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');
}

function packageExtraResources() {
  return [
    ...(Array.isArray(pkg?.build?.extraResources) ? pkg.build.extraResources : []),
    ...(Array.isArray(pkg?.build?.win?.extraResources) ? pkg.build.win.extraResources : []),
  ];
}

function assertPackageExtraResource(label, to, expectedFrom, requiredFilters = []) {
  const resource = packageExtraResources().find((item) => item?.to === to);
  assert(Boolean(resource), `desktop/package.json build.extraResources missing ${to}`);
  if (!resource) return;
  assert(
    normalizePackagePath(resource.from) === normalizePackagePath(expectedFrom),
    `desktop/package.json ${to} extraResource must package ${expectedFrom}`,
  );
  const filters = Array.isArray(resource.filter) ? resource.filter : [];
  for (const requiredFilter of requiredFilters) {
    assert(
      filters.includes(requiredFilter),
      `desktop/package.json ${to} extraResource must include ${requiredFilter}`,
    );
  }
}

function assertAnyPath(label, candidates) {
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    fail(`${label}: expected one of ${candidates.map((candidate) => path.relative(repoRoot, candidate)).join(', ')}`);
  }
  return existing || null;
}

function parseLatestYml(content) {
  const pick = (pattern) => {
    const match = content.match(pattern);
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
  };
  const sizeText = pick(/^\s*size:\s*([0-9]+)\s*$/m);
  return {
    version: pick(/^\s*version:\s*([^\r\n#]+)\s*$/m),
    path: pick(/^\s*path:\s*([^\r\n#]+)\s*$/m),
    sha512: pick(/^\s*sha512:\s*([^\r\n#]+)\s*$/m),
    size: sizeText ? Number(sizeText) : NaN,
  };
}

function fileHash(filePath, algorithm, encoding) {
  const hash = crypto.createHash(algorithm);
  hash.update(fs.readFileSync(filePath));
  return hash.digest(encoding);
}

function request(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(
      parsed,
      {
        method,
        timeout: 30000,
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          resolve(request(new URL(res.headers.location, parsed).toString(), method));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => {
          if (method !== 'HEAD') chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`request timeout: ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

function artifactUrl(relativePath) {
  return new URL(encodeURI(relativePath), updateBaseUrl).toString();
}

function verifyPackageContract() {
  assert(pkg.scripts?.['build:win'], 'desktop/package.json missing scripts.build:win');
  assert(
    pkg.scripts?.['release:verify'] === 'node scripts/verify-oss-release.js',
    'desktop/package.json missing scripts.release:verify',
  );
  // wechat-db-helper 已从主安装包隔离为云端按需资源（本地保留 runtime 目录作为 OSS 打包源）
  assertAnyPath('WeChat DB helper OSS packaging source', [
    path.join(repoRoot, 'desktop', 'runtime', 'wechat-db-helper', 'wechat-db-helper.js'),
  ]);
  const dbHelperResource = packageExtraResources().find(
    (item) => item?.to === 'wechat-db-helper',
  );
  assert(
    !dbHelperResource,
    'desktop/package.json must NOT package wechat-db-helper in extraResources (isolated to OSS on-demand)',
  );
  assertPackageExtraResource('WeChat sidecar engine package resource', 'wechat-engine', 'runtime/wechat-engine', ['**/*']);
  assertPackageExtraResource('WeChat OCR engine package resource', 'wechat-ocr', 'runtime/wechat-ocr', ['**/*']);
  assertPackageExtraResource('Remote assets downloader package resource', 'remote-assets', 'runtime/remote-assets', ['**/*']);
  assertPackageExtraResource('WeChat native runtime package resource', 'wechat-native-runtime', 'runtime/wechat-native-runtime', ['**/*']);
  assertPackageExtraResource('Media tools package resource (ffmpeg/ffprobe)', 'media-tools', 'runtime/media-tools', [
    'bin/**/*',
    'licenses/**/*',
    'manifest.json',
    'SOURCE-OFFER.txt',
  ]);
  assert(
    pkg.build?.publish?.url && /^https:\/\//.test(pkg.build.publish.url),
    'desktop/package.json build.publish.url must be HTTPS',
  );
}

function verifySourceWechatNativeRuntime() {
  const dbHelperRoot = path.join(desktopRoot, 'runtime', 'wechat-db-helper');
  assert(fs.existsSync(dbHelperRoot), `missing source WeChat DB helper directory: ${dbHelperRoot}`);
  assert(fs.existsSync(path.join(dbHelperRoot, 'sqlite3.exe')), `missing source WeChat DB helper sqlite3.exe: ${path.join(dbHelperRoot, 'sqlite3.exe')}`);
  for (const fileName of ['wechat-dump-rs.exe', 'DbkeyHookCMD.exe', 'Dbkey.exe', 'dump_data.exe', 'wx_key.dll']) {
    assert(
      fs.existsSync(path.join(dbHelperRoot, fileName)),
      `missing source WeChat DB helper native tool ${fileName}: ${path.join(dbHelperRoot, fileName)}`,
    );
  }
  assertAnyPath('source WeChat DB helper script', [
    path.join(dbHelperRoot, 'wechat-db-helper.js'),
    path.join(dbHelperRoot, 'README.md'),
  ]);

  const engineRoot = path.join(desktopRoot, 'runtime', 'wechat-engine');
  assert(fs.existsSync(engineRoot), `missing source WeChat sidecar engine directory: ${engineRoot}`);
  assertAnyPath('source WeChat sidecar engine executable/script', [
    path.join(engineRoot, 'kaypal-wechat-engine.exe'),
    path.join(engineRoot, 'kaypal-wechat-engine.js'),
  ]);

  const runtimeRoot = path.join(desktopRoot, 'runtime', 'wechat-native-runtime');
  assert(fs.existsSync(runtimeRoot), `missing source WeChat native runtime directory: ${runtimeRoot}`);
  assertAnyPath('source WeChat native runtime executable/script', [
    path.join(runtimeRoot, 'kaypal-wechat-native-runtime.exe'),
    path.join(runtimeRoot, 'kaypal-wechat-native-runtime.js'),
  ]);

  const ocrRoot = path.join(desktopRoot, 'runtime', 'wechat-ocr');
  assert(fs.existsSync(ocrRoot), `missing source WeChat OCR engine directory: ${ocrRoot}`);

  const remoteAssetsRoot = path.join(desktopRoot, 'runtime', 'remote-assets');
  assert(fs.existsSync(remoteAssetsRoot), `missing source remote-assets directory: ${remoteAssetsRoot}`);
  assert(
    fs.existsSync(path.join(remoteAssetsRoot, 'download.mjs')),
    `missing source remote-assets downloader script: ${path.join(remoteAssetsRoot, 'download.mjs')}`,
  );

  const gitignore = readText(path.join(repoRoot, '.gitignore'));
  assert(
    /^!desktop\/runtime\/wechat-native-runtime\/$/m.test(gitignore),
    '.gitignore must unignore desktop/runtime/wechat-native-runtime/',
  );
  assert(
    /^!desktop\/runtime\/wechat-native-runtime\/\*\*$/m.test(gitignore),
    '.gitignore must unignore desktop/runtime/wechat-native-runtime/**',
  );

  const mainJs = readText(path.join(desktopRoot, 'main.js'));
  assert(
    /getResourcePath\(['"]wechat-db-helper['"]\)/.test(mainJs),
    'desktop/main.js must resolve packaged wechat-db-helper from resources',
  );
  assert(
    /AI_CONTENT_SQLITE_EXE/.test(mainJs),
    'desktop/main.js must inject AI_CONTENT_SQLITE_EXE into backend env',
  );
  assert(
    /getResourcePath\(['"]wechat-engine['"]\)/.test(mainJs),
    'desktop/main.js must resolve packaged wechat-engine from resources',
  );
  assert(
    /AI_CONTENT_WECHAT_ENGINE/.test(mainJs),
    'desktop/main.js must inject AI_CONTENT_WECHAT_ENGINE into backend env',
  );
  assert(
    /kaypal-wechat-engine\.(exe|js)/.test(mainJs),
    'desktop/main.js must look for kaypal-wechat-engine executable/script',
  );
  assert(
    /getResourcePath\(['"]wechat-native-runtime['"]\)/.test(mainJs),
    'desktop/main.js must resolve packaged wechat-native-runtime from resources',
  );
  assert(
    /AI_CONTENT_WECHAT_NATIVE_RUNTIME/.test(mainJs),
    'desktop/main.js must inject AI_CONTENT_WECHAT_NATIVE_RUNTIME into backend env',
  );
  assert(
    /kaypal-wechat-native-runtime\.(exe|js)/.test(mainJs),
    'desktop/main.js must look for kaypal-wechat-native-runtime executable/script',
  );
}

function verifyPackagedWechatNativeRuntime(resourcesRoot) {
  assert(fs.existsSync(resourcesRoot), `missing packaged resources root: ${resourcesRoot}`);
  const dbHelperRoot = path.join(resourcesRoot, 'wechat-db-helper');
  assert(fs.existsSync(dbHelperRoot), `missing packaged WeChat DB helper directory: ${dbHelperRoot}`);
  assert(fs.existsSync(path.join(dbHelperRoot, 'sqlite3.exe')), `missing packaged WeChat DB helper sqlite3.exe: ${path.join(dbHelperRoot, 'sqlite3.exe')}`);
  assert(fs.existsSync(path.join(dbHelperRoot, 'wechat-db-helper.js')), `missing packaged WeChat DB helper script: ${path.join(dbHelperRoot, 'wechat-db-helper.js')}`);
  for (const fileName of ['wechat-dump-rs.exe', 'DbkeyHookCMD.exe', 'Dbkey.exe', 'dump_data.exe', 'wx_key.dll']) {
    assert(
      fs.existsSync(path.join(dbHelperRoot, fileName)),
      `missing packaged WeChat DB helper native tool ${fileName}: ${path.join(dbHelperRoot, fileName)}`,
    );
  }

  const engineRoot = path.join(resourcesRoot, 'wechat-engine');
  assert(fs.existsSync(engineRoot), `missing packaged WeChat sidecar engine directory: ${engineRoot}`);
  assertAnyPath('packaged WeChat sidecar engine executable/script', [
    path.join(engineRoot, 'kaypal-wechat-engine.exe'),
    path.join(engineRoot, 'kaypal-wechat-engine.js'),
  ]);

  const runtimeRoot = path.join(resourcesRoot, 'wechat-native-runtime');
  assert(fs.existsSync(runtimeRoot), `missing packaged WeChat native runtime directory: ${runtimeRoot}`);
  assertAnyPath('packaged WeChat native runtime executable/script', [
    path.join(runtimeRoot, 'kaypal-wechat-native-runtime.exe'),
    path.join(runtimeRoot, 'kaypal-wechat-native-runtime.js'),
  ]);

  const backendBundle = path.join(resourcesRoot, 'backend', 'index.js');
  assert(
    /AI_CONTENT_SQLITE_EXE/.test(readText(backendBundle)),
    'packaged backend must read AI_CONTENT_SQLITE_EXE',
  );
  assert(
    /AI_CONTENT_WECHAT_ENGINE/.test(readText(backendBundle)),
    'packaged backend must read AI_CONTENT_WECHAT_ENGINE',
  );
  assert(
    /AI_CONTENT_WECHAT_NATIVE_RUNTIME/.test(readText(backendBundle)),
    'packaged backend must read AI_CONTENT_WECHAT_NATIVE_RUNTIME',
  );
}

function verifyLocalLatest() {
  const latestPath = path.join(distDir, 'latest.yml');
  assert(fs.existsSync(latestPath), `missing local latest.yml: ${latestPath}`);
  if (!fs.existsSync(latestPath)) return null;

  const latest = parseLatestYml(readText(latestPath));
  assert(latest.version === expectedVersion, `local latest version ${latest.version} != ${expectedVersion}`);
  assert(Boolean(latest.path), 'local latest.yml missing path');
  assert(Number.isFinite(latest.size), 'local latest.yml missing size');
  assert(Boolean(latest.sha512), 'local latest.yml missing sha512');

  const installerPath = path.join(distDir, latest.path);
  const blockmapPath = `${installerPath}.blockmap`;
  assert(fs.existsSync(installerPath), `missing local installer: ${installerPath}`);
  assert(fs.existsSync(blockmapPath), `missing local blockmap: ${blockmapPath}`);
  if (fs.existsSync(installerPath)) {
    const stat = fs.statSync(installerPath);
    assert(stat.size === latest.size, `local installer size ${stat.size} != latest.yml ${latest.size}`);
    const sha512 = fileHash(installerPath, 'sha512', 'base64');
    assert(sha512 === latest.sha512, 'local installer sha512 does not match latest.yml');
    latest.sha256 = fileHash(installerPath, 'sha256', 'hex');
  }
  return latest;
}

function verifyPackagedApp() {
  const resourcesRoot = path.join(distDir, 'win-unpacked', 'resources');
  const appAsar = path.join(resourcesRoot, 'app.asar');
  assert(fs.existsSync(appAsar), `missing packaged app.asar: ${appAsar}`);
  verifyPackagedWechatNativeRuntime(resourcesRoot);
  if (!fs.existsSync(appAsar)) return;

  const asarBin = path.join(
    desktopRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'asar.cmd' : 'asar',
  );
  assert(fs.existsSync(asarBin), `missing local asar binary: ${asarBin}`);
  if (!fs.existsSync(asarBin)) return;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaypal-release-verify-'));
  try {
    execFileSync(asarBin, ['extract', appAsar, tempDir], {
      cwd: desktopRoot,
      stdio: 'ignore',
      timeout: 120000,
    });
    const packagedPkg = JSON.parse(readText(path.join(tempDir, 'package.json')));
    const updater = readText(path.join(tempDir, 'auto-updater.js'));
    assert(
      packagedPkg.version === expectedVersion,
      `packaged app version ${packagedPkg.version} != ${expectedVersion}`,
    );
    assert(
      updater.includes("startUpdateDownload('auto')"),
      'packaged auto-updater does not auto-start update download',
    );
    assert(
      updater.includes('Using update feed from packaged app-update.yml'),
      'packaged auto-updater does not bind packaged update feed',
    );
    const packagedMain = readText(path.join(tempDir, 'main.js'));
    assert(
      /AI_CONTENT_SQLITE_EXE/.test(packagedMain) &&
        /getResourcePath\(['"]wechat-db-helper['"]\)/.test(packagedMain) &&
        /AI_CONTENT_WECHAT_ENGINE/.test(packagedMain) &&
        /getResourcePath\(['"]wechat-engine['"]\)/.test(packagedMain) &&
        /AI_CONTENT_WECHAT_NATIVE_RUNTIME/.test(packagedMain) &&
        /getResourcePath\(['"]wechat-native-runtime['"]\)/.test(packagedMain),
      'packaged main.js does not inject packaged WeChat DB helper, sidecar engine, and native runtime',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function verifyRemote(latest) {
  assert(Boolean(updateBaseUrl), 'missing update feed base URL');
  if (!updateBaseUrl || !latest) return;
  assert(/^https:\/\//.test(updateBaseUrl), `update feed must use HTTPS: ${updateBaseUrl}`);

  const latestUrl = artifactUrl('latest.yml');
  const remoteLatestResponse = await request(latestUrl);
  assert(remoteLatestResponse.statusCode === 200, `remote latest.yml HTTP ${remoteLatestResponse.statusCode}`);
  const remoteLatest = parseLatestYml(remoteLatestResponse.body || '');
  assert(remoteLatest.version === latest.version, `remote latest version ${remoteLatest.version} != local ${latest.version}`);
  assert(remoteLatest.path === latest.path, `remote latest path ${remoteLatest.path} != local ${latest.path}`);
  assert(remoteLatest.size === latest.size, `remote latest size ${remoteLatest.size} != local ${latest.size}`);
  assert(remoteLatest.sha512 === latest.sha512, 'remote latest sha512 does not match local latest');

  const installerHead = await request(artifactUrl(latest.path), 'HEAD');
  assert(installerHead.statusCode === 200, `remote installer HTTP ${installerHead.statusCode}`);
  const remoteSize = Number(installerHead.headers['content-length']);
  assert(remoteSize === latest.size, `remote installer size ${remoteSize} != local ${latest.size}`);

  const blockmapHead = await request(artifactUrl(`${latest.path}.blockmap`), 'HEAD');
  assert(blockmapHead.statusCode === 200, `remote blockmap HTTP ${blockmapHead.statusCode}`);
  const blockmapSize = Number(blockmapHead.headers['content-length']);
  assert(Number.isFinite(blockmapSize) && blockmapSize > 1024, `remote blockmap size is invalid: ${blockmapSize}`);

  return {
    latestUrl,
    installerUrl: artifactUrl(latest.path),
    remoteSize,
    blockmapSize,
  };
}

async function main() {
  verifyPackageContract();
  verifySourceWechatNativeRuntime();
  const latest = verifyLocalLatest();
  verifyPackagedApp();
  const remote = localOnly ? null : await verifyRemote(latest);

  if (warnings.length > 0) {
    console.warn('Release verification warnings:');
    for (const warning of warnings) console.warn(`  - ${warning}`);
  }
  if (failures.length > 0) {
    console.error('Release verification failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('Release verification passed.');
  console.log(`  version: ${expectedVersion}`);
  if (latest) {
    console.log(`  local installer: ${latest.path}`);
    console.log(`  local size: ${latest.size}`);
    console.log(`  local sha256: ${latest.sha256}`);
  }
  if (remote) {
    console.log(`  remote latest: ${remote.latestUrl}`);
    console.log(`  remote installer: ${remote.installerUrl}`);
    console.log(`  remote size: ${remote.remoteSize}`);
    console.log(`  remote blockmap size: ${remote.blockmapSize}`);
  } else if (localOnly) {
    console.log('  remote: skipped (--local-only)');
  }
}

main().catch((error) => {
  console.error('Release verification crashed:', error.message || error);
  process.exit(1);
});
