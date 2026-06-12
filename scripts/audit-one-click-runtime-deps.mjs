#!/usr/bin/env node

/**
 * Phase 0 guardrail for the one-click desktop migration.
 *
 * This script is intentionally static and dependency-free. It does not decide
 * whether a dependency is acceptable; it makes Python/Postgres/Redis/Chrome
 * assumptions visible before each migration phase.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

const scanRoots = [
  'backend/src',
  'backend/prisma',
  'desktop',
  'scripts',
  'docs',
].filter((path) => existsSync(join(root, path)));

const ignoredPathFragments = [
  '/node_modules/',
  '/.next/',
  '/dist/',
  '/dist.bak-',
  '/__pycache__/',
  '/.venv/',
  '/coverage/',
  '/frontend/out/',
  '/desktop/dist',
  '/desktop/runtime/playwright-browsers/',
];

const fileExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.prisma',
  '.ps1',
  '.md',
  '.html',
  '.env',
  '.example',
]);

const groups = [
  {
    id: 'python',
    label: 'Python / Agent-S sidecar',
    phaseTarget: 'Phase 1: replace Python sidecar product path with Node Agent Runtime',
    patterns: [
      /\bpython(?:3(?:\.12)?)?\b/i,
      /pyinstaller|nuitka/i,
      /agent-s-executor/i,
      /sidecars\/agent-s/i,
      /requirements\.txt/i,
      /venv/i,
    ],
  },
  {
    id: 'postgres',
    label: 'Postgres / Prisma provider',
    phaseTarget: 'Phase 2: move product storage to SQLite/local store',
    patterns: [
      /postgres(?:ql)?/i,
      /DATABASE_URL/i,
      /provider\s*=\s*"postgresql"/i,
      /pg\b/i,
    ],
  },
  {
    id: 'redis',
    label: 'Redis / BullMQ',
    phaseTarget: 'Phase 2: keep product queue in SQLite/in-process worker',
    patterns: [
      /\bredis\b/i,
      /ioredis/i,
      /bullmq/i,
      /@nestjs\/bullmq/i,
      /REDIS_/i,
    ],
  },
  {
    id: 'chrome',
    label: 'System Chrome',
    phaseTarget: 'Phase 3: use bundled Playwright Chromium as product default',
    patterns: [
      /Google Chrome/i,
      /ChromeStandalone/i,
      /LOCAL_BROWSER_CHROME_PATH/i,
      /executablePath/i,
      /chrome\.exe/i,
    ],
  },
  {
    id: 'playwright',
    label: 'Playwright / Chromium',
    phaseTarget: 'Phase 3: pin bundled browser path and avoid runtime npx downloads',
    patterns: [
      /playwright/i,
      /chromium/i,
      /@playwright\/mcp/i,
      /npx\s+@playwright/i,
    ],
  },
  {
    id: 'agentSApi',
    label: 'Agent-S API contract',
    phaseTarget: 'Phase 1: preserve API shape while swapping implementation',
    patterns: [
      /\/agent-s/i,
      /agent-sessions/i,
      /AgentSService/i,
      /AGENT_S_BASE_URL/i,
      /KAYPAL_AGENT_S_TOKEN/i,
    ],
  },
];

function shouldScanFile(filePath) {
  const normalized = `/${relative(root, filePath).replaceAll('\\', '/')}`;
  if (ignoredPathFragments.some((fragment) => normalized.includes(fragment))) {
    return false;
  }
  const extension = normalized.match(/(\.[^.\/]+)$/)?.[1] ?? '';
  if (fileExtensions.has(extension)) return true;
  return normalized.endsWith('/.env.example') || normalized.endsWith('/backend.env');
}

function walk(dir) {
  const output = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const normalized = `/${relative(root, fullPath).replaceAll('\\', '/')}`;
    if (ignoredPathFragments.some((fragment) => normalized.includes(fragment))) {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      output.push(...walk(fullPath));
      continue;
    }
    if (stat.isFile() && shouldScanFile(fullPath)) {
      output.push(fullPath);
    }
  }
  return output;
}

const files = scanRoots.flatMap((scanRoot) => walk(join(root, scanRoot)));
const report = {
  generatedAt: new Date().toISOString(),
  cwd: root,
  scannedRoots: scanRoots,
  scannedFileCount: files.length,
  groups: Object.fromEntries(
    groups.map((group) => [
      group.id,
      {
        label: group.label,
        phaseTarget: group.phaseTarget,
        matchCount: 0,
        files: {},
      },
    ]),
  ),
};

for (const filePath of files) {
  const rel = relative(root, filePath);
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split(/\r?\n/);

  for (const group of groups) {
    const matches = [];
    lines.forEach((line, index) => {
      if (group.patterns.some((pattern) => pattern.test(line))) {
        matches.push({
          line: index + 1,
          text: line.trim().slice(0, 220),
        });
      }
    });
    if (matches.length > 0) {
      report.groups[group.id].matchCount += matches.length;
      report.groups[group.id].files[rel] = matches.slice(0, 12);
    }
  }
}

const summary = Object.fromEntries(
  Object.entries(report.groups).map(([key, value]) => [
    key,
    {
      label: value.label,
      matchCount: value.matchCount,
      fileCount: Object.keys(value.files).length,
      phaseTarget: value.phaseTarget,
    },
  ]),
);

if (process.argv.includes('--summary')) {
  console.log(JSON.stringify({ generatedAt: report.generatedAt, summary }, null, 2));
} else {
  console.log(JSON.stringify({ ...report, summary }, null, 2));
}
