const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  buildUploadPlan,
  normalizeFeedReference,
  orderUploadFiles,
  parseFeedReferences,
} = require('./release-feed-plan');

test('feed references normalize URL and path values', () => {
  assert.equal(
    normalizeFeedReference('https://updates.example.test/updates/My%20App-1.2.3.exe'),
    'My App-1.2.3.exe',
  );
  assert.deepEqual(
    [...parseFeedReferences('path: ./My App-1.2.3.exe\nfiles:\n  - url: My App-1.2.3.exe')],
    ['My App-1.2.3.exe'],
  );
});

test('upload plan sends packages, blockmaps, then feeds and fails on missing references', () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-plan-'));
  try {
    fs.writeFileSync(
      path.join(distDir, 'latest.yml'),
      'version: 1.2.3\npath: App Setup 1.2.3.exe\nfiles:\n  - url: App Setup 1.2.3.exe\n',
    );
    fs.writeFileSync(path.join(distDir, 'App Setup 1.2.3.exe'), 'installer');
    fs.writeFileSync(path.join(distDir, 'App Setup 1.2.3.exe.blockmap'), 'blockmap');
    fs.writeFileSync(path.join(distDir, 'latest-mac.yml'), 'version: 1.2.3\npath: missing.zip\n');

    const failedPlan = buildUploadPlan({ distDir });
    assert.deepEqual(failedPlan.missing, ['missing.zip']);

    fs.rmSync(path.join(distDir, 'latest-mac.yml'));
    const plan = buildUploadPlan({ distDir });
    assert.deepEqual(plan.files, [
      'App Setup 1.2.3.exe',
      'App Setup 1.2.3.exe.blockmap',
      'latest.yml',
    ]);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test('Linux feed does not require a non-native blockmap', () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-linux-'));
  try {
    fs.writeFileSync(
      path.join(distDir, 'latest-linux.yml'),
      'version: 1.2.3\npath: app-1.2.3.AppImage\n',
    );
    fs.writeFileSync(path.join(distDir, 'app-1.2.3.AppImage'), 'appimage');
    const plan = buildUploadPlan({ distDir });
    assert.deepEqual(plan.missing, []);
    assert.deepEqual(plan.files, ['app-1.2.3.AppImage', 'latest-linux.yml']);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test('upload ordering is deterministic for multiple platform artifacts', () => {
  assert.deepEqual(
    orderUploadFiles(['latest-mac.yml', 'z.exe.blockmap', 'a.zip', 'latest.yml', 'z.exe']),
    ['a.zip', 'z.exe', 'z.exe.blockmap', 'latest.yml', 'latest-mac.yml'],
  );
});
