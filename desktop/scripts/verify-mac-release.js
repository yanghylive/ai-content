#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const distDir = path.join(desktopRoot, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const remote = process.argv.includes('--remote');
const failures = [];

function fail(message) {
  failures.push(message);
}

// macOS 微信工具链资源契约：extraResources 配置 + main.js env 注入
function verifyWechatResourceContract() {
  const extraResources = [
    ...(pkg.build?.extraResources || []),
    ...(pkg.build?.mac?.extraResources || []),
  ];
  const findResource = (to) => extraResources.find((item) => item?.to === to);
  const assertResource = (to, label) => {
    const resource = findResource(to);
    if (!resource) {
      fail(`desktop/package.json build.extraResources missing ${to} (${label})`);
      return null;
    }
    return resource;
  };
  const assertFilter = (resource, expectedFilter, label) => {
    const filters = Array.isArray(resource.filter) ? resource.filter : [];
    if (!filters.includes(expectedFilter)) {
      fail(`desktop/package.json ${resource.to} extraResource filter must include ${expectedFilter} (${label})`);
    }
  };

  // 1. wechat-macos 工具链（bin）
  const macBin = assertResource('wechat-macos', 'macOS 微信工具链 bin');
  if (macBin) {
    assertFilter(macBin, 'bin/**/*', 'macOS 微信工具链');
  }
  // 2. wechat-macos/skillhub（vendor 技能脚本）
  const macSkillhub = assertResource('wechat-macos/skillhub', 'macOS 微信技能脚本');
  if (macSkillhub) {
    assertFilter(macSkillhub, 'wechat-*/**/*', 'macOS 微信技能脚本');
  }
  // 3. wechat-native-runners（命令 runner）
  assertResource('wechat-native-runners', '微信命令 runner');
  // 4. 其余 wechat 资源（与 Windows 共用）
  // wechat-ocr（RapidOcrOnnx.exe Windows PE）已迁至 build.win.extraResources：
  // Mac 走 wechat-macos/bin 原生 OCR 链路，Windows-only 引擎不再打进 Mac 包。
  // wechat-db-helper 按 OSS 按需下发设计不打包（对齐 verify-oss-release.js 断言）。
  for (const to of ['wechat-engine', 'wechat-native-runtime']) {
    assertResource(to, `微信资源 ${to}`);
  }
  // 5. media-tools（ffmpeg/ffprobe 视频处理硬依赖，mac/win 都需打包）
  assertResource('media-tools', '媒体工具（ffmpeg/ffprobe）');

  // 5. main.js 注入 KAYPAL_WECHAT_COMMAND_ROOT（macOS 打包后定位 wechat-macos/bin）
  const mainJs = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
  if (!/KAYPAL_WECHAT_COMMAND_ROOT/.test(mainJs)) {
    fail('desktop/main.js must inject KAYPAL_WECHAT_COMMAND_ROOT into backend env');
  }
  if (!/getResourcePath\(['"]wechat-macos['"]\)/.test(mainJs)) {
    fail('desktop/main.js must resolve packaged wechat-macos from resources');
  }
  // 6. macOS 微信工具链源目录存在
  const macBinRoot = path.join(desktopRoot, 'runtime', 'wechat-macos', 'bin');
  for (const tool of ['cliclick', 'wechat-contact-sync', 'wechat-chat-history', 'kaypal-pointer.jxa']) {
    if (!fs.existsSync(path.join(macBinRoot, tool))) {
      fail(`missing source macOS wechat tool: runtime/wechat-macos/bin/${tool}`);
    }
  }
  // 7. macOS 通讯录同步脚本源存在
  const contactSyncScript = path.join(
    desktopRoot,
    '..',
    'vendor',
    'skillhub',
    'wechat-contact-sync',
    'wechat-contact-sync.py',
  );
  if (!fs.existsSync(contactSyncScript)) {
    fail(`missing source macOS wechat contact sync script: ${contactSyncScript}`);
  }
}

function parseLatest(content) {
  const pick = (pattern) => content.match(pattern)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
  return {
    version: pick(/^version:\s*([^\r\n#]+)/m),
    path: pick(/^path:\s*([^\r\n#]+)/m),
    sha512: pick(/^sha512:\s*([^\r\n#]+)/m),
    size: Number(pick(/^\s*size:\s*([0-9]+)/m)),
  };
}

function sha512(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function request(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => req.destroy(new Error(`request timeout: ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  verifyWechatResourceContract();

  const metadataPath = path.join(distDir, 'latest-mac.yml');
  if (!fs.existsSync(metadataPath)) {
    fail(`missing ${metadataPath}`);
  }
  const latest = parseLatest(fs.existsSync(metadataPath) ? fs.readFileSync(metadataPath, 'utf8') : '');
  if (latest.version !== pkg.version) fail(`latest-mac version ${latest.version} != ${pkg.version}`);
  if (!latest.path) fail('latest-mac.yml is missing path');

  const artifactPath = path.join(distDir, latest.path);
  if (!fs.existsSync(artifactPath)) {
    fail(`missing macOS artifact: ${artifactPath}`);
  } else {
    const size = fs.statSync(artifactPath).size;
    if (size !== latest.size) fail(`artifact size ${size} != metadata ${latest.size}`);
    if (sha512(artifactPath) !== latest.sha512) fail('artifact sha512 does not match latest-mac.yml');
  }
  if (!fs.existsSync(`${artifactPath}.blockmap`)) fail(`missing blockmap: ${artifactPath}.blockmap`);

  if (remote && failures.length === 0) {
    const config = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, 'runtime', 'generated', 'release-config.json'), 'utf8'),
    );
    const baseUrl = `${config.updateUrl.replace(/\/+$/, '')}/`;
    const metadataUrl = new URL('latest-mac.yml', baseUrl).toString();
    const remoteMetadata = await request(metadataUrl);
    if (remoteMetadata.status !== 200) fail(`remote latest-mac.yml HTTP ${remoteMetadata.status}`);
    const remoteLatest = parseLatest(remoteMetadata.body);
    if (JSON.stringify(remoteLatest) !== JSON.stringify(latest)) {
      fail('remote latest-mac.yml does not match the local metadata');
    }
    const remoteArtifact = await request(new URL(encodeURI(latest.path), baseUrl), 'HEAD');
    if (remoteArtifact.status !== 200) fail(`remote artifact HTTP ${remoteArtifact.status}`);
    if (Number(remoteArtifact.headers['content-length']) !== latest.size) {
      fail('remote artifact size does not match latest-mac.yml');
    }
  }

  if (failures.length > 0) {
    console.error('macOS release verification failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`macOS release verification passed (${remote ? 'remote' : 'local'}): v${pkg.version}`);
}

main().catch((error) => {
  console.error(`macOS release verification crashed: ${error.message}`);
  process.exit(1);
});
