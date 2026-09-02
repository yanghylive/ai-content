#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function versionFromSource(filePath, pattern, label) {
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(pattern);
  if (!match) throw new Error(`${label} does not declare a product version`);
  return match[1];
}

function main() {
  const pkg = readJson(path.join(desktopRoot, 'package.json'));
  const lock = readJson(path.join(desktopRoot, 'package-lock.json'));
  const packager = readJson(path.join(desktopRoot, 'packager.json'));
  const expected = String(pkg.version || '').trim();

  if (!/^\d+\.\d+\.\d+$/.test(expected)) {
    throw new Error(`desktop/package.json has an invalid product version: ${expected || '<empty>'}`);
  }

  const observed = [
    ['desktop/package-lock.json', lock.version],
    ['desktop/package-lock.json root package', lock.packages?.['']?.version],
    ['desktop/packager.json', packager.version],
    [
      'frontend dashboard version',
      versionFromSource(
        // 2026-08-27：DESKTOP_APP_VERSION 随 design 重构迁至 release-notes.ts（layout.tsx 改 import），守卫同步指向新 SSOT
        path.join(repoRoot, 'frontend/src/lib/release-notes.ts'),
        /export const DESKTOP_APP_VERSION\s*=\s*["']([^"']+)["']/,
        'frontend dashboard',
      ),
    ],
    [
      'frontend release notes version',
      versionFromSource(
        path.join(repoRoot, 'frontend/src/app/(dashboard)/release-notes/page.tsx'),
        /currentVersion\s*=\s*["']([^"']+)["']/,
        'frontend release notes',
      ),
    ],
  ];

  const mismatches = observed.filter(([, version]) => version !== expected);
  if (mismatches.length > 0) {
    const detail = mismatches
      .map(([label, version]) => `${label}=${version || '<empty>'}`)
      .join(', ');
    throw new Error(`product version mismatch; expected ${expected}: ${detail}`);
  }

  const releaseNotesFile = String(pkg.build?.releaseInfo?.releaseNotesFile || '').trim();
  if (!releaseNotesFile) {
    throw new Error('desktop build.releaseInfo.releaseNotesFile is required');
  }
  const releaseNotesPath = path.resolve(desktopRoot, releaseNotesFile);
  if (!releaseNotesPath.startsWith(`${desktopRoot}${path.sep}`)) {
    throw new Error('release notes file must stay inside the desktop project');
  }
  const releaseNotes = fs.readFileSync(releaseNotesPath, 'utf8').trim();
  if (!releaseNotes) throw new Error(`${releaseNotesFile} is empty`);

  // 2026-09-02（复核第七轮 P2）：标题一致性——release-notes.md 首个版本标题
  // 必须等于当前包版本（原门禁只查非空，导致 1.1.112 发布物带着
  // "## v1.1.111" 标题上线的假成功）。
  const firstHeading = releaseNotes.match(/^##\s+v?(\d+\.\d+\.\d+)/m);
  if (!firstHeading) {
    throw new Error(
      `${releaseNotesFile} 首个标题缺少版本号（期望 "## v${expected}（…）"）`,
    );
  }
  if (firstHeading[1] !== expected) {
    throw new Error(
      `${releaseNotesFile} 首标题版本 v${firstHeading[1]} 与包版本 v${expected} 不一致`,
    );
  }

  console.log(
    `Version sync passed: v${expected}; updater notes=${path.relative(desktopRoot, releaseNotesPath)}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`Version sync blocked: ${error.message}`);
  process.exit(1);
}
