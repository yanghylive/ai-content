#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { verifyAuthenticodeSignature } = require('./windows-authenticode');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const evidenceDate = new Date().toISOString().slice(0, 10);
const evidenceRoot = path.resolve(
  process.env.WINDOWS_GATE_EVIDENCE_DIR ||
    path.join(repoRoot, 'docs', `acceptance-evidence-${evidenceDate}`),
);
const strict = process.argv.includes('--strict') || process.env.WINDOWS_COMMERCIAL_GATE_STRICT === '1';
const commercialRelease =
  process.argv.includes('--commercial-release') || process.env.WINDOWS_COMMERCIAL_RELEASE === '1';

const tiers = {
  STATIC: 'static',
  SIMULATOR: 'simulator',
  REAL_WINDOWS: 'real-windows',
};

const wechatNativeCommands = [
  'group-broadcast',
  'contact-add',
  'friend-accept',
  'moments-publish',
  'moments-marketing',
  'chat-history',
];

const wechatWriteNativeCommands = new Set([
  'group-broadcast',
  'contact-add',
  'friend-accept',
  'moments-publish',
  'moments-marketing',
]);

const windowsEvidenceOsRules = Object.freeze({
  win10: {
    label: 'Win10',
    pattern: /Windows 10|Win10|10\.0\.1904[0-9]/i,
  },
  win11: {
    label: 'Win11',
    pattern: /Windows 11|Win11|10\.0\.22[0-9]{3}|10\.0\.26[0-9]{3}/i,
  },
});
const defaultRequiredWindowsEvidenceOs = Object.freeze(['win10']);

const results = [];

function add(status, name, detail, evidence = '', nextAction = '', tier = tiers.STATIC) {
  results.push({ status, tier, name, detail, evidence, nextAction });
}

function pass(name, detail, evidence, tier = tiers.STATIC) {
  add('PASS', name, detail, evidence, '', tier);
}

function warn(name, detail, nextAction = '', tier = tiers.STATIC) {
  add('WARN', name, detail, '', nextAction, tier);
}

function block(name, detail, nextAction = '', tier = tiers.STATIC) {
  add('BLOCKER', name, detail, '', nextAction, tier);
}

function unverified(name, detail, nextAction = '', tier = tiers.STATIC) {
  add('UNVERIFIED', name, detail, '', nextAction, tier);
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch {
    return null;
  }
}

function rel(filePath) {
  return path.relative(repoRoot, filePath) || '.';
}

function resolveEvidencePath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function normalizeWindowsEvidenceOs(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'win10' || normalized === 'windows10') return 'win10';
  if (normalized === 'win11' || normalized === 'windows11') return 'win11';
  return '';
}

function resolveRequiredWindowsEvidenceOs(env = process.env) {
  const configured = String(env.WINDOWS_GATE_REQUIRED_OS || '').trim();
  if (!configured) return [...defaultRequiredWindowsEvidenceOs];
  const required = [];
  const invalid = [];
  for (const item of configured.split(',')) {
    const key = normalizeWindowsEvidenceOs(item);
    if (!key) {
      if (item.trim()) invalid.push(item.trim());
      continue;
    }
    if (!required.includes(key)) required.push(key);
  }
  if (invalid.length > 0 || required.length === 0) {
    throw new Error(
      `WINDOWS_GATE_REQUIRED_OS only supports win10 and optional win11; invalid=${invalid.join(',') || '<empty>'}`,
    );
  }
  return required;
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
    releaseDate: pick(/^\s*releaseDate:\s*([^\r\n#]+)\s*$/m),
  };
}

function hashFile(filePath, algorithm, encoding) {
  const hash = crypto.createHash(algorithm);
  hash.update(fs.readFileSync(filePath));
  return hash.digest(encoding);
}

const EVIDENCE_BINDING_FILES = [
  'summary.json',
  'summary.redacted.json',
  'report.json',
  'manifest.json',
  'release-evidence.json',
  'README.md',
  'summary.md',
];

function normalizeEvidenceVersion(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/^v/i, '') : '';
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized) ? normalized : '';
}

function normalizeEvidenceSha256(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function normalizeEvidenceArchitecture(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['amd64', 'x64', 'x86_64', 'x86-64'].includes(normalized)) return 'x64';
  if (['arm64', 'aarch64', 'arm64ec'].includes(normalized)) return 'arm64';
  if (['x86', 'i386', 'i686', 'ia32'].includes(normalized)) return 'x86';
  return '';
}

const trustedEvidenceArchitectureSources = new Set([
  'dotnet-runtime-information',
  'PROCESSOR_ARCHITEW6432',
]);

function normalizeEvidencePlatform(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['win32', 'windows'].includes(normalized)) return 'win32';
  return normalized;
}

function normalizeEvidenceArchitectureSource(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return trustedEvidenceArchitectureSources.has(normalized) ? normalized : '';
}

function resolveWindowsCandidateArchitecture(pkg) {
  const targets = Array.isArray(pkg?.build?.win?.target) ? pkg.build.win.target : [];
  if (targets.length === 0) return '';
  const architectures = new Set();
  for (const target of targets) {
    const values = Array.isArray(target?.arch) ? target.arch : [];
    if (values.length === 0) return '';
    for (const value of values) {
      const architecture = normalizeEvidenceArchitecture(value);
      if (!architecture) return '';
      architectures.add(architecture);
    }
  }
  return architectures.size === 1 ? [...architectures][0] : '';
}

function firstNormalized(values, normalizer) {
  for (const value of values) {
    const normalized = normalizer(value);
    if (normalized) return normalized;
  }
  return '';
}

function uniqueNormalized(values, normalizer) {
  const normalized = [];
  const invalid = [];
  for (const value of values) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const item = normalizer(value);
    if (item) normalized.push(item);
    else invalid.push(String(value).trim());
  }
  const unique = [...new Set(normalized)];
  return {
    value: unique.length === 1 && invalid.length === 0 ? unique[0] : '',
    conflict: unique.length > 1 ? unique : [],
    invalid: [...new Set(invalid)],
  };
}

function collectPatternMatches(text, patterns) {
  const matches = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    for (const match of String(text || '').matchAll(new RegExp(pattern.source, flags))) {
      if (match[1]) matches.push(match[1]);
    }
  }
  return matches;
}

function extractStructuredEvidenceBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: '', installerSha256: '' };
  }
  const version = firstNormalized(
    [
      value.appVersion,
      value.desktopVersion,
      value.releaseVersion,
      value.candidateVersion,
      value.version,
      value.app?.version,
      value.release?.version,
      value.candidate?.version,
      value.installer?.version,
    ],
    normalizeEvidenceVersion,
  );
  const installerSha256 = firstNormalized(
    [
      value.installerSha256,
      value.installerSHA256,
      value.releaseInstallerSha256,
      value.installer?.sha256,
      value.installer?.sha256sum,
      value.artifact?.sha256,
      value.release?.installerSha256,
      value.release?.installer?.sha256,
      value.candidate?.installerSha256,
      value.candidate?.installer?.sha256,
    ],
    normalizeEvidenceSha256,
  );
  return { version, installerSha256 };
}

function extractStructuredEvidenceArchitecture(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      osPlatform: '',
      osArchitecture: '',
      processArch: '',
      osArchitectureSource: '',
      conflicts: [],
    };
  }
  const legacyPlatform = normalizeEvidencePlatform(value.platform) === 'win32'
    ? value.platform
    : undefined;
  const osPlatform = uniqueNormalized(
    [value.osPlatform, value.system?.osPlatform, value.os?.platform, value.windows?.platform, legacyPlatform],
    normalizeEvidencePlatform,
  );
  const osArchitecture = uniqueNormalized(
    [
      value.osArchitecture,
      value.system?.osArchitecture,
      value.os?.architecture,
      value.windows?.osArchitecture,
    ],
    normalizeEvidenceArchitecture,
  );
  const processArch = uniqueNormalized(
    [
      value.processArch,
      value.processArchitecture,
      value.process?.arch,
      value.runtime?.processArch,
    ],
    normalizeEvidenceArchitecture,
  );
  const osArchitectureSource = uniqueNormalized(
    [
      value.osArchitectureSource,
      value.system?.osArchitectureSource,
      value.os?.architectureSource,
      value.windows?.osArchitectureSource,
    ],
    normalizeEvidenceArchitectureSource,
  );
  const conflicts = [
    ...(osPlatform.conflict.length ? [`osPlatform=${osPlatform.conflict.join('|')}`] : []),
    ...(osPlatform.invalid.length ? [`osPlatform.invalid=${osPlatform.invalid.join('|')}`] : []),
    ...(osArchitecture.conflict.length ? [`osArchitecture=${osArchitecture.conflict.join('|')}`] : []),
    ...(osArchitecture.invalid.length
      ? [`osArchitecture.invalid=${osArchitecture.invalid.join('|')}`]
      : []),
    ...(processArch.conflict.length ? [`processArch=${processArch.conflict.join('|')}`] : []),
    ...(processArch.invalid.length ? [`processArch.invalid=${processArch.invalid.join('|')}`] : []),
    ...(osArchitectureSource.conflict.length
      ? [`osArchitectureSource=${osArchitectureSource.conflict.join('|')}`]
      : []),
    ...(osArchitectureSource.invalid.length
      ? [`osArchitectureSource.invalid=${osArchitectureSource.invalid.join('|')}`]
      : []),
  ];
  return {
    osPlatform: osPlatform.value,
    osArchitecture: osArchitecture.value,
    processArch: processArch.value,
    osArchitectureSource: osArchitectureSource.value,
    conflicts,
  };
}

function extractTextEvidenceBinding(text) {
  const value = String(text || '');
  const versionPatterns = [
    /\b(?:app|desktop|release|candidate)[ _-]?version\s*[:=]\s*[`'"]?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i,
    /\bCandidate\s*:\s*[^\r\n]*?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i,
    /\bInstaller\s*:\s*[^\r\n]*?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i,
    /\bJIUZHANG AI[^\r\n]*?\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i,
    /(?:应用|桌面|候选|安装包)版本\s*[:：=]?\s*[`'"]?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i,
  ];
  const shaPatterns = [
    /(?:installer|artifact|安装包)[^\r\n]{0,100}?sha-?256\s*[:：=]?\s*[`'"]?([a-f0-9]{64})/i,
    /sha-?256\s*[:：=]\s*[`'"]?([a-f0-9]{64})/i,
  ];
  const version = firstNormalized(
    versionPatterns.map((pattern) => value.match(pattern)?.[1] || ''),
    normalizeEvidenceVersion,
  );
  const installerSha256 = firstNormalized(
    shaPatterns.map((pattern) => value.match(pattern)?.[1] || ''),
    normalizeEvidenceSha256,
  );
  return { version, installerSha256 };
}

function extractTextEvidenceArchitecture(text) {
  const value = String(text || '');
  const platformPatterns = [
    /\bOS[ _-]?platform\s*[:=]\s*[`'"]?([A-Za-z0-9_-]+)/i,
    /操作系统平台\s*[:：=]?\s*[`'"]?([A-Za-z0-9_-]+)/i,
  ];
  const osPatterns = [
    /\b(?:OS|system|native|Windows)[ _-]?architecture\s*[:=]\s*[`'"]?([A-Za-z0-9_-]+)/i,
    /(?:操作系统|系统|原生)架构\s*[:：=]?\s*[`'"]?([A-Za-z0-9_-]+)/i,
  ];
  const processPatterns = [
    /\bprocess(?:\.|[ _-])arch(?:itecture)?\s*[:=]\s*[`'"]?([A-Za-z0-9_-]+)/i,
    /进程架构\s*[:：=]?\s*[`'"]?([A-Za-z0-9_-]+)/i,
  ];
  const sourcePatterns = [
    /\bOS[ _-]?architecture[ _-]?source\s*[:=]\s*[`'"]?([A-Za-z0-9_.-]+)/i,
    /操作系统架构来源\s*[:：=]?\s*[`'"]?([A-Za-z0-9_.-]+)/i,
  ];
  const osPlatform = uniqueNormalized(
    collectPatternMatches(value, platformPatterns),
    normalizeEvidencePlatform,
  );
  const osArchitecture = uniqueNormalized(
    collectPatternMatches(value, osPatterns),
    normalizeEvidenceArchitecture,
  );
  const processArch = uniqueNormalized(
    collectPatternMatches(value, processPatterns),
    normalizeEvidenceArchitecture,
  );
  const osArchitectureSource = uniqueNormalized(
    collectPatternMatches(value, sourcePatterns),
    normalizeEvidenceArchitectureSource,
  );
  return {
    osPlatform: osPlatform.value,
    osArchitecture: osArchitecture.value,
    processArch: processArch.value,
    osArchitectureSource: osArchitectureSource.value,
    conflicts: [
      ...(osPlatform.conflict.length ? [`osPlatform=${osPlatform.conflict.join('|')}`] : []),
      ...(osPlatform.invalid.length ? [`osPlatform.invalid=${osPlatform.invalid.join('|')}`] : []),
      ...(osArchitecture.conflict.length ? [`osArchitecture=${osArchitecture.conflict.join('|')}`] : []),
      ...(osArchitecture.invalid.length
        ? [`osArchitecture.invalid=${osArchitecture.invalid.join('|')}`]
        : []),
      ...(processArch.conflict.length ? [`processArch=${processArch.conflict.join('|')}`] : []),
      ...(processArch.invalid.length ? [`processArch.invalid=${processArch.invalid.join('|')}`] : []),
      ...(osArchitectureSource.conflict.length
        ? [`osArchitectureSource=${osArchitectureSource.conflict.join('|')}`]
        : []),
      ...(osArchitectureSource.invalid.length
        ? [`osArchitectureSource.invalid=${osArchitectureSource.invalid.join('|')}`]
        : []),
    ],
  };
}

function readEvidenceBindingFile(filePath) {
  const text = readSmallText(filePath);
  if (!text) return { filePath, version: '', installerSha256: '' };
  const json = readJson(filePath);
  const binding = json
    ? extractStructuredEvidenceBinding(json)
    : extractTextEvidenceBinding(text);
  return { filePath, ...binding };
}

function readEvidenceArchitectureFile(filePath) {
  const text = readSmallText(filePath);
  if (!text) {
    return {
      filePath,
      osPlatform: '',
      osArchitecture: '',
      processArch: '',
      osArchitectureSource: '',
      conflicts: [],
    };
  }
  const json = readJson(filePath);
  const architecture = json
    ? extractStructuredEvidenceArchitecture(json)
    : extractTextEvidenceArchitecture(text);
  return { filePath, ...architecture };
}

function evidenceBindingFiles(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return [];
  if (!fs.statSync(sourcePath).isDirectory()) return [sourcePath];
  return EVIDENCE_BINDING_FILES
    .map((name) => path.join(sourcePath, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function validateEvidenceReleaseBinding(sourcePath, releaseIdentity) {
  const expectedVersion = normalizeEvidenceVersion(releaseIdentity?.version);
  const expectedSha256 = normalizeEvidenceSha256(releaseIdentity?.installerSha256);
  if (!expectedVersion || !expectedSha256) {
    return {
      ok: false,
      status: 'release-identity-missing',
      detail: 'current release version or installer SHA-256 is unavailable',
      filePath: sourcePath,
    };
  }

  const files = evidenceBindingFiles(sourcePath);
  if (files.length === 0) {
    return {
      ok: false,
      status: 'binding-missing',
      detail: 'evidence file is missing or the evidence directory has no binding manifest',
      filePath: sourcePath,
    };
  }

  const complete = files
    .map(readEvidenceBindingFile)
    .filter((binding) => binding.version && binding.installerSha256);
  if (complete.length === 0) {
    return {
      ok: false,
      status: 'binding-missing',
      detail: `evidence must contain appVersion/version=${expectedVersion} and installerSha256=${expectedSha256}`,
      filePath: files[0],
    };
  }

  const mismatched = complete.find(
    (binding) =>
      binding.version !== expectedVersion ||
      binding.installerSha256 !== expectedSha256,
  );
  if (mismatched) {
    const fields = [];
    if (mismatched.version !== expectedVersion) {
      fields.push(`version ${mismatched.version} != ${expectedVersion}`);
    }
    if (mismatched.installerSha256 !== expectedSha256) {
      fields.push(`installerSha256 ${mismatched.installerSha256} != ${expectedSha256}`);
    }
    return {
      ok: false,
      status: 'binding-mismatch',
      detail: `stale or foreign release evidence: ${fields.join(', ')}`,
      filePath: mismatched.filePath,
      version: mismatched.version,
      installerSha256: mismatched.installerSha256,
    };
  }

  const matched = complete[0];
  return {
    ok: true,
    status: 'matched',
    detail: `bound to appVersion=${expectedVersion}, installerSha256=${expectedSha256}`,
    filePath: matched.filePath,
    version: matched.version,
    installerSha256: matched.installerSha256,
  };
}

function validateEvidenceArchitecture(sourcePath, expectedArchitecture) {
  const expected = normalizeEvidenceArchitecture(expectedArchitecture);
  if (!expected) {
    return {
      ok: false,
      status: 'candidate-architecture-missing',
      detail: 'current Windows candidate architecture is missing or ambiguous',
      filePath: sourcePath,
    };
  }
  const files = evidenceBindingFiles(sourcePath);
  if (files.length === 0) {
    return {
      ok: false,
      status: 'architecture-missing',
      detail: `evidence must contain native osArchitecture=${expected} and processArch`,
      filePath: sourcePath,
    };
  }
  const declared = files.map(readEvidenceArchitectureFile);
  const withArchitectureEvidence = declared.filter(
    (item) =>
      item.osPlatform ||
      item.osArchitecture ||
      item.processArch ||
      item.osArchitectureSource ||
      item.conflicts.length,
  );
  if (withArchitectureEvidence.length === 0) {
    return {
      ok: false,
      status: 'architecture-missing',
      detail: `evidence must contain osPlatform=win32, native osArchitecture=${expected}, processArch, and a trusted architecture source; process.arch alone cannot prove the Windows OS architecture`,
      filePath: files[0],
    };
  }
  const conflicting = withArchitectureEvidence.find((item) => item.conflicts.length > 0);
  if (conflicting) {
    return {
      ok: false,
      status: 'architecture-conflict',
      detail: `evidence contains conflicting architecture declarations: ${conflicting.conflicts.join(', ')}`,
      filePath: conflicting.filePath,
    };
  }
  const wrongPlatform = withArchitectureEvidence.find((item) => item.osPlatform !== 'win32');
  if (wrongPlatform) {
    return {
      ok: false,
      status: wrongPlatform.osPlatform ? 'platform-mismatch' : 'platform-missing',
      detail: `real Windows evidence requires osPlatform=win32; found ${wrongPlatform.osPlatform || 'missing'}`,
      filePath: wrongPlatform.filePath,
    };
  }
  const incomplete = withArchitectureEvidence.find(
    (item) => !item.osArchitecture || !item.processArch || !item.osArchitectureSource,
  );
  if (incomplete) {
    return {
      ok: false,
      status: 'architecture-missing',
      detail: 'evidence must contain native osArchitecture, processArch, and a trusted osArchitectureSource in the same file; process.arch alone cannot prove the native OS architecture',
      filePath: incomplete.filePath,
      osArchitecture: incomplete.osArchitecture,
    };
  }
  const mismatched = withArchitectureEvidence.find(
    (item) => item.osArchitecture !== expected,
  );
  if (mismatched) {
    return {
      ok: false,
      status: 'architecture-mismatch',
      detail: `native osArchitecture ${mismatched.osArchitecture} != candidate ${expected}; processArch=${mismatched.processArch || 'unknown'} does not override the OS architecture`,
      filePath: mismatched.filePath,
      osArchitecture: mismatched.osArchitecture,
      processArch: mismatched.processArch,
    };
  }
  const matched = withArchitectureEvidence[0];
  return {
    ok: true,
    status: 'matched',
    detail: `osPlatform=win32; native osArchitecture=${expected}; processArch=${matched.processArch}; source=${matched.osArchitectureSource}`,
    filePath: matched.filePath,
    osPlatform: matched.osPlatform,
    osArchitecture: matched.osArchitecture,
    processArch: matched.processArch,
    osArchitectureSource: matched.osArchitectureSource,
  };
}

function resolveReleaseIdentity(pkg, latestPath = path.join(desktopRoot, 'dist', 'latest.yml')) {
  const latest = parseLatestYml(readText(latestPath));
  const version = normalizeEvidenceVersion(pkg?.version);
  const installerPath = latest.path
    ? path.resolve(path.dirname(latestPath), latest.path)
    : '';
  const versionMatches = Boolean(version) && latest.version === version;
  return {
    version,
    latestVersion: latest.version,
    installerPath,
    targetArchitecture: resolveWindowsCandidateArchitecture(pkg),
    installerSha256:
      versionMatches && installerPath && fs.existsSync(installerPath)
        ? hashFile(installerPath, 'sha256', 'hex')
        : '',
  };
}

function listFiles(root, predicate) {
  const matches = [];
  if (!fs.existsSync(root)) return matches;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'screenshots', 'windows-installer-extract'].includes(entry.name)) {
          stack.push(fullPath);
        }
      } else if (!predicate || predicate(fullPath)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

function listDirectories(root, predicate) {
  const matches = [];
  if (!fs.existsSync(root)) return matches;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['node_modules', '.git', 'screenshots', 'windows-installer-extract'].includes(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (!predicate || predicate(fullPath)) matches.push(fullPath);
      stack.push(fullPath);
    }
  }
  return matches;
}

function readSmallText(filePath, maxBytes = 4 * 1024 * 1024) {
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) return '';
  return readText(filePath);
}

function sortByEvidenceTime(items) {
  return items.sort((a, b) => {
    const at = a.generatedAt ? Date.parse(a.generatedAt) : 0;
    const bt = b.generatedAt ? Date.parse(b.generatedAt) : 0;
    const am = fs.existsSync(a.filePath) ? fs.statSync(a.filePath).mtimeMs : 0;
    const bm = fs.existsSync(b.filePath) ? fs.statSync(b.filePath).mtimeMs : 0;
    return (bt || bm) - (at || am);
  });
}

function hasSimulatorMarker(filePath, text = '') {
  return /simulator/i.test(rel(filePath)) || /模拟器|win32-simulator|kaypal-local-simulator|windows-wechat-contacts-simulator/i.test(text);
}

function hasRealWindowsMarker(filePath, text = '') {
  return /Windows|Win10|Win11|win32|真机|真实同步：已启用|real[-_\s]?machine/i.test(`${rel(filePath)}\n${text}`);
}

function classifyTextEvidence(
  filePath,
  allPatterns,
  passPattern = /pass|passed|success|completed|完成|成功|已发布|真实同步：已启用/i,
  releaseIdentity = null,
) {
  if (!fs.existsSync(filePath)) return { tier: 'missing', ok: false, reason: 'missing file' };
  const text = readSmallText(filePath);
  if (!text) return { tier: tiers.STATIC, ok: false, reason: 'empty or too large' };
  if (hasSimulatorMarker(filePath, text)) {
    return { tier: tiers.SIMULATOR, ok: false, reason: 'simulator evidence cannot satisfy commercial release' };
  }
  const scopeOk = allPatterns.every((pattern) => pattern.test(text) || pattern.test(rel(filePath)));
  const passed = passPattern.test(text);
  const realWindows = hasRealWindowsMarker(filePath, text);
  const binding = releaseIdentity
    ? validateEvidenceReleaseBinding(filePath, releaseIdentity)
    : { ok: true, detail: 'release binding not requested' };
  const architecture = releaseIdentity
    ? validateEvidenceArchitecture(filePath, releaseIdentity.targetArchitecture)
    : { ok: true, detail: 'architecture not requested' };
  if (scopeOk && passed && realWindows && binding.ok && architecture.ok) {
    return {
      tier: tiers.REAL_WINDOWS,
      ok: true,
      reason: `real Windows evidence; ${binding.detail}; ${architecture.detail}`,
      binding,
      architecture,
    };
  }
  return {
    tier: tiers.STATIC,
    ok: false,
    reason: `scope=${scopeOk}, pass=${passed}, realWindows=${realWindows}, releaseBinding=${binding.ok ? 'matched' : binding.detail}, architecture=${architecture.ok ? 'matched' : architecture.detail}`,
    binding,
    architecture,
  };
}

function findLatestReport(prefix, fileName) {
  if (!fs.existsSync(evidenceRoot)) return null;
  const candidates = fs
    .readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => {
      const filePath = path.join(evidenceRoot, entry.name, fileName);
      const json = readJson(filePath);
      const generatedAt = json?.generatedAt ? Date.parse(json.generatedAt) : 0;
      const mtime = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0;
      return { dir: entry.name, filePath, json, sortKey: generatedAt || mtime };
    })
    .filter((item) => item.json);
  candidates.sort((a, b) => b.sortKey - a.sortKey);
  return candidates[0] || null;
}

function textEvidenceMatches(
  filePath,
  allPatterns,
  passPattern = /pass|success|completed|完成|成功|已发布/i,
  releaseIdentity = null,
) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size > 4 * 1024 * 1024) return false;
  const text = readText(filePath);
  const bindingOk = releaseIdentity
    ? validateEvidenceReleaseBinding(filePath, releaseIdentity).ok
    : true;
  const architectureOk = releaseIdentity
    ? validateEvidenceArchitecture(filePath, releaseIdentity.targetArchitecture).ok
    : true;
  return (
    !hasSimulatorMarker(filePath, text) &&
    hasRealWindowsMarker(filePath, text) &&
    allPatterns.every((pattern) => pattern.test(text) || pattern.test(rel(filePath))) &&
    passPattern.test(text) &&
    bindingOk &&
    architectureOk
  );
}

function findTextEvidence(allPatterns, passPattern, releaseIdentity = null) {
  const files = listFiles(evidenceRoot, (filePath) => /\.(md|json|txt)$/i.test(filePath));
  return files.find((filePath) => textEvidenceMatches(filePath, allPatterns, passPattern, releaseIdentity)) || '';
}

function packageExtraResourceTargets(pkg) {
  const topLevel = Array.isArray(pkg?.build?.extraResources) ? pkg.build.extraResources : [];
  const winLevel = Array.isArray(pkg?.build?.win?.extraResources) ? pkg.build.win.extraResources : [];
  return [...topLevel, ...winLevel].map((item) => item?.to).filter(Boolean);
}

function scanFrontendApiBase() {
  const chunksRoot = path.join(repoRoot, 'frontend', 'out', '_next', 'static', 'chunks');
  const files = listFiles(chunksRoot, (filePath) => filePath.endsWith('.js'));
  return files.some((filePath) => /http:\/\/(?:localhost|127\.0\.0\.1):3011\/api/.test(readText(filePath)));
}

function findLatestLiandaoSmokeReport() {
  const smokeRoot = path.join(evidenceRoot, 'liandao-wechat-smoke');
  const files = listFiles(smokeRoot, (filePath) => /^liandao-wechat-smoke-.+\.json$/.test(path.basename(filePath)));
  const reports = files
    .map((filePath) => ({ filePath, json: readJson(filePath) }))
    .filter((item) => item.json)
    .map((item) => ({ ...item, generatedAt: item.json.generatedAt || '' }));
  return sortByEvidenceTime(reports)[0] || null;
}

function checkLiandaoStaticSmokeEvidence() {
  const report = findLatestLiandaoSmokeReport();
  if (!report) {
    block(
      'Liandao WeChat static smoke evidence',
      `no liandao-wechat-smoke report under ${rel(path.join(evidenceRoot, 'liandao-wechat-smoke'))}`,
      'Run node scripts/liandao-wechat-smoke.mjs before building or uploading a Windows release.',
      tiers.STATIC,
    );
    return;
  }

  const summary = report.json.summary || {};
  const failed = Number(summary.FAIL || summary.failed || 0);
  const blocked = Number(summary.BLOCKED || summary.blocked || 0);
  const skipped = Number(summary.SKIP || summary.skipped || 0);
  const passCount = Number(summary.PASS || summary.pass || 0);
  const realWechat = report.json.config?.realWechat === true;
  if (failed > 0 || blocked > 0) {
    block(
      'Liandao WeChat static smoke evidence',
      `latest smoke is not clean: PASS=${passCount}, FAIL=${failed}, BLOCKED=${blocked}`,
      'Fix the static/live smoke blockers before release.',
      tiers.STATIC,
    );
    return;
  }
  if (commercialRelease && (!realWechat || skipped > 0)) {
    block(
      'Liandao WeChat static smoke evidence',
      `commercial release requires realWechat live smoke with no skips; latest PASS=${passCount}, SKIP=${skipped}, realWechat=${realWechat ? 'on' : 'off'}`,
      'Run node scripts/liandao-wechat-smoke.mjs --live --real-wechat with authenticated local engine evidence before release.',
      tiers.STATIC,
    );
    return;
  }
  pass(
    'Liandao WeChat static smoke evidence',
    `latest smoke clean: PASS=${passCount}, realWechat=${realWechat ? 'on' : 'off'}; this is not real Windows proof by itself`,
    rel(report.filePath),
    tiers.STATIC,
  );
}

function contactRecordPassed(record, expectedMode) {
  if (!record || typeof record !== 'object') return false;
  const text = JSON.stringify(record);
  if (hasSimulatorMarker('', text)) return false;
  return contactRecordHasSuccessfulSync(record, expectedMode);
}

function contactRecordHasSuccessfulSync(record, expectedMode) {
  if (!record || typeof record !== 'object') return false;
  const statusCode = Number(record.statusCode || 0);
  if (record.ok !== true || statusCode < 200 || statusCode >= 400) return false;
  const response = record.response && typeof record.response === 'object' ? record.response : {};
  const count = Number(response.count ?? (Array.isArray(response.items) ? response.items.length : NaN));
  return response.mode === expectedMode && Number.isFinite(count) && count > 0;
}

function classifyContactEvidenceDirectory(dirPath, releaseIdentity = null) {
  const summaryPath = path.join(dirPath, 'summary.md');
  const summary = readSmallText(summaryPath);
  const randomPath = path.join(dirPath, '02-contacts-random-sync-result.json');
  const allPath = path.join(dirPath, '03-contacts-all-sync-result.json');
  const random = readJson(randomPath);
  const all = readJson(allPath);
  const simulator =
    hasSimulatorMarker(dirPath, summary) ||
    hasSimulatorMarker(randomPath, JSON.stringify(random || {})) ||
    hasSimulatorMarker(allPath, JSON.stringify(all || {}));
  const randomSyncOk = contactRecordHasSuccessfulSync(random, 'random');
  const allSyncOk = contactRecordHasSuccessfulSync(all, 'all');
  const realRun = /真实同步：已启用/.test(summary);
  const randomOk = contactRecordPassed(random, 'random');
  const allOk = contactRecordPassed(all, 'all');
  const releaseBinding = releaseIdentity
    ? validateEvidenceReleaseBinding(dirPath, releaseIdentity)
    : { ok: true, detail: 'release binding not requested' };
  const randomBinding = releaseIdentity
    ? validateEvidenceReleaseBinding(randomPath, releaseIdentity)
    : { ok: true, detail: 'release binding not requested' };
  const allBinding = releaseIdentity
    ? validateEvidenceReleaseBinding(allPath, releaseIdentity)
    : { ok: true, detail: 'release binding not requested' };
  const architecture = releaseIdentity
    ? validateEvidenceArchitecture(summaryPath, releaseIdentity.targetArchitecture)
    : { ok: true, detail: 'architecture not requested' };
  const randomArchitecture = releaseIdentity
    ? validateEvidenceArchitecture(randomPath, releaseIdentity.targetArchitecture)
    : { ok: true, detail: 'architecture not requested' };
  const allArchitecture = releaseIdentity
    ? validateEvidenceArchitecture(allPath, releaseIdentity.targetArchitecture)
    : { ok: true, detail: 'architecture not requested' };
  const bindingsOk =
    releaseBinding.ok &&
    randomBinding.ok &&
    allBinding.ok &&
    architecture.ok &&
    randomArchitecture.ok &&
    allArchitecture.ok;
  const qualifies = realRun && randomOk && allOk && bindingsOk;

  return {
    dirPath,
    filePath: fs.existsSync(summaryPath) ? summaryPath : dirPath,
    tier: simulator ? tiers.SIMULATOR : qualifies ? tiers.REAL_WINDOWS : tiers.STATIC,
    ok: !simulator && qualifies,
    releaseBinding,
    randomBinding,
    allBinding,
    architecture,
    randomArchitecture,
    allArchitecture,
    detail: simulator
      ? `simulator=true, random=${randomSyncOk}, all=${allSyncOk}; not valid for commercial release`
      : `real=${realRun}, random=${randomOk}, all=${allOk}, releaseBinding=${releaseBinding.ok ? 'matched' : releaseBinding.detail}, randomBinding=${randomBinding.ok ? 'matched' : randomBinding.detail}, allBinding=${allBinding.ok ? 'matched' : allBinding.detail}, architecture=${architecture.ok ? 'matched' : architecture.detail}, randomArchitecture=${randomArchitecture.ok ? 'matched' : randomArchitecture.detail}, allArchitecture=${allArchitecture.ok ? 'matched' : allArchitecture.detail}`,
  };
}

function findWechatContactEvidence(releaseIdentity = null) {
  const explicit = resolveEvidencePath(process.env.WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE || '');
  if (explicit) {
    if (fs.existsSync(explicit) && fs.statSync(explicit).isDirectory()) {
      const classified = classifyContactEvidenceDirectory(explicit, releaseIdentity);
      return {
        real: classified.ok ? classified : null,
        simulator: classified.tier === tiers.SIMULATOR ? classified : null,
        explicit: classified,
      };
    }
    const classified = classifyTextEvidence(
      explicit,
      [/微信|WeChat|wechat/i, /通讯录|联系人|contact/i, /同步|sync|random|all/i],
      undefined,
      releaseIdentity,
    );
    return {
      real: classified.ok ? { ...classified, filePath: explicit, detail: classified.reason } : null,
      simulator: classified.tier === tiers.SIMULATOR ? { ...classified, filePath: explicit, detail: classified.reason } : null,
      explicit: { ...classified, filePath: explicit, detail: classified.reason },
    };
  }

  const dirs = listDirectories(evidenceRoot, (dirPath) => {
    const name = path.basename(dirPath);
    return (
      /^windows-wechat-contacts(?:-|$)/i.test(name) ||
      fs.existsSync(path.join(dirPath, '02-contacts-random-sync-result.json')) ||
      fs.existsSync(path.join(dirPath, '03-contacts-all-sync-result.json'))
    );
  }).map((dirPath) => classifyContactEvidenceDirectory(dirPath, releaseIdentity));
  sortByEvidenceTime(dirs);
  return {
    real: dirs.find((item) => item.ok && item.tier === tiers.REAL_WINDOWS) || null,
    simulator: dirs.find((item) => item.tier === tiers.SIMULATOR) || null,
    explicit: null,
  };
}

function flattenValues(value) {
  const values = [];
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    values.push(current);
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return values;
}

function findReadbackInOutput(output) {
  if (output?.readback) return output.readback;
  const results = Array.isArray(output?.results) ? output.results : [];
  return results.find((item) => item?.readback)?.readback || null;
}

function hasNativeScreenshotEvidence(evidenceJson) {
  const copied = Array.isArray(evidenceJson?.copiedEvidence) ? evidenceJson.copiedEvidence : [];
  if (copied.some((item) => item?.file || item?.source)) return true;
  return flattenValues(evidenceJson?.parsed?.output).some(
    (item) => item?.type === 'desktop_screenshot' && (item.sha256 || item.path),
  );
}

function nativeCommandRecordPassed(evidenceJson, command) {
  const parsed = evidenceJson?.parsed;
  if (!parsed || parsed.ok !== true || parsed.errorCode !== 'success') return false;
  const output = parsed.output || {};
  const screenshotOk = hasNativeScreenshotEvidence(evidenceJson);
  if (command === 'chat-history') {
    const sessions = Array.isArray(output.sessions) ? output.sessions : [];
    const messages = Array.isArray(output.messages) ? output.messages : [];
    const readback = output.readback || {};
    return output.source === 'windows-wechat-uia' && sessions.length > 0 && messages.length > 0 && readback.matched === true && screenshotOk;
  }
  const readback = findReadbackInOutput(output);
  const attempted = parsed.raw?.realWechatActionAttempted === true;
  return wechatWriteNativeCommands.has(command) && attempted && readback?.matched === true && screenshotOk;
}

function classifyNativeCommandsEvidenceDirectory(dirPath, releaseIdentity = null) {
  const summaryPath = path.join(dirPath, 'summary.json');
  const summary = readJson(summaryPath);
  if (!summary) {
    return {
      dirPath,
      filePath: summaryPath,
      tier: tiers.STATIC,
      ok: false,
      detail: 'missing summary.json',
      commands: {},
    };
  }
  const summaryText = JSON.stringify(summary);
  const simulator = Boolean(summary.simulator) || hasSimulatorMarker(dirPath, summaryText);
  const realWindows = summary.platform === 'win32' || hasRealWindowsMarker(dirPath, summaryText);
  const requireCommands = summary.requireRealWechatCommands === true;
  const releaseBinding = releaseIdentity
    ? validateEvidenceReleaseBinding(dirPath, releaseIdentity)
    : { ok: true, detail: 'release binding not requested' };
  const architecture = releaseIdentity
    ? validateEvidenceArchitecture(summaryPath, releaseIdentity.targetArchitecture)
    : { ok: true, detail: 'architecture not requested' };
  const results = Array.isArray(summary.results) ? summary.results : [];
  const commands = {};
  for (const command of wechatNativeCommands) {
    const result = results.find((item) => item.name === `native-command-real:${command}`);
    const evidencePath = result?.evidence ? path.join(dirPath, result.evidence) : '';
    const evidenceJson = evidencePath ? readJson(evidencePath) : null;
    const binding = releaseIdentity
      ? validateEvidenceReleaseBinding(evidencePath, releaseIdentity)
      : { ok: true, detail: 'release binding not requested' };
    const commandArchitecture = releaseIdentity
      ? validateEvidenceArchitecture(evidencePath, releaseIdentity.targetArchitecture)
      : { ok: true, detail: 'architecture not requested' };
    const passed =
      result?.status === 'passed' &&
      evidenceJson &&
      nativeCommandRecordPassed(evidenceJson, command) &&
      binding.ok &&
      commandArchitecture.ok;
    commands[command] = {
      status: result?.status || 'missing',
      evidence: evidencePath,
      passed,
      binding,
      architecture: commandArchitecture,
    };
  }
  const missingOrFailed = Object.entries(commands)
    .filter(([, item]) => !item.passed)
    .map(([command, item]) =>
      `${command}:${!item.binding.ok ? item.binding.status : !item.architecture.ok ? item.architecture.status : item.status}`,
    );
  const ok =
    !simulator &&
    realWindows &&
    requireCommands &&
    releaseBinding.ok &&
    architecture.ok &&
    missingOrFailed.length === 0;
  return {
    dirPath,
    filePath: summaryPath,
    tier: simulator ? tiers.SIMULATOR : ok ? tiers.REAL_WINDOWS : tiers.STATIC,
    ok,
    commands,
    releaseBinding,
    architecture,
    detail: simulator
      ? 'simulator=true; native commands evidence cannot satisfy commercial release'
      : `realWindows=${realWindows}, requireRealWechatCommands=${requireCommands}, releaseBinding=${releaseBinding.ok ? 'matched' : releaseBinding.detail}, architecture=${architecture.ok ? 'matched' : architecture.detail}, failed=[${missingOrFailed.join(', ') || 'none'}]`,
  };
}

function findWechatNativeCommandsEvidence(releaseIdentity = null) {
  const explicit = resolveEvidencePath(process.env.WINDOWS_GATE_WECHAT_NATIVE_COMMAND_EVIDENCE || '');
  if (explicit) {
    const classified = classifyNativeCommandsEvidenceDirectory(explicit, releaseIdentity);
    return {
      real: classified.ok ? classified : null,
      simulator: classified.tier === tiers.SIMULATOR ? classified : null,
      explicit: classified,
    };
  }

  const dirs = listDirectories(evidenceRoot, (dirPath) => {
    const name = path.basename(dirPath);
    return /^windows-wechat-native-commands(?:-|$)/i.test(name) && fs.existsSync(path.join(dirPath, 'summary.json'));
  }).map((dirPath) => classifyNativeCommandsEvidenceDirectory(dirPath, releaseIdentity));
  sortByEvidenceTime(dirs);
  return {
    real: dirs.find((item) => item.ok && item.tier === tiers.REAL_WINDOWS) || null,
    simulator: dirs.find((item) => item.tier === tiers.SIMULATOR) || null,
    explicit: null,
  };
}

function checkWechatNativeCommands(pkg, releaseIdentity) {
  const targets = new Set(packageExtraResourceTargets(pkg));
  if (targets.has('wechat-native-runners')) {
    pass('WeChat native command runners package', 'desktop package includes wechat-native-runners', 'desktop/package.json');
  } else {
    block('WeChat native command runners package', 'desktop/package.json does not package wechat-native-runners');
  }

  const nativeEvidence = findWechatNativeCommandsEvidence(releaseIdentity);
  if (nativeEvidence.simulator) {
    pass(
      'WeChat native commands simulator evidence',
      `${nativeEvidence.simulator.detail}; simulator proves contract only`,
      rel(nativeEvidence.simulator.filePath),
      tiers.SIMULATOR,
    );
  } else {
    warn(
      'WeChat native commands simulator evidence',
      'no simulator native command evidence found; this is optional and never substitutes real Windows proof',
      '',
      tiers.SIMULATOR,
    );
  }

  if (nativeEvidence.real) {
    pass(
      'WeChat native commands real Windows evidence',
      nativeEvidence.real.detail,
      rel(nativeEvidence.real.filePath),
      tiers.REAL_WINDOWS,
    );
  } else {
    const explicitDetail = nativeEvidence.explicit
      ? ` supplied evidence is ${nativeEvidence.explicit.tier}: ${nativeEvidence.explicit.detail}.`
      : '';
    block(
      'WeChat native commands real Windows evidence',
      `No clean Windows real-machine evidence was found for all six native WeChat commands: ${wechatNativeCommands.join(', ')}.${explicitDetail}`,
      'Run node scripts/wechat-windows-native-commands-acceptance.mjs --commands --require-real-wechat-commands on a logged-in Windows WeChat desktop, then set WINDOWS_GATE_WECHAT_NATIVE_COMMAND_EVIDENCE=<dir>.',
      tiers.REAL_WINDOWS,
    );
  }
}

function classifyDbHelperEvidenceFile(filePath, releaseIdentity = null) {
  const text = readSmallText(filePath);
  if (!text) return { ok: false, tier: tiers.STATIC, filePath, detail: 'empty or unreadable' };
  const simulator = hasSimulatorMarker(filePath, text);
  const realWindows = hasRealWindowsMarker(filePath, text);
  const hasKey = /dbKeyStatus|wx_key|memory key|MemoryKey|密钥|DB key/i.test(text);
  const hasSqlcipher = /SQLCipher|DecryptWithMemoryKey|windows-wechat-db-decrypted|decrypted|解密/i.test(text);
  const hasContacts = /contacts?|联系人|contact\.db|MicroMsg\.db/i.test(text);
  const passed = /pass|passed|success|ready|decrypted|成功|已解密|正常/i.test(text);
  const releaseBinding = releaseIdentity
    ? validateEvidenceReleaseBinding(filePath, releaseIdentity)
    : { ok: true, detail: 'release binding not requested' };
  const architecture = releaseIdentity
    ? validateEvidenceArchitecture(filePath, releaseIdentity.targetArchitecture)
    : { ok: true, detail: 'architecture not requested' };
  const qualifies =
    realWindows &&
    hasKey &&
    hasSqlcipher &&
    hasContacts &&
    passed &&
    releaseBinding.ok &&
    architecture.ok;
  return {
    ok: !simulator && qualifies,
    tier: simulator ? tiers.SIMULATOR : !simulator && qualifies ? tiers.REAL_WINDOWS : tiers.STATIC,
    filePath,
    releaseBinding,
    architecture,
    detail: simulator
      ? 'simulator=true; DB helper evidence cannot satisfy commercial release'
      : `realWindows=${realWindows}, key=${hasKey}, sqlcipher=${hasSqlcipher}, contacts=${hasContacts}, passed=${passed}, releaseBinding=${releaseBinding.ok ? 'matched' : releaseBinding.detail}, architecture=${architecture.ok ? 'matched' : architecture.detail}`,
  };
}

function findWechatDbHelperEvidence(releaseIdentity = null) {
  const explicit = resolveEvidencePath(process.env.WINDOWS_GATE_WECHAT_DB_HELPER_EVIDENCE || '');
  if (explicit) {
    const classified = fs.existsSync(explicit) && fs.statSync(explicit).isDirectory()
      ? classifyDbHelperEvidenceFile(path.join(explicit, 'summary.json'), releaseIdentity)
      : classifyDbHelperEvidenceFile(explicit, releaseIdentity);
    return { real: classified.ok ? classified : null, simulator: classified.tier === tiers.SIMULATOR ? classified : null, explicit: classified };
  }
  const files = listFiles(evidenceRoot, (filePath) => /\.(md|json|txt)$/i.test(filePath));
  const classified = sortByEvidenceTime(files.map((filePath) => classifyDbHelperEvidenceFile(filePath, releaseIdentity)));
  return {
    real: classified.find((item) => item.ok && item.tier === tiers.REAL_WINDOWS) || null,
    simulator: classified.find((item) => item.tier === tiers.SIMULATOR) || null,
    explicit: null,
  };
}

function checkWechatDbHelperEvidence(releaseIdentity) {
  const evidence = findWechatDbHelperEvidence(releaseIdentity);
  if (evidence.real) {
    pass('WeChat DB/helper real Windows evidence', evidence.real.detail, rel(evidence.real.filePath), tiers.REAL_WINDOWS);
    return;
  }
  const explicitDetail = evidence.explicit ? ` supplied evidence is ${evidence.explicit.tier}: ${evidence.explicit.detail}.` : '';
  block(
    'WeChat DB/helper real Windows evidence',
    `No clean Windows real-machine DB key/helper/SQLCipher contact decrypt evidence was found under ${rel(evidenceRoot)}.${explicitDetail}`,
    'On Windows, prove wx_key/helper availability, SQLCipher decrypt, and contact table parse with contacts > 0; then set WINDOWS_GATE_WECHAT_DB_HELPER_EVIDENCE=<file-or-dir>.',
    tiers.REAL_WINDOWS,
  );
}

function classifyWindowsEvidenceMatrix(
  files,
  releaseIdentity = null,
  requiredOs = defaultRequiredWindowsEvidenceOs,
) {
  const required = [...new Set(requiredOs)];
  const evidenceByOs = {};
  for (const filePath of files) {
    const relativePath = rel(filePath);
    if (!/windows-wechat-(contacts|native-commands)/i.test(relativePath)) continue;
    const text = readSmallText(filePath);
    if (!text || hasSimulatorMarker(filePath, text) || !hasRealWindowsMarker(filePath, text)) continue;
    const binding = releaseIdentity
      ? validateEvidenceReleaseBinding(filePath, releaseIdentity)
      : { ok: true, detail: 'release binding not requested' };
    const architecture = releaseIdentity
      ? validateEvidenceArchitecture(filePath, releaseIdentity.targetArchitecture)
      : { ok: true, detail: 'architecture not requested' };
    if (!binding.ok || !architecture.ok) continue;
    for (const osKey of required) {
      const rule = windowsEvidenceOsRules[osKey];
      if (!rule || evidenceByOs[osKey]) continue;
      if (rule.pattern.test(text) || rule.pattern.test(relativePath)) {
        evidenceByOs[osKey] = { filePath, binding, architecture };
      }
    }
  }
  const missing = required.filter((osKey) => !evidenceByOs[osKey]);
  return {
    ok: missing.length === 0,
    required,
    missing,
    evidenceByOs,
  };
}

function checkWechatRealWindowsMatrix(releaseIdentity) {
  let requiredOs;
  try {
    requiredOs = resolveRequiredWindowsEvidenceOs();
  } catch (error) {
    block(
      'WeChat Windows real-machine OS coverage policy',
      error.message,
      'Use WINDOWS_GATE_REQUIRED_OS=win10 for the current release policy, or win10,win11 for an explicitly expanded matrix.',
      tiers.REAL_WINDOWS,
    );
    return;
  }
  const files = listFiles(evidenceRoot, (filePath) => /\.(md|json|txt)$/i.test(filePath));
  const classified = classifyWindowsEvidenceMatrix(files, releaseIdentity, requiredOs);
  const requiredLabels = classified.required.map((osKey) => windowsEvidenceOsRules[osKey].label);
  if (classified.ok) {
    const evidence = classified.required
      .map((osKey) => rel(classified.evidenceByOs[osKey].filePath))
      .join('; ');
    pass(
      'WeChat Windows real-machine OS coverage',
      `required OS evidence found: ${requiredLabels.join(', ')}`,
      evidence,
      tiers.REAL_WINDOWS,
    );
    return;
  }
  const missingLabels = classified.missing.map((osKey) => windowsEvidenceOsRules[osKey].label);
  block(
    'WeChat Windows real-machine OS coverage',
    `missing required OS evidence: ${missingLabels.join(', ')}`,
    `Run the contact sync and native command acceptance on ${requiredLabels.join(', ')} before commercial release. The current default is Win10; use WINDOWS_GATE_REQUIRED_OS=win10,win11 only when an expanded matrix is explicitly required.`,
    tiers.REAL_WINDOWS,
  );
}

function packagedAppVersion(appAsarPath) {
  try {
    const asar = require('@electron/asar');
    const buffer = asar.extractFile(appAsarPath, 'package.json');
    return JSON.parse(String(buffer)).version || '';
  } catch (error) {
    warn('packaged app.asar version read', error.message, 'Run npm install in desktop or rebuild win-unpacked.');
    return '';
  }
}

function checkInstallerVersion(pkg, releaseIdentity) {
  if (releaseIdentity?.targetArchitecture) {
    pass(
      'Windows candidate architecture',
      `desktop package targets ${releaseIdentity.targetArchitecture}; real Windows evidence must report the same native osArchitecture`,
      'desktop/package.json',
    );
  } else {
    block(
      'Windows candidate architecture',
      'desktop/package.json Windows target architecture is missing or ambiguous',
      'Declare exactly one build.win.target[].arch before collecting real Windows evidence.',
    );
  }
  const latestPath = path.join(desktopRoot, 'dist', 'latest.yml');
  const latest = parseLatestYml(readText(latestPath));
  if (!latest.version) {
    block('installer feed version', `missing or unreadable ${rel(latestPath)}`, 'Build Windows installer before running the release gate.');
    return;
  }
  if (latest.version !== pkg.version) {
    block('installer feed version', `latest.yml version ${latest.version} != package version ${pkg.version}`);
  } else {
    pass('installer feed version', `latest.yml version matches package version ${pkg.version}`, rel(latestPath));
  }

  const installerPath = path.join(desktopRoot, 'dist', latest.path);
  if (!latest.path || !fs.existsSync(installerPath)) {
    block('installer artifact', `missing installer from latest.yml: ${latest.path || '<empty>'}`);
    return;
  }
  if (!new RegExp(`\\b${pkg.version.replace(/\./g, '\\.')}\\b`).test(latest.path)) {
    block('installer artifact versioned filename', `${latest.path} does not include ${pkg.version}`);
  } else {
    pass('installer artifact versioned filename', latest.path, rel(installerPath));
  }

  const stat = fs.statSync(installerPath);
  if (stat.size !== latest.size) {
    block('installer artifact size', `file size ${stat.size} != latest.yml size ${latest.size}`);
  } else {
    pass('installer artifact size', `${stat.size} bytes matches latest.yml`, rel(installerPath));
  }

  const blockmapPath = `${installerPath}.blockmap`;
  if (!fs.existsSync(blockmapPath)) {
    block('installer blockmap', `missing ${rel(blockmapPath)}`);
  } else {
    pass('installer blockmap', `${path.basename(blockmapPath)} exists`, rel(blockmapPath));
  }

  const sha512 = hashFile(installerPath, 'sha512', 'base64');
  if (sha512 !== latest.sha512) {
    block('installer sha512', 'installer hash does not match latest.yml');
  } else {
    pass('installer sha512', 'installer sha512 matches latest.yml', rel(installerPath));
  }
  if (releaseIdentity?.installerSha256) {
    pass(
      'installer evidence identity',
      `appVersion=${releaseIdentity.version}; installerSha256=${releaseIdentity.installerSha256}; targetArchitecture=${releaseIdentity.targetArchitecture || 'unknown'}`,
      rel(installerPath),
    );
  } else {
    block(
      'installer evidence identity',
      'could not compute the current installer SHA-256 required to bind external acceptance evidence',
    );
  }

  if (strict || commercialRelease) {
    const signature = verifyAuthenticodeSignature(installerPath);
    if (signature.ok) {
      pass(
        'Windows installer Authenticode signature',
        signature.detail,
        rel(installerPath),
      );
    } else {
      block(
        'Windows installer Authenticode signature',
        signature.detail,
        signature.status === 'unverified'
          ? 'Install osslsigncode on non-Windows builders or run the gate on Windows with PowerShell available.'
          : 'Sign the final installer with an Authenticode code-signing certificate, then rebuild latest.yml and its blockmap.',
      );
    }
  } else {
    warn(
      'Windows installer Authenticode signature',
      'signature enforcement is disabled outside --commercial-release/--strict mode',
      'Run this gate with --commercial-release or --strict before distributing the installer.',
    );
  }

  const appAsarPath = path.join(desktopRoot, 'dist', 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(appAsarPath)) {
    block('packaged app version', `missing ${rel(appAsarPath)}`);
    return;
  }
  const asarVersion = packagedAppVersion(appAsarPath);
  if (asarVersion && asarVersion !== pkg.version) {
    block('packaged app version', `app.asar package version ${asarVersion} != ${pkg.version}`);
  } else if (asarVersion) {
    pass('packaged app version', `app.asar package version matches ${pkg.version}`, rel(appAsarPath));
  }
}

function checkPortsAndSameBuild(pkg, releaseIdentity) {
  const mainJs = readText(path.join(desktopRoot, 'main.js'));
  if (/const FRONTEND_PORT = 3010;/.test(mainJs) && /const BACKEND_PORT = 3011;/.test(mainJs)) {
    pass('desktop runtime ports', 'desktop/main.js pins frontend 3010 and backend 3011', 'desktop/main.js');
  } else {
    block('desktop runtime ports', 'desktop/main.js must keep frontend on 3010 and backend on 3011');
  }

  const backendEnv = readText(path.join(desktopRoot, 'backend.env'));
  if (/^PORT=3011/m.test(backendEnv) && /^CORS_ORIGIN=.*localhost:3010.*127\.0\.0\.1:3010/m.test(backendEnv)) {
    pass('3010/3011 CORS pair', 'desktop/backend.env binds 3011 to the 3010 origins', 'desktop/backend.env');
  } else {
    block('3010/3011 CORS pair', 'desktop/backend.env must set PORT=3011 and allow localhost/127.0.0.1:3010');
  }

  if (scanFrontendApiBase()) {
    pass('3010 frontend API base', 'frontend export points to http://localhost:3011/api or 127.0.0.1:3011/api');
  } else {
    block('3010 frontend API base', 'frontend/out chunks do not contain the 3011 API base');
  }

  const resourcesRoot = path.join(desktopRoot, 'dist', 'win-unpacked', 'resources');
  const required = [
    ['packaged frontend', path.join(resourcesRoot, 'frontend', 'index.html')],
    ['packaged backend', path.join(resourcesRoot, 'backend', 'index.js')],
    ['packaged backend env', path.join(resourcesRoot, 'backend', '.env')],
  ];
  const missing = required.filter(([, filePath]) => !fs.existsSync(filePath));
  if (missing.length) {
    block('packaged 3010/3011 resources', `missing ${missing.map(([label]) => label).join(', ')}`);
  } else {
    pass('packaged 3010/3011 resources', `frontend and backend are bundled in the same ${pkg.version} win-unpacked resources`, rel(resourcesRoot));
  }

  const uiReport = findLatestReport('growth-acquisition-commercial-', 'report.json');
  if (!uiReport) {
    block('3010/3011 browser evidence', `no growth-acquisition report.json under ${rel(evidenceRoot)}`);
    return;
  }
  const summary = uiReport.json.summary || {};
  const failed = Number(summary.failed || 0);
  const blocked = Number(summary.blocked || 0);
  const warnCount = Number(summary.warn || 0);
  const frontendOk = /:3010$/.test(uiReport.json.frontendUrl || '');
  const apiOk = /:3011\/api$/.test(uiReport.json.apiBase || '');
  const releaseBinding = validateEvidenceReleaseBinding(uiReport.filePath, releaseIdentity);
  if (frontendOk && apiOk && failed === 0 && blocked === 0 && releaseBinding.ok) {
    pass(
      '3010/3011 browser evidence',
      `latest growth UI report uses ${uiReport.json.frontendUrl} + ${uiReport.json.apiBase}; failed=${failed}, blocked=${blocked}, warn=${warnCount}; ${releaseBinding.detail}`,
      rel(uiReport.filePath),
    );
  } else {
    block(
      '3010/3011 browser evidence',
      `latest report is not clean, not on 3010/3011, or not bound to this installer: frontend=${uiReport.json.frontendUrl}, api=${uiReport.json.apiBase}, failed=${failed}, blocked=${blocked}, releaseBinding=${releaseBinding.ok ? 'matched' : releaseBinding.detail}`,
    );
  }
}

function checkWechatContactSync(pkg, releaseIdentity) {
  const targets = new Set(packageExtraResourceTargets(pkg));
  // v1.1.103（复核 P2 整改）：wechat-db-helper 已隔离为云端按需资源
  // （desktop/package.json 不得打包，OSS 打包源在 desktop/runtime/wechat-db-helper；
  // 与 verify-oss-release.js 的断言对齐）。此处改为校验隔离契约本身，
  // 不再要求安装包内置 helper。
  if (targets.has('wechat-db-helper')) {
    block(
      'WeChat contact runtime package wechat-db-helper',
      'desktop/package.json packages wechat-db-helper, but it must be isolated to OSS on-demand (see verify-oss-release.js verifyPackageContract)',
    );
  } else {
    pass('WeChat DB helper isolation', 'desktop package correctly excludes wechat-db-helper (OSS on-demand)', 'desktop/package.json');
  }
  const dbHelperOssSource = path.join(desktopRoot, 'runtime', 'wechat-db-helper', 'wechat-db-helper.js');
  if (fs.existsSync(dbHelperOssSource)) {
    pass('WeChat DB helper OSS packaging source', 'runtime/wechat-db-helper source present for cloud on-demand', 'desktop/runtime/wechat-db-helper');
  } else {
    block('WeChat DB helper OSS packaging source', `missing ${dbHelperOssSource}`);
  }
  for (const target of ['wechat-native-runtime', 'wechat-engine']) {
    if (targets.has(target)) {
      pass(`WeChat contact runtime package ${target}`, `desktop package includes ${target}`, 'desktop/package.json');
    } else {
      block(`WeChat contact runtime package ${target}`, `desktop/package.json does not package ${target}`);
    }
  }

  const installerCheck = readText(path.join(desktopRoot, 'scripts', 'check-full-installer-assets.js'));
  const hasContactRuntimeGuards =
    /assertWindowsWechatDbRuntime/.test(installerCheck) &&
    /assertWindowsWechatEngineRuntime/.test(installerCheck) &&
    /assertWindowsWechatNativeRuntime/.test(installerCheck) &&
    /wx_key\.dll/.test(installerCheck) &&
    /runWxKeyDll[\s\S]+PollKeyData/.test(installerCheck) &&
    /wechat-dump-rs\.exe/.test(installerCheck) &&
    /DbkeyHookCMD\.exe/.test(installerCheck) &&
    /dump_data\.exe/.test(installerCheck) &&
    /commercial DB key provider/.test(installerCheck);
  if (hasContactRuntimeGuards) {
    pass('WeChat contact sync static guard', 'installer asset gate checks DB helper, wx_key provider bridge, native key/dump tools, sidecar engine, and native runtime');
  } else {
    block('WeChat contact sync static guard', 'check-full-installer-assets.js must guard DB helper, wx_key provider bridge, native key/dump tools, and all Windows WeChat contact runtimes');
  }

  const contactEvidence = findWechatContactEvidence(releaseIdentity);
  if (contactEvidence.simulator) {
    pass(
      'WeChat contact sync simulator evidence',
      `${contactEvidence.simulator.detail}; simulator proves contract only`,
      rel(contactEvidence.simulator.filePath),
      tiers.SIMULATOR,
    );
  } else {
    warn(
      'WeChat contact sync simulator evidence',
      'no simulator contact evidence found; this is optional and never substitutes real Windows proof',
      '',
      tiers.SIMULATOR,
    );
  }

  if (contactEvidence.real) {
    pass(
      'WeChat contact sync real Windows evidence',
      contactEvidence.real.detail,
      rel(contactEvidence.real.filePath),
      tiers.REAL_WINDOWS,
    );
  } else {
    const explicitDetail = contactEvidence.explicit
      ? ` supplied evidence is ${contactEvidence.explicit.tier}: ${contactEvidence.explicit.detail}.`
      : '';
    block(
      'WeChat contact sync real Windows evidence',
      `No clean Windows real-machine random+all contact sync evidence was found under ${rel(evidenceRoot)}.${explicitDetail}`,
      'Run node scripts/wechat-windows-contacts-acceptance.mjs --real on Windows, keep 02/03/06 evidence + screenshots, then set WINDOWS_GATE_WECHAT_CONTACT_EVIDENCE=<dir>.',
      tiers.REAL_WINDOWS,
    );
  }
}

function checkPlatformQrBinding(releaseIdentity) {
  const commercialGate = readText(path.join(repoRoot, 'scripts', 'commercial-acceptance-gate.mjs'));
  const assistedGate = readText(path.join(repoRoot, 'scripts', 'assisted-e2e-acceptance.mjs'));
  if (/publish_accounts/.test(commercialGate) && /扫码|二维码|登录/.test(commercialGate + assistedGate)) {
    pass('platform account binding checklist', 'acceptance scripts include platform account login/QR and publish_accounts persistence checks');
  } else {
    block('platform account binding checklist', 'acceptance scripts must cover QR/login and publish_accounts persistence');
  }

  const explicitEvidence = resolveEvidencePath(process.env.WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE || '');
  const foundEvidence =
    explicitEvidence ||
    findTextEvidence(
      [/平台账号|publish_accounts|account/i, /二维码|扫码|QR|绑定/i],
      undefined,
      releaseIdentity,
    );
  const releaseBinding = foundEvidence
    ? validateEvidenceReleaseBinding(foundEvidence, releaseIdentity)
    : null;
  const architecture = foundEvidence
    ? validateEvidenceArchitecture(foundEvidence, releaseIdentity.targetArchitecture)
    : null;
  if (
    foundEvidence &&
    textEvidenceMatches(
      foundEvidence,
      [/平台账号|publish_accounts|account/i, /二维码|扫码|QR|绑定/i],
      undefined,
      releaseIdentity,
    )
  ) {
    pass(
      'platform account QR binding evidence',
      `binding evidence file is present; ${releaseBinding.detail}; ${architecture.detail}`,
      rel(foundEvidence),
      tiers.REAL_WINDOWS,
    );
  } else {
    block(
      'platform account QR binding evidence',
      `No Windows real-machine platform QR binding evidence bound to this installer was found or supplied.${releaseBinding && !releaseBinding.ok ? ` Supplied evidence rejected: ${releaseBinding.detail}.` : ''}${architecture && !architecture.ok ? ` Architecture rejected: ${architecture.detail}.` : ''}`,
      'Bind at least one platform account by QR/login on Windows, restart the app, prove the account remains ready, then set WINDOWS_GATE_ACCOUNT_BINDING_EVIDENCE=<file>.',
      tiers.REAL_WINDOWS,
    );
  }
}

function checkGrowthEvidenceChain(releaseIdentity) {
  const uiReport = findLatestReport('growth-acquisition-commercial-', 'report.json');
  if (uiReport) {
    const summary = uiReport.json.summary || {};
    const passCount = Number(summary.pass || 0);
    const failed = Number(summary.failed || 0);
    const blocked = Number(summary.blocked || 0);
    const releaseBinding = validateEvidenceReleaseBinding(uiReport.filePath, releaseIdentity);
    if (passCount > 0 && failed === 0 && blocked === 0 && releaseBinding.ok) {
      pass('growth 3010 UI evidence chain', `latest UI report PASS=${passCount}, FAILED=${failed}, BLOCKED=${blocked}; ${releaseBinding.detail}`, rel(uiReport.filePath));
    } else {
      block('growth 3010 UI evidence chain', `latest UI report is not clean or not bound to this installer: PASS=${passCount}, FAILED=${failed}, BLOCKED=${blocked}, releaseBinding=${releaseBinding.ok ? 'matched' : releaseBinding.detail}`);
    }
  } else {
    block('growth 3010 UI evidence chain', 'missing growth-acquisition commercial report');
  }

  const liveGate = findLatestReport('growth-commercial-live-gate-', 'summary.json');
  if (liveGate) {
    const checks = Array.isArray(liveGate.json.checks) ? liveGate.json.checks : [];
    const databaseRuns = checks.find((item) => item.name === 'database-runs');
    const rows = Number((databaseRuns?.detail || '').match(/rows=([0-9]+)/)?.[1] || 0);
    const releaseBinding = validateEvidenceReleaseBinding(liveGate.filePath, releaseIdentity);
    if (rows > 0 && releaseBinding.ok) {
      pass('growth 3011/database evidence chain', `latest live gate status=${liveGate.json.status}; growth_acquisition_runs rows=${rows}; ${releaseBinding.detail}`, rel(liveGate.filePath));
    } else {
      block('growth 3011/database evidence chain', `latest live gate has no growth_acquisition_runs rows or is not bound to this installer: ${databaseRuns?.detail || 'missing database-runs check'}; releaseBinding=${releaseBinding.ok ? 'matched' : releaseBinding.detail}`);
    }
    if (liveGate.json.status !== 'PASS') {
      warn(
        'current live growth readiness',
        `latest live gate status=${liveGate.json.status}; blockers=${liveGate.json.blockers || 0}`,
        'This can be acceptable for no-send safety mode, but a live commercial launch must re-run with a ready account and explicit execution approval.',
      );
    }
  } else {
    block('growth 3011/database evidence chain', 'missing growth-commercial-live-gate summary');
  }

  const closedLoopPath = path.join(evidenceRoot, 'growth-commercial-10-contact-closed-loop-20260626.md');
  const closedLoopText = readText(closedLoopPath);
  const hasClosedLoop =
    /实际触达：`?10`? 条/.test(closedLoopText) &&
    /run-\d+/.test(closedLoopText) &&
    /browser-evidence/.test(closedLoopText) &&
    /评论区已出现账号评论|已发布/.test(closedLoopText);
  const closedLoopBinding = validateEvidenceReleaseBinding(closedLoopPath, releaseIdentity);
  if (hasClosedLoop && closedLoopBinding.ok) {
    pass('growth send/readback evidence chain', `10-contact closed-loop proof includes run id, browser evidence, and published/readback wording; ${closedLoopBinding.detail}`, rel(closedLoopPath));
  } else {
    block('growth send/readback evidence chain', `missing proof bound to this installer that auto-acquisition sent to the target comment area and recorded readback evidence; releaseBinding=${closedLoopBinding.ok ? 'matched' : closedLoopBinding.detail}`);
  }

  const windowsGrowthEvidence = resolveEvidencePath(process.env.WINDOWS_GATE_GROWTH_SEND_EVIDENCE || '');
  const windowsGrowthBinding = windowsGrowthEvidence
    ? validateEvidenceReleaseBinding(windowsGrowthEvidence, releaseIdentity)
    : null;
  const windowsGrowthArchitecture = windowsGrowthEvidence
    ? validateEvidenceArchitecture(windowsGrowthEvidence, releaseIdentity.targetArchitecture)
    : null;
  if (
    windowsGrowthEvidence &&
    textEvidenceMatches(
      windowsGrowthEvidence,
      [/Windows/i, /自动获客|growth/i, /已发布|readback|评论区|contacted/i],
      undefined,
      releaseIdentity,
    )
  ) {
    pass('Windows growth live send evidence', `Windows-specific growth send evidence file is present; ${windowsGrowthBinding.detail}; ${windowsGrowthArchitecture.detail}`, rel(windowsGrowthEvidence), tiers.REAL_WINDOWS);
  } else {
    block(
      'Windows growth live send evidence',
      `Existing growth evidence proves the chain, but no Windows real-machine send/readback evidence bound to this installer was supplied.${windowsGrowthBinding && !windowsGrowthBinding.ok ? ` Supplied evidence rejected: ${windowsGrowthBinding.detail}.` : ''}${windowsGrowthArchitecture && !windowsGrowthArchitecture.ok ? ` Architecture rejected: ${windowsGrowthArchitecture.detail}.` : ''}`,
      'On Windows, run a controlled auto-acquisition task and prove the action was not left in the search box: screenshot, run id, contactedCount, and readback.',
      tiers.REAL_WINDOWS,
    );
  }
}

function printResults() {
  console.log('Windows commercial release gate');
  console.log(`Mode: ${strict ? 'strict' : 'default'}`);
  console.log(`Commercial release: ${commercialRelease ? 'yes' : 'no'}`);
  console.log(`Evidence root: ${rel(evidenceRoot)}`);
  console.log('');
  for (const item of results) {
    const evidence = item.evidence ? ` [${item.evidence}]` : '';
    console.log(`${item.status.padEnd(10)} ${item.tier.padEnd(12)} ${item.name}: ${item.detail}${evidence}`);
    if (item.nextAction) console.log(`           next: ${item.nextAction}`);
  }
  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  console.log('');
  console.log(
    `Summary: PASS=${counts.PASS || 0} WARN=${counts.WARN || 0} UNVERIFIED=${counts.UNVERIFIED || 0} BLOCKER=${counts.BLOCKER || 0}`,
  );
  const tierCounts = results.reduce((acc, item) => {
    acc[item.tier] = (acc[item.tier] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `Evidence tiers: static=${tierCounts[tiers.STATIC] || 0} simulator=${tierCounts[tiers.SIMULATOR] || 0} real-windows=${tierCounts[tiers.REAL_WINDOWS] || 0}`,
  );
}

function main() {
  const pkg = readJson(path.join(desktopRoot, 'package.json'));
  if (!pkg?.version) {
    block('desktop package version', 'desktop/package.json is missing a version');
    printResults();
    process.exit(1);
  } else {
    pass('desktop package version', `desktop/package.json version=${pkg.version}`, 'desktop/package.json');
  }
  const releaseIdentity = resolveReleaseIdentity(pkg);

  checkLiandaoStaticSmokeEvidence();
  checkInstallerVersion(pkg, releaseIdentity);
  checkPortsAndSameBuild(pkg, releaseIdentity);
  checkWechatContactSync(pkg, releaseIdentity);
  checkWechatDbHelperEvidence(releaseIdentity);
  checkWechatNativeCommands(pkg, releaseIdentity);
  checkWechatRealWindowsMatrix(releaseIdentity);
  checkPlatformQrBinding(releaseIdentity);
  checkGrowthEvidenceChain(releaseIdentity);
  printResults();

  const blockers = results.filter((item) => item.status === 'BLOCKER');
  const unverifiedItems = results.filter((item) => item.status === 'UNVERIFIED');
  process.exit(blockers.length > 0 || unverifiedItems.length > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  classifyWindowsEvidenceMatrix,
  classifyContactEvidenceDirectory,
  classifyNativeCommandsEvidenceDirectory,
  classifyTextEvidence,
  extractStructuredEvidenceArchitecture,
  extractStructuredEvidenceBinding,
  extractTextEvidenceArchitecture,
  extractTextEvidenceBinding,
  normalizeEvidenceArchitecture,
  normalizeEvidenceArchitectureSource,
  normalizeEvidencePlatform,
  normalizeEvidenceSha256,
  normalizeEvidenceVersion,
  resolveWindowsCandidateArchitecture,
  resolveRequiredWindowsEvidenceOs,
  resolveReleaseIdentity,
  textEvidenceMatches,
  validateEvidenceArchitecture,
  validateEvidenceReleaseBinding,
};
