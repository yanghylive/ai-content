// extraResources matcher 回归测试（2026-08-31 复核 P0 修复配套）
//
// 背景：v1.1.110 复核打回——electron-builder 的 extraResources 不做自动去重，
// 公共块 filter 含 @img/**/* 与 mac/win 平台专用 @img/sharp-* 目标重叠，
// 导致 mac EEXIST @img/sharp-libvips-darwin-arm64/package.json、
// win EEXIST @img/sharp-win32-x64/package.json（GitHub run 33374468124 实证）。
// 修复：删除 mac/win 两组 @img 专用资源，只保留公共 @img/**/* 一次；.prisma/client 平台专用保留。
// 本测试锁死该约束，防止父子目录目标重叠回潮。
const assert = require('assert/strict');
const path = require('path');
const test = require('node:test');

const PKG_PATH = path.join(__dirname, '..', 'package.json');
const pkg = require(PKG_PATH);

function platformTargets(platform) {
  const build = pkg.build;
  const platformConfig = build[platform];
  const platformResources = (platformConfig && platformConfig.extraResources) || [];
  const commonResources = build.extraResources || [];
  return platformResources.concat(commonResources).map((r) => String(r.to || ''));
}

test('extraResources targets are unique per platform (no parent/child overlap)', () => {
  for (const platform of ['mac', 'win']) {
    const targets = platformTargets(platform);
    const seen = new Set();
    const duplicates = targets.filter((t) => (seen.has(t) ? true : (seen.add(t), false)));
    assert.deepEqual(
      duplicates,
      [],
      `${platform}: extraResources 目标重叠 → electron-builder 复制时 EEXIST：${duplicates.join(', ')}`,
    );
  }
});

test('sharp variants are covered once by the common @img/**/* matcher only', () => {
  const build = pkg.build;
  const common = build.extraResources || [];
  const commonNodeModules = common.find((r) => String(r.to) === 'backend/node_modules');
  assert.ok(commonNodeModules, '缺少公共 backend/node_modules extraResources 块');
  assert.ok(
    (commonNodeModules.filter || []).includes('@img/**/*'),
    '公共块必须保留 @img/**/* matcher（sharp 四个变体由根部一次覆盖）',
  );
  // 平台专用块不得再出现 @img 目标（与公共块重叠的根源）
  for (const platform of ['mac', 'win']) {
    const platformConfig = build[platform] || {};
    const platformResources = platformConfig.extraResources || [];
    for (const r of platformResources) {
      assert.ok(
        !String(r.to).includes('@img'),
        `${platform}: 平台专用 extraResources 不得再复制 @img（目标 ${r.to} 与公共 @img/**/* 重叠）`,
      );
    }
  }
});

test('.prisma/client platform-specific resources are preserved', () => {
  for (const platform of ['mac', 'win']) {
    const platformConfig = pkg.build[platform] || {};
    const resources = platformConfig.extraResources || [];
    const prisma = resources.find((r) => String(r.from).includes('.prisma/client'));
    assert.ok(prisma, `${platform}: 必须保留 .prisma/client 平台专用资源`);
    assert.equal(String(prisma.to), 'backend/client');
    assert.ok((prisma.filter || []).length > 0, `${platform}: .prisma/client filter 不能为空`);
  }
});
