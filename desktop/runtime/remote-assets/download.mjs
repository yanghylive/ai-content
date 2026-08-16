#!/usr/bin/env node
// 远程资源下载器（remote-assets）：拉取 client-config → 检查本地资源版本 → 按需下载 zip → 校验 sha256 → 解压原子替换
// 用法：
//   node download.mjs --config-url http://127.0.0.1:3011/api/commercial/client-config --resource wechatOcr --target <dir>
//   node download.mjs --url <zipUrl> --version <v> [--sha256 <hex>] --target <dir>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const readArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : '';
};

const configUrl = readArg('--config-url');
const resourceName = readArg('--resource');
const directUrl = readArg('--url');
const directVersion = readArg('--version');
const directSha = readArg('--sha256');
const target = readArg('--target');

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

if (!target) fail('缺少 --target');
if (!configUrl && !directUrl) fail('需要 --config-url 或 --url');

// 1. 解析资源规格
let spec;
if (directUrl) {
  spec = { url: directUrl, version: directVersion || '1.0.0', sha256: directSha || '' };
} else {
  try {
    const res = await fetch(configUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) fail(`拉取配置失败 HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    const resource = data?.resources?.[resourceName];
    if (!resource?.url) fail(`配置中缺少资源 ${resourceName}（url 为空，请先在配置中心设置）`);
    spec = resource;
  } catch (error) {
    fail(`拉取配置异常: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 2. 检查本地版本
const versionFile = join(target, 'version.json');
const localVersion = existsSync(versionFile)
  ? (JSON.parse(readFileSync(versionFile, 'utf8'))?.version || '')
  : '';
if (localVersion === spec.version && existsSync(target)) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: 'already-up-to-date', version: spec.version }));
  process.exit(0);
}

// 3. 下载 + 校验
mkdirSync(target, { recursive: true });
// tmpDir 放系统临时目录（不能在 target 内，否则清空 target 时会自删）
const tmpDir = join(tmpdir(), `ai-content-asset-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
const zipPath = join(tmpDir, 'asset.zip');

try {
  console.error(`[remote-assets] downloading ${spec.url} -> ${zipPath}`);
  const res = await fetch(spec.url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) fail(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 供应链完整性：从配置中心拉取的资源必须带 sha256，缺失即拒绝下载（防篡改来源）。
  // 手动 --url 调试模式仍允许省略 sha256。
  if (configUrl && !spec.sha256) {
    fail(`资源 ${resourceName} 缺少 sha256，拒绝下载（配置必须提供校验值）`);
  }
  if (spec.sha256) {
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual.toLowerCase() !== spec.sha256.toLowerCase()) {
      fail(`sha256 校验失败: 期望 ${spec.sha256} 实际 ${actual}`);
    }
  }
  writeFileSync(zipPath, buf);
  console.error(`[remote-assets] downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // 4. 解压（zip 平铺到 tmp，再原子替换到 target）
  const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', tmpDir], { encoding: 'utf8' });
  console.error(`[remote-assets] unzip status=${unzip.status} error=${unzip.error || 'none'} tmpDir=${tmpDir}`);
  if (unzip.status !== 0) {
    // 兜底：7z / tar
    const unzip7z = spawnSync('7z', ['x', '-y', `-o${tmpDir}`, zipPath], { encoding: 'utf8' });
    if (unzip7z.status !== 0) {
      const unzipTar = spawnSync('tar', ['-xf', zipPath, '-C', tmpDir], { encoding: 'utf8' });
      if (unzipTar.status !== 0) fail(`解压失败: ${unzip.stderr || unzip7z.stderr || unzipTar.stderr || 'unknown'}`);
    }
  }
  rmSync(zipPath, { force: true });

  // 5. 原子替换：清空 target 后移入
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(target).catch(() => [])) {
    rmSync(join(target, entry), { recursive: true, force: true });
  }
  for (const entry of await readdir(tmpDir)) {
    renameSync(join(tmpDir, entry), join(target, entry));
  }
  writeFileSync(join(target, 'version.json'), JSON.stringify({ version: spec.version, updatedAt: new Date().toISOString() }), 'utf8');
  rmSync(tmpDir, { recursive: true, force: true });

  console.log(JSON.stringify({ ok: true, skipped: false, version: spec.version, target }));
} catch (error) {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  fail(`下载/解压异常: ${error instanceof Error ? error.message : String(error)}`);
}
