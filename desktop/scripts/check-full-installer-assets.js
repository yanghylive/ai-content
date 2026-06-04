#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const sidecarsRoot = path.join(desktopRoot, 'sidecars');
const autoUploadRoot = path.join(sidecarsRoot, 'auto-upload');
const agentSRoot = path.join(sidecarsRoot, 'agent-s-executor');
const distResourcesRoot = path.join(desktopRoot, 'dist', 'win-unpacked', 'resources');
const appAsarPath = path.join(distResourcesRoot, 'app.asar');

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='));
const phase = phaseArg ? phaseArg.split('=')[1] : 'post';

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

  for (const depName of ['python', 'postgres']) {
    const dep = manifest.deps?.[depName];
    if (!dep) {
      fail(`installer manifest missing dep: ${depName}`);
      continue;
    }
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

  for (const depName of ['python', 'postgres']) {
    const dep = manifest.deps[depName];
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
  const normalized = entryPath.startsWith('/') ? entryPath : `/${entryPath}`;
  if (!entries.has(normalized)) {
    fail(`${label}: ${entryPath}`);
  }
}

function finish() {
  if (failed) {
    console.error('');
    console.error('Windows Full Installer asset check failed.');
    process.exit(1);
  }

  console.log(`Windows Full Installer asset check passed (${phase}).`);
}

function checkPreBuildAssets() {
  const requiredSources = [
    ['desktop main entry', path.join(desktopRoot, 'main.js')],
    ['desktop icon', path.join(desktopRoot, 'assets', 'icon.ico')],
    ['electron-store dependency', path.join(desktopRoot, 'node_modules', 'electron-store', 'package.json')],
    ['fix-path dependency', path.join(desktopRoot, 'node_modules', 'fix-path', 'package.json')],
    ['backend bundle', path.join(repoRoot, 'backend', 'dist-bundle', 'index.js')],
    ['frontend static export', path.join(repoRoot, 'frontend', 'out', 'index.html')],
    ['frontend Next assets', path.join(repoRoot, 'frontend', 'out', '_next')],
    ['auto-upload entry', path.join(autoUploadRoot, 'main.py')],
    ['auto-upload requirements', path.join(autoUploadRoot, 'requirements.txt')],
    ['Agent-S sidecar entry', path.join(agentSRoot, 'main.py')],
    ['Agent-S sidecar requirements', path.join(agentSRoot, 'requirements.txt')],
    ['Prisma Windows query engine', path.join(repoRoot, 'backend', 'node_modules', '.prisma', 'client', 'query_engine-windows.dll.node')],
  ];

  for (const [label, filePath] of requiredSources) {
    assertPath(label, filePath);
  }

  assertFileContains(
    'desktop backend DATABASE_URL',
    path.join(desktopRoot, 'backend.env'),
    /^DATABASE_URL=postgresql:\/\/postgres:ai_content_2026@127\.0\.0\.1:5432\/ai_content/m
  );

  assertFileContains(
    'frontend API base',
    path.join(repoRoot, 'frontend', 'out', '_next', 'static', 'chunks', '28475f51f1d8ba2d.js'),
    /http:\/\/localhost:3011\/api|http:\/\/127\.0\.0\.1:3011\/api/
  );

  assertInstallerManifest(path.join(desktopRoot, 'installer', 'deps-manifest.json'));
  assertFileContains(
    'NSIS delegates dependency preflight to install assistant',
    path.join(desktopRoot, 'installer.nsh'),
    /外层 KaypalAI 安装助手负责依赖检测\/安装/
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
    'dependency detector must not require Node Redis or Chrome',
    path.join(desktopRoot, 'installer', 'detect-deps.ps1'),
    /Test-Node|Test-Redis|Test-Chrome|DetectedDeps\["node"\]|DetectedDeps\["redis"\]|DetectedDeps\["chrome"\]/
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
          ['app icon', 'assets/icon.ico'],
          ['electron-store dependency', 'node_modules/electron-store'],
          ['fix-path dependency', 'node_modules/fix-path'],
        ];

        for (const [label, entryPath] of requiredAsarEntries) {
          assertAsarEntry(entries, label, entryPath);
        }
      }
    }
  }

  const requiredResources = [
    ['backend resource', path.join(distResourcesRoot, 'backend', 'index.js')],
    ['backend env', path.join(distResourcesRoot, 'backend', '.env')],
    ['Prisma Windows query engine', path.join(distResourcesRoot, 'backend', 'client', 'query_engine-windows.dll.node')],
    ['backend Prisma migrations', path.join(distResourcesRoot, 'backend', 'prisma', 'migrations')],
    ['frontend resource', path.join(distResourcesRoot, 'frontend', 'index.html')],
    ['frontend Next assets', path.join(distResourcesRoot, 'frontend', '_next')],
    ['auto-upload resource', path.join(distResourcesRoot, 'auto-upload', 'main.py')],
    ['auto-upload requirements resource', path.join(distResourcesRoot, 'auto-upload', 'requirements.txt')],
    ['Agent-S sidecar resource', path.join(distResourcesRoot, 'agent-s-executor', 'main.py')],
    ['Agent-S sidecar requirements resource', path.join(distResourcesRoot, 'agent-s-executor', 'requirements.txt')],
    ['installer bootstrap resource', path.join(distResourcesRoot, 'installer', 'bootstrap-installer.ps1')],
    ['installer Postgres init resource', path.join(distResourcesRoot, 'installer', 'init-postgres.ps1')],
    ['installer self-check resource', path.join(distResourcesRoot, 'installer', 'self-check.ps1')],
    ['installer manifest resource', path.join(distResourcesRoot, 'installer', 'deps-manifest.json')],
  ];

  for (const [label, filePath] of requiredResources) {
    assertPath(label, filePath);
  }

  assertFileContains(
    'packaged backend DATABASE_URL',
    path.join(distResourcesRoot, 'backend', '.env'),
    /^DATABASE_URL=postgresql:\/\/postgres:ai_content_2026@127\.0\.0\.1:5432\/ai_content/m
  );

  assertInstallerManifest(path.join(distResourcesRoot, 'installer', 'deps-manifest.json'));
  assertNoPath('installer bundled deps', path.join(distResourcesRoot, 'installer', 'deps'));
  assertNoPath('auto-upload venv', path.join(distResourcesRoot, 'auto-upload', '.venv'));
  assertNoPath('auto-upload browser profiles', path.join(distResourcesRoot, 'auto-upload', 'browser-profiles'));
  assertNoPath('auto-upload cookies', path.join(distResourcesRoot, 'auto-upload', 'cookiesFile'));
  assertNoPath('auto-upload logs', path.join(distResourcesRoot, 'auto-upload', 'logs'));
  assertNoPath('auto-upload user db', path.join(distResourcesRoot, 'auto-upload', 'db'));
  assertNoPath('Agent-S venv', path.join(distResourcesRoot, 'agent-s-executor', '.venv'));
  assertNoPath('Agent-S smoke data', path.join(distResourcesRoot, 'agent-s-executor', 'data-smoke-real'));
  assertNoPath('Agent-S temp data', path.join(distResourcesRoot, 'agent-s-executor', '.tmp'));

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
