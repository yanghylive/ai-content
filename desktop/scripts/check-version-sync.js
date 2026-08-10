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
        path.join(repoRoot, 'frontend/src/app/(dashboard)/layout.tsx'),
        /DESKTOP_APP_VERSION\s*=\s*["']([^"']+)["']/,
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
