#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const backendRoot = path.join(repoRoot, 'backend');
const backendRequire = createRequire(path.join(backendRoot, 'package.json'));
const outputRoot = path.join(desktopRoot, 'runtime', 'media-tools');
const EFFING_RELEASE = 'v6.1.5';
const EFFING_PACKAGE = '@effing/ffmpeg@0.39.0';
const EFFING_BASE_URL =
  `https://github.com/builtbyfew/effing-ffmpeg-builds/releases/download/${EFFING_RELEASE}`;

const TARGETS = {
  'mac-arm64': {
    nodePlatform: 'darwin',
    nodeArch: 'arm64',
    effingKey: 'darwin-arm64',
    executableSuffix: '',
    ffprobePackage: '@ffprobe-installer/darwin-arm64@5.0.1',
    ffprobeVersion: '4.4.1',
    ffprobeLicense: 'LGPL-2.1-or-later',
    ffprobeBuildSourceUrl: 'https://formulae.brew.sh/formula/ffmpeg',
    ffprobeUpstreamSourceUrl: 'https://ffmpeg.org/releases/ffmpeg-4.4.1.tar.xz',
  },
  'mac-x64': {
    nodePlatform: 'darwin',
    nodeArch: 'x64',
    effingKey: 'darwin-x64',
    executableSuffix: '',
    ffprobePackage: '@ffprobe-installer/darwin-x64@5.1.0',
    ffprobeVersion: '20230213-f8d6d0f',
    ffprobeLicense: 'GPL-3.0-or-later',
    ffprobeBuildSourceUrl: 'https://evermeet.cx/ffmpeg/',
    ffprobeUpstreamSourceUrl: 'https://ffmpeg.org/download.html#get-sources',
  },
  'win-x64': {
    nodePlatform: 'win32',
    nodeArch: 'x64',
    effingKey: 'win32-x64',
    executableSuffix: '.exe',
    ffprobePackage: '@ffprobe-installer/win32-x64@5.1.0',
    ffprobeVersion: '20230213-2296078',
    ffprobeLicense: 'GPL-3.0-or-later',
    ffprobeBuildSourceUrl: 'https://github.com/GyanD/codexffmpeg',
    ffprobeUpstreamSourceUrl: 'https://ffmpeg.org/download.html#get-sources',
  },
  'linux-x64': {
    nodePlatform: 'linux',
    nodeArch: 'x64',
    effingKey: 'linux-x64',
    executableSuffix: '',
    ffprobePackage: '@ffprobe-installer/linux-x64@5.2.0',
    ffprobeVersion: '20230213-2296078',
    ffprobeLicense: 'GPL-3.0-or-later',
    ffprobeBuildSourceUrl: 'https://johnvansickle.com/ffmpeg/',
    ffprobeUpstreamSourceUrl: 'https://ffmpeg.org/download.html#get-sources',
  },
};

function defaultBuildPlatform() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  }
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  return `${process.platform}-${process.arch}`;
}

function sha256(bufferOrPath) {
  const hash = createHash('sha256');
  if (Buffer.isBuffer(bufferOrPath)) {
    hash.update(bufferOrPath);
  } else {
    hash.update(fs.readFileSync(bufferOrPath));
  }
  return hash.digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || desktopRoot,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return `${result.stdout || ''}`;
}

function download(url, redirects = 0) {
  if (redirects > 5) throw new Error(`too many redirects for ${url}`);
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          resolve(download(response.headers.location, redirects + 1));
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode || 'unknown'} for ${url}`));
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      })
      .on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error(`download timed out for ${url}`));
    });
  });
}

function effingPackageRoot() {
  const entry = backendRequire.resolve('@effing/ffmpeg');
  return path.resolve(path.dirname(entry), '..');
}

async function resolveFfmpeg(target, tempRoot) {
  const explicit = process.env.KAYPAL_FFMPEG_BINARY;
  if (explicit) {
    return {
      path: path.resolve(explicit),
      version: process.env.KAYPAL_FFMPEG_VERSION || 'externally-supplied',
      sourcePackage:
        process.env.KAYPAL_FFMPEG_SOURCE_PACKAGE || 'KAYPAL_FFMPEG_BINARY',
      binarySourceUrl: process.env.KAYPAL_FFMPEG_SOURCE_URL || '',
      buildSourceUrl:
        process.env.KAYPAL_FFMPEG_BUILD_SOURCE_URL ||
        `https://github.com/builtbyfew/effing-ffmpeg-builds/tree/${EFFING_RELEASE}`,
      upstreamSourceUrl:
        process.env.KAYPAL_FFMPEG_UPSTREAM_SOURCE_URL ||
        `https://ffmpeg.org/releases/ffmpeg-${EFFING_RELEASE.slice(1)}.tar.xz`,
    };
  }

  const hostMatches =
    process.platform === target.nodePlatform && process.arch === target.nodeArch;
  if (hostMatches) {
    const { pathToFFmpeg } = backendRequire('@effing/ffmpeg');
    if (!pathToFFmpeg) throw new Error(`${EFFING_PACKAGE} did not install ffmpeg`);
    return {
      path: pathToFFmpeg,
      version: EFFING_RELEASE.slice(1),
      sourcePackage: EFFING_PACKAGE,
      binarySourceUrl: `${EFFING_BASE_URL}/ffmpeg-${target.effingKey}.gz`,
      buildSourceUrl: `https://github.com/builtbyfew/effing-ffmpeg-builds/tree/${EFFING_RELEASE}`,
      upstreamSourceUrl: `https://ffmpeg.org/releases/ffmpeg-${EFFING_RELEASE.slice(1)}.tar.xz`,
    };
  }

  const checksums = JSON.parse(
    fs.readFileSync(path.join(effingPackageRoot(), 'checksums.json'), 'utf8'),
  );
  const expected = checksums[target.effingKey];
  if (!expected) {
    throw new Error(`${EFFING_PACKAGE} has no checksum for ${target.effingKey}`);
  }
  const binarySourceUrl = `${EFFING_BASE_URL}/ffmpeg-${target.effingKey}.gz`;
  const compressed = await download(binarySourceUrl);
  const binary = zlib.gunzipSync(compressed);
  const actual = sha256(binary);
  if (actual !== expected) {
    throw new Error(`ffmpeg checksum mismatch for ${target.effingKey}`);
  }
  const tempPath = path.join(tempRoot, `ffmpeg${target.executableSuffix}`);
  fs.writeFileSync(tempPath, binary, { mode: 0o755 });
  return {
    path: tempPath,
    version: EFFING_RELEASE.slice(1),
    sourcePackage: EFFING_PACKAGE,
    binarySourceUrl,
    buildSourceUrl: `https://github.com/builtbyfew/effing-ffmpeg-builds/tree/${EFFING_RELEASE}`,
    upstreamSourceUrl: `https://ffmpeg.org/releases/ffmpeg-${EFFING_RELEASE.slice(1)}.tar.xz`,
  };
}

function findFile(root, fileName) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name === fileName) return fullPath;
    }
  }
  return null;
}

function materializeNpmPackage(packageSpec, fileName, tempRoot) {
  const packRoot = fs.mkdtempSync(path.join(tempRoot, 'npm-pack-'));
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const stdout = run(
    npmCommand,
    ['pack', packageSpec, '--pack-destination', packRoot, '--ignore-scripts'],
    { cwd: backendRoot },
  );
  const tarballName = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();
  if (!tarballName) throw new Error(`npm pack did not return a tarball for ${packageSpec}`);
  const tarballPath = path.join(packRoot, tarballName.trim());
  const extractRoot = path.join(packRoot, 'extract');
  fs.mkdirSync(extractRoot, { recursive: true });
  run('tar', ['-xzf', tarballPath, '-C', extractRoot]);
  const binaryPath = findFile(extractRoot, fileName);
  if (!binaryPath) throw new Error(`${packageSpec} does not contain ${fileName}`);
  return binaryPath;
}

function resolveFfprobe(target, tempRoot) {
  const explicit = process.env.KAYPAL_FFPROBE_BINARY;
  if (explicit) {
    return {
      path: path.resolve(explicit),
      version: process.env.KAYPAL_FFPROBE_VERSION || 'externally-supplied',
      sourcePackage:
        process.env.KAYPAL_FFPROBE_SOURCE_PACKAGE || 'KAYPAL_FFPROBE_BINARY',
      binarySourceUrl:
        process.env.KAYPAL_FFPROBE_SOURCE_URL ||
        `https://www.npmjs.com/package/${target.ffprobePackage.split('@').slice(0, -1).join('@')}`,
      buildSourceUrl:
        process.env.KAYPAL_FFPROBE_BUILD_SOURCE_URL ||
        target.ffprobeBuildSourceUrl,
      upstreamSourceUrl:
        process.env.KAYPAL_FFPROBE_UPSTREAM_SOURCE_URL ||
        target.ffprobeUpstreamSourceUrl,
    };
  }

  const hostMatches =
    process.platform === target.nodePlatform && process.arch === target.nodeArch;
  if (hostMatches) {
    const installed = backendRequire('@ffprobe-installer/ffprobe');
    return {
      path: installed.path,
      version: installed.version || target.ffprobeVersion,
      sourcePackage: '@ffprobe-installer/ffprobe@2.1.2',
      binarySourceUrl: `https://www.npmjs.com/package/@ffprobe-installer/ffprobe`,
      buildSourceUrl: target.ffprobeBuildSourceUrl,
      upstreamSourceUrl: target.ffprobeUpstreamSourceUrl,
    };
  }

  return {
    path: materializeNpmPackage(
      target.ffprobePackage,
      `ffprobe${target.executableSuffix}`,
      tempRoot,
    ),
    version: target.ffprobeVersion,
    sourcePackage: target.ffprobePackage,
    binarySourceUrl: `https://www.npmjs.com/package/${target.ffprobePackage.split('@').slice(0, -1).join('@')}`,
    buildSourceUrl: target.ffprobeBuildSourceUrl,
    upstreamSourceUrl: target.ffprobeUpstreamSourceUrl,
  };
}

function assertBinaryFormat(filePath, platform) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 4096) throw new Error(`${filePath} is not a complete binary`);
  if (platform === 'win-x64') {
    if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
      throw new Error(`${filePath} is not a Windows PE executable`);
    }
    const peOffset = buffer.readUInt32LE(0x3c);
    if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
      throw new Error(`${filePath} is missing the PE signature`);
    }
    if (buffer.readUInt16LE(peOffset + 4) !== 0x8664) {
      throw new Error(`${filePath} is not a Windows x64 executable`);
    }
    return 'pe-x64';
  }
  if (platform === 'mac-arm64' || platform === 'mac-x64') {
    if (buffer.readUInt32LE(0) !== 0xfeedfacf) {
      throw new Error(`${filePath} is not a 64-bit Mach-O executable`);
    }
    const expectedCpu = platform === 'mac-arm64' ? 0x0100000c : 0x01000007;
    if (buffer.readUInt32LE(4) !== expectedCpu) {
      throw new Error(`${filePath} has the wrong macOS architecture`);
    }
    return platform === 'mac-arm64' ? 'mach-o-arm64' : 'mach-o-x64';
  }
  if (platform === 'linux-x64') {
    if (buffer.toString('hex', 0, 4) !== '7f454c46' || buffer[4] !== 2) {
      throw new Error(`${filePath} is not a 64-bit ELF executable`);
    }
    if (buffer.readUInt16LE(18) !== 0x3e) {
      throw new Error(`${filePath} is not a Linux x64 executable`);
    }
    return 'elf-x64';
  }
  throw new Error(`unsupported media-tool platform ${platform}`);
}

function readEmbeddedBuildConfiguration(filePath) {
  const binaryText = fs.readFileSync(filePath).toString('latin1');
  const candidates = binaryText.match(
    /--(?:enable|disable)-[A-Za-z0-9][\x20-\x7e]{0,8192}/g,
  );
  if (!candidates?.length) return '';
  return candidates
    .map((candidate) => candidate.trim())
    .sort((left, right) => right.length - left.length)[0];
}

function assertRedistributableBuild(filePath, toolName, buildConfiguration) {
  const binaryText = fs.readFileSync(filePath).toString('latin1');
  const inspectionText = `${buildConfiguration || ''}\n${binaryText}`;
  if (/--enable-nonfree\b/i.test(inspectionText)) {
    throw new Error(`${toolName} contains --enable-nonfree and cannot be distributed`);
  }
  if (toolName === 'ffmpeg') {
    if (!/--enable-gpl\b/i.test(buildConfiguration || binaryText)) {
      throw new Error('bundled ffmpeg must expose its GPL build configuration');
    }
    if (!/\blibx264\b/i.test(binaryText)) {
      throw new Error('bundled ffmpeg must provide libx264 for existing video workflows');
    }
  }
}

function validateRunnableBinary(filePath, toolName, target) {
  const hostMatches =
    process.platform === target.nodePlatform && process.arch === target.nodeArch;
  const embeddedBuildConfiguration = readEmbeddedBuildConfiguration(filePath);
  if (!hostMatches) {
    if (!embeddedBuildConfiguration) {
      throw new Error(
        `${toolName} does not expose an embedded build configuration for cross-target verification`,
      );
    }
    assertRedistributableBuild(filePath, toolName, embeddedBuildConfiguration);
    return {
      versionLine: null,
      buildConfiguration: embeddedBuildConfiguration,
      redistributionCheck: 'embedded-buildconf-no-nonfree',
    };
  }

  const versionOutput = run(filePath, ['-version']);
  const versionLine = versionOutput.split(/\r?\n/)[0].trim();
  const buildConfiguration = run(filePath, ['-hide_banner', '-buildconf']).trim();
  const license = run(filePath, ['-L']);
  if (
    /--enable-nonfree\b|not legally redistributable/i.test(
      `${versionOutput}\n${buildConfiguration}\n${license}`,
    )
  ) {
    throw new Error(`${toolName} contains nonfree parts and cannot be distributed`);
  }
  assertRedistributableBuild(
    filePath,
    toolName,
    buildConfiguration || embeddedBuildConfiguration,
  );
  if (toolName === 'ffmpeg') {
    const encoders = run(filePath, ['-hide_banner', '-encoders']);
    if (!/\blibx264\b/.test(encoders)) {
      throw new Error('bundled ffmpeg must provide libx264 for existing video workflows');
    }
  }
  return {
    versionLine,
    buildConfiguration:
      buildConfiguration || embeddedBuildConfiguration || 'configuration: (none)',
    redistributionCheck: 'executed-buildconf-no-nonfree',
  };
}

function writeSpdxLicense(spdxId, destination) {
  const license = require(`spdx-license-list/licenses/${spdxId}.json`);
  fs.writeFileSync(destination, `${license.licenseText.trim()}\n`, 'utf8');
}

function copyTool(sourcePath, destinationPath) {
  fs.copyFileSync(sourcePath, destinationPath);
  if (process.platform !== 'win32') fs.chmodSync(destinationPath, 0o755);
}

async function main() {
  const platform = process.env.BUILD_PLATFORM || defaultBuildPlatform();
  const target = TARGETS[platform];
  if (!target) throw new Error(`unsupported BUILD_PLATFORM=${platform}`);

  // 缓存跳过：目标平台产物已存在（且非空）时直接复用，避免每次构建都从
  // GitHub 重新下载（网络超时会导致 win 交叉构建中断）。
  const cachedFfmpeg = path.join(
    outputRoot,
    'bin',
    `ffmpeg${target.executableSuffix}`,
  );
  const cachedFfprobe = path.join(
    outputRoot,
    'bin',
    `ffprobe${target.executableSuffix}`,
  );
  if (
    fs.existsSync(cachedFfmpeg) &&
    fs.statSync(cachedFfmpeg).size > 0 &&
    fs.existsSync(cachedFfprobe) &&
    fs.statSync(cachedFfprobe).size > 0
  ) {
    console.log(
      `Media tools cache hit for ${platform}: ${cachedFfmpeg}, ${cachedFfprobe}`,
    );
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kaypal-media-tools-'));
  try {
    const ffmpeg = await resolveFfmpeg(target, tempRoot);
    const ffprobe = resolveFfprobe(target, tempRoot);
    for (const tool of [ffmpeg, ffprobe]) {
      if (!fs.existsSync(tool.path)) throw new Error(`media tool missing: ${tool.path}`);
    }

    const ffmpegFormat = assertBinaryFormat(ffmpeg.path, platform);
    const ffprobeFormat = assertBinaryFormat(ffprobe.path, platform);
    const ffmpegInspection = validateRunnableBinary(
      ffmpeg.path,
      'ffmpeg',
      target,
    );
    const ffprobeInspection = validateRunnableBinary(
      ffprobe.path,
      'ffprobe',
      target,
    );

    fs.rmSync(outputRoot, { recursive: true, force: true });
    const binRoot = path.join(outputRoot, 'bin');
    const licenseRoot = path.join(outputRoot, 'licenses');
    fs.mkdirSync(binRoot, { recursive: true });
    fs.mkdirSync(licenseRoot, { recursive: true });

    const ffmpegName = `ffmpeg${target.executableSuffix}`;
    const ffprobeName = `ffprobe${target.executableSuffix}`;
    const stagedFfmpeg = path.join(binRoot, ffmpegName);
    const stagedFfprobe = path.join(binRoot, ffprobeName);
    copyTool(ffmpeg.path, stagedFfmpeg);
    copyTool(ffprobe.path, stagedFfprobe);

    const gplFile = path.join(licenseRoot, 'GPL-3.0-or-later.txt');
    const lgplFile = path.join(licenseRoot, 'LGPL-2.1-or-later.txt');
    writeSpdxLicense('GPL-3.0-or-later', gplFile);
    writeSpdxLicense('LGPL-2.1-or-later', lgplFile);

    const sourceNoticeFile = path.join(outputRoot, 'SOURCE-OFFER.txt');
    fs.writeFileSync(
      sourceNoticeFile,
      [
        'Kaypal desktop media tools distribution notice',
        '',
        'These FFmpeg and FFprobe executables are independent programs invoked as child processes.',
        'They are distributed as separate works/aggregate resources and are not linked into Kaypal application code.',
        '',
        `FFmpeg binary package: ${ffmpeg.sourcePackage}`,
        `FFmpeg binary: ${ffmpeg.binarySourceUrl}`,
        `FFmpeg corresponding source and build scripts: ${ffmpeg.buildSourceUrl}`,
        `FFmpeg upstream source: ${ffmpeg.upstreamSourceUrl}`,
        '',
        `FFprobe binary package: ${ffprobe.sourcePackage}`,
        `FFprobe binary: ${ffprobe.binarySourceUrl}`,
        `FFprobe source/build information: ${ffprobe.buildSourceUrl}`,
        `FFprobe upstream source: ${ffprobe.upstreamSourceUrl}`,
        '',
        'The complete GPL-3.0-or-later and LGPL-2.1-or-later license texts are included in licenses/.',
        'The manifest records exact binary hashes, versions, target format, package provenance and source URLs.',
        '',
      ].join('\n'),
      'utf8',
    );

    const manifest = {
      schemaVersion: 1,
      platform,
      generatedAt: new Date().toISOString(),
      distributionBoundary: 'independent-child-processes',
      sourceNoticeFile: 'SOURCE-OFFER.txt',
      tools: {
        ffmpeg: {
          file: path.join('bin', ffmpegName),
          version: ffmpeg.version,
          versionLine: ffmpegInspection.versionLine,
          buildConfiguration: ffmpegInspection.buildConfiguration,
          format: ffmpegFormat,
          sha256: sha256(stagedFfmpeg),
          spdxLicense: 'GPL-3.0-or-later',
          licenseFile: path.join('licenses', 'GPL-3.0-or-later.txt'),
          sourcePackage: ffmpeg.sourcePackage,
          binarySourceUrl: ffmpeg.binarySourceUrl,
          buildSourceUrl: ffmpeg.buildSourceUrl,
          upstreamSourceUrl: ffmpeg.upstreamSourceUrl,
          redistributionCheck: ffmpegInspection.redistributionCheck,
        },
        ffprobe: {
          file: path.join('bin', ffprobeName),
          version: ffprobe.version,
          versionLine: ffprobeInspection.versionLine,
          buildConfiguration: ffprobeInspection.buildConfiguration,
          format: ffprobeFormat,
          sha256: sha256(stagedFfprobe),
          spdxLicense: target.ffprobeLicense,
          licenseFile: path.join(
            'licenses',
            target.ffprobeLicense.startsWith('LGPL')
              ? 'LGPL-2.1-or-later.txt'
              : 'GPL-3.0-or-later.txt',
          ),
          sourcePackage: ffprobe.sourcePackage,
          binarySourceUrl: ffprobe.binarySourceUrl,
          buildSourceUrl: ffprobe.buildSourceUrl,
          upstreamSourceUrl: ffprobe.upstreamSourceUrl,
          redistributionCheck: ffprobeInspection.redistributionCheck,
        },
      },
    };
    fs.writeFileSync(
      path.join(outputRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    console.log(`Media tools prepared for ${platform} at ${outputRoot}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[prepare-media-tools] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  TARGETS,
  assertBinaryFormat,
  assertRedistributableBuild,
  defaultBuildPlatform,
  readEmbeddedBuildConfiguration,
};
