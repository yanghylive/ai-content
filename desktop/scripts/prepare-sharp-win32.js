#!/usr/bin/env node
/**
 * 跨平台补齐 sharp Win 平台原生包（审计 #8 配套）
 *
 * 背景：
 *  sharp 0.35.3 把 Windows 原生包 `@img/sharp-win32-x64` 标了 `os:["win32"]`；
 *  因此在 macOS 上 `npm install` 会跳过它，desktop 打包也带不上。
 *  但 `check-package-contents.js` 要求 4 个 @img/sharp-* 变体都进入安装包
 *  （Mac 安装包也会被检查——因为同一份后端 bundle 会被两个平台共用）。
 *
 * 解决：
 *  这个脚本在每次打 Mac/Win 安装包前，从 npm registry 拉取 win32-x64 包
 *  直接解到 backend/node_modules/@img/，让 electron-builder 把它们打进去。
 *  Windows 真机构建时该目录已天然存在，脚本等价 no-op（已就位就跳过）。
 *
 * 用法：
 *   node scripts/prepare-sharp-win32.js                # 默认目标 backend/node_modules/@img
 *   node scripts/prepare-sharp-win32.js --check        # 只检查不解压（CI 用）
 *
 * 退出码：
 *   0 = 已就位或本次补齐成功
 *   1 = 网络失败 / 包结构异常
 */
const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { URL } = require('node:url');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const backendRoot = path.join(repoRoot, 'backend');
const targetDir = path.join(backendRoot, 'node_modules', '@img');

/** 与 backend/package.json optionalDependencies 对齐（两者必须保持一致） */
const WIN32_PACKAGES = [
  { name: '@img/sharp-win32-x64', version: '0.35.3' },
  { name: '@img/sharp-libvips-win32-x64', version: '1.3.2' },
];

/**
 * 2026-08-31（CI run 33393818145 实证）：Windows CI 上 npm 装不出 darwin 可选依赖，
 * 打出的 win 包缺 @img/sharp-darwin-arm64 / sharp-libvips-darwin-arm64 →
 * check-package-contents 四变体检查失败。win 构建时同样从 registry 补齐
 * （与 sharp@0.35.3 自带 optionalDependencies 版本一致；mac 构建天然就位，no-op）。
 */
const DARWIN_PACKAGES = [
  { name: '@img/sharp-darwin-arm64', version: '0.35.3' },
  { name: '@img/sharp-libvips-darwin-arm64', version: '1.3.2' },
];

const checkOnly = process.argv.includes('--check');

function registryMeta(pkg, ver) {
  return new Promise((resolve, reject) => {
    const u = new URL(`https://registry.npmjs.org/${pkg}/${ver}`);
    https
      .get(u, (r) => {
        if (r.statusCode !== 200) {
          reject(new Error(`${pkg}@${ver} registry returned ${r.statusCode}`));
          return;
        }
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadTarball(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (r) => {
        if (r.statusCode === 302 || r.statusCode === 301) {
          return downloadTarball(r.headers.location, dest).then(resolve, reject);
        }
        if (r.statusCode !== 200) {
          reject(new Error(`download ${url} -> ${r.statusCode}`));
          return;
        }
        const f = fs.createWriteStream(dest);
        r.pipe(f);
        f.on('finish', () => f.close(() => resolve(dest)));
        f.on('error', reject);
      })
      .on('error', reject);
  });
}

function ensureOne(pkg, ver) {
  const pkgDir = path.join(targetDir, pkg.split('/')[1]);
  const pkgJson = path.join(pkgDir, 'package.json');
  if (fs.existsSync(pkgJson)) {
    try {
      const cur = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
      if (cur === ver) {
        console.log(`✓ ${pkg}@${ver} 已就位（无需下载）`);
        return Promise.resolve();
      }
      console.log(`↺ ${pkg} 版本不匹配（本地 ${cur}，期望 ${ver}），覆盖`);
      fs.rmSync(pkgDir, { recursive: true, force: true });
    } catch {
      /* corrupt, redownload */
    }
  }
  if (checkOnly) {
    console.error(`✗ ${pkg}@${ver} 缺失（--check 模式，不补齐）`);
    process.exitCode = 1;
    return Promise.resolve();
  }
  console.log(`↓ 下载 ${pkg}@${ver}…`);
  return registryMeta(pkg, ver).then((meta) => {
    if (!meta.dist || !meta.dist.tarball) {
      throw new Error(`${pkg}@${ver} metadata 无 tarball`);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sharp-win32-'));
    const tarPath = path.join(tmp, 'pkg.tgz');
    return downloadTarball(meta.dist.tarball, tarPath).then(() => {
      fs.mkdirSync(pkgDir, { recursive: true });
      const r = spawnSync('tar', ['-xzf', tarPath, '-C', pkgDir, '--strip-components=1'], {
        stdio: 'inherit',
      });
      fs.rmSync(tmp, { recursive: true, force: true });
      if (r.status !== 0) throw new Error(`tar 解压失败：${r.status}`);
      console.log(`✓ ${pkg}@${ver} 已解压到 ${pkgDir}`);
    });
  });
}

(async () => {
  fs.mkdirSync(targetDir, { recursive: true });
  const targets = process.platform === 'win32' ? [...WIN32_PACKAGES, ...DARWIN_PACKAGES] : WIN32_PACKAGES;
  let ok = true;
  for (const p of targets) {
    try {
      await ensureOne(p.name, p.version);
    } catch (e) {
      console.error(`✗ ${p.name}@${p.version} 失败：${e.message}`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log(checkOnly ? '\n[--check] 完整性检查完成' : '\n✓ sharp 平台原生包补齐完成');
})();