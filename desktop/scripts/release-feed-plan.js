const fs = require('fs');
const path = require('path');

// v1.1.110（复核 / 大王决策）：Linux 桌面端已退出产品范围（1.1.99 后仅 1.1.107
// 保留为最后一代），发布计划默认只覆盖 Win/Mac 双通道。
const DEFAULT_FEED_FILES = ['latest.yml', 'latest-mac.yml'];
const BLOCKMAP_FEED_FILES = new Set(['latest.yml', 'latest-mac.yml']);
const ARTIFACT_EXTENSIONS = new Set([
  '.exe',
  '.dmg',
  '.zip',
  '.appimage',
  '.deb',
  '.snap',
  '.pkg',
]);
const UPLOAD_EXTENSIONS = new Set([
  ...ARTIFACT_EXTENSIONS,
  '.blockmap',
  '.yml',
  '.asc',
]);

function stripQuotes(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeFeedReference(value) {
  const raw = stripQuotes(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return decodeURIComponent(path.basename(url.pathname));
    } catch {
      return raw;
    }
  }
  return raw.replace(/^\.\//, '').replace(/\\/g, '/');
}

function parseFeedReferences(content) {
  const references = new Set();
  for (const match of String(content || '').matchAll(/^\s*-\s+url:\s*(.+?)\s*$/gm)) {
    const value = normalizeFeedReference(match[1]);
    if (value) references.add(value);
  }
  const pathMatch = String(content || '').match(/^path:\s*(.+?)\s*$/m);
  const value = normalizeFeedReference(pathMatch?.[1]);
  if (value) references.add(value);
  return references;
}

function isInstallerArtifact(fileName) {
  return ARTIFACT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isUploadable(fileName) {
  return UPLOAD_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function uploadPriority(fileName, feedFiles = DEFAULT_FEED_FILES) {
  const feedIndex = feedFiles.indexOf(fileName);
  if (feedIndex >= 0) return 2 + feedIndex;
  if (fileName.toLowerCase().endsWith('.blockmap')) return 1;
  return 0;
}

function orderUploadFiles(files, feedFiles = DEFAULT_FEED_FILES) {
  return [...files].sort((left, right) => {
    const priority = uploadPriority(left, feedFiles) - uploadPriority(right, feedFiles);
    return priority || left.localeCompare(right);
  });
}

function buildUploadPlan({ distDir, feedFiles = DEFAULT_FEED_FILES }) {
  const existingFeeds = feedFiles.filter((feedName) =>
    fs.existsSync(path.join(distDir, feedName)),
  );
  const referenced = new Set(existingFeeds);
  const feedReferences = new Map();
  for (const feedName of existingFeeds) {
    const feedPath = path.join(distDir, feedName);
    for (const reference of parseFeedReferences(fs.readFileSync(feedPath, 'utf8'))) {
      referenced.add(reference);
      if (!feedReferences.has(reference)) feedReferences.set(reference, new Set());
      feedReferences.get(reference).add(feedName);
    }
  }

  const missing = [];
  for (const reference of [...referenced]) {
    if (feedFiles.includes(reference)) continue;
    if (!fs.existsSync(path.join(distDir, reference))) {
      missing.push(reference);
      continue;
    }
    if (isInstallerArtifact(reference) &&
        [...(feedReferences.get(reference) || [])].some((feedName) => BLOCKMAP_FEED_FILES.has(feedName))) {
      const blockmap = `${reference}.blockmap`;
      if (!fs.existsSync(path.join(distDir, blockmap))) missing.push(blockmap);
      else referenced.add(blockmap);
    }
  }

  const files = orderUploadFiles(
    [...referenced].filter((fileName) => {
      if (!isUploadable(fileName)) return false;
      return fs.existsSync(path.join(distDir, fileName)) && fs.statSync(path.join(distDir, fileName)).isFile();
    }),
    feedFiles,
  );
  return { files, feedFiles: existingFeeds, missing };
}

module.exports = {
  DEFAULT_FEED_FILES,
  BLOCKMAP_FEED_FILES,
  buildUploadPlan,
  isInstallerArtifact,
  normalizeFeedReference,
  orderUploadFiles,
  parseFeedReferences,
  uploadPriority,
};
