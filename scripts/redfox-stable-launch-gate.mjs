#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const args = parseArgs(process.argv.slice(2));

const planDoc = join(repoRoot, 'docs', 'redfox-skills-integration-stable-launch-plan-2026-06-29.md');
const gateDoc = join(repoRoot, 'docs', 'redfox-stable-launch-gate-matrix-2026-06-29.md');
const apiBase = stripTrailingSlash(args.apiBase || process.env.API_BASE || 'http://localhost:3011/api');
const live = args.live || process.env.REDFOX_GATE_LIVE === '1';
const writeReport = args.writeReport || live;
const evidenceDir =
  args.evidenceDir ||
  process.env.REDFOX_GATE_EVIDENCE_DIR ||
  join(repoRoot, 'docs', `acceptance-evidence-${dateForFile()}`, `redfox-stable-launch-gate-${timestampForFile()}`);

const gates = [
  {
    id: 1,
    name: 'RedFox connection',
    title: 'Gate 1 - RedFox 连接',
    fragments: ['API Key 保存', 'API Key 加密存储', '后端代理约束', '连接证据链'],
    live: [{ method: 'GET', path: '/redfox/connection', label: 'connection-read' }],
  },
  {
    id: 2,
    name: 'Skill sync',
    title: 'Gate 2 - Skill 同步',
    fragments: ['Skill 同步入口', '目录字段标准化', '同步失败降级', 'Skill 可见范围'],
    live: [{ method: 'GET', path: '/redfox/skills', label: 'skills-read' }],
  },
  {
    id: 3,
    name: 'Intelligence import',
    title: 'Gate 3 - 情报导入',
    fragments: ['热点拉取', '平台搜索', '去重', '租户隔离'],
    live: [{ method: 'GET', path: '/intelligence', label: 'intelligence-read' }],
  },
  {
    id: 4,
    name: 'Content linkage',
    title: 'Gate 4 - 内容联动',
    fragments: ['导入内容素材', '生成选题', '失败保留草稿', '证据关联'],
    live: [],
  },
  {
    id: 5,
    name: 'Compliance',
    title: 'Gate 5 - 合规审核',
    fragments: ['合规审核 API', '发布前 Gate', '审核失败降级', '证据链'],
    live: [{ method: 'GET', path: '/compliance/checks', label: 'compliance-history-read' }],
  },
  {
    id: 6,
    name: 'Comment insights',
    title: 'Gate 6 - 评论洞察',
    fragments: ['评论来源输入', '回复建议', '自动发送禁止', '失败和空评论'],
    live: [{ method: 'GET', path: '/comment-insights', label: 'comment-insights-read' }],
  },
  {
    id: 7,
    name: 'Cost control',
    title: 'Gate 7 - 成本控制',
    fragments: ['调用日志', '成本汇总', '用户日限额', '租户日限额', '高成本确认'],
    live: [
      { method: 'GET', path: '/redfox/call-logs', label: 'call-logs-read' },
      { method: 'GET', path: '/redfox/costs/summary', label: 'cost-summary-read' },
    ],
  },
  {
    id: 8,
    name: 'Permission security',
    title: 'Gate 8 - 权限安全',
    fragments: ['鉴权必需', 'RBAC', '租户 A/B 隔离', 'API Key 脱敏', '敏感日志扫描'],
    live: [],
  },
  {
    id: 9,
    name: 'Fallback',
    title: 'Gate 9 - 降级兜底',
    fragments: ['RedFox 5xx', 'RedFox 超时', 'Key 过期', '限额耗尽', '旧功能不受影响'],
    live: [],
  },
  {
    id: 10,
    name: 'Operations usability',
    title: 'Gate 10 - 运营可用',
    fragments: ['运营手册', '首次配置', '核心流程', '异常处理 Runbook', '发布签核'],
    live: [],
  },
];

const globalFragments = [
  'API Key 脱敏',
  '租户隔离',
  '调用限额',
  '失败降级',
  '证据链',
  'REDFOX_API_BASE_URL',
  'REDFOX_DAILY_USER_LIMIT',
  'REDFOX_DAILY_TENANT_LIMIT',
  'REDFOX_RETRY_MAX_ATTEMPTS',
];

const results = [];
const liveEvidence = [];

await main();

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  if (args.listOnly) {
    printChecklist();
    return;
  }

  checkStaticDocs();

  if (live) {
    await runLiveReadOnlyChecks();
  } else {
    addResult(
      'WARN',
      'live-read-only-smoke-skipped',
      'Live API smoke was skipped. Set REDFOX_GATE_LIVE=1 or pass --live after RedFox API routes land.',
      'Run with a test tenant and auth cookie before release candidate signoff.',
    );
  }

  if (writeReport) {
    writeGateReport();
  }

  printSummary();

  const failed = results.some((item) => item.status === 'FAILED');
  const blocked = results.some((item) => item.status === 'BLOCKED');
  process.exitCode = failed ? 1 : blocked && live ? 2 : 0;
}

function checkStaticDocs() {
  addResult(
    existsSync(planDoc) ? 'PASS' : 'FAILED',
    'plan-doc-exists',
    relative(planDoc),
    existsSync(planDoc) ? '' : 'Restore or create the RedFox stable launch plan document.',
  );
  addResult(
    existsSync(gateDoc) ? 'PASS' : 'FAILED',
    'gate-matrix-doc-exists',
    relative(gateDoc),
    existsSync(gateDoc) ? '' : 'Create the RedFox Gate 1-10 matrix before release planning.',
  );

  if (!existsSync(gateDoc)) {
    return;
  }

  const text = readFileSync(gateDoc, 'utf8');
  for (const gate of gates) {
    const missing = [gate.title, ...gate.fragments].filter((fragment) => !text.includes(fragment));
    addResult(
      missing.length === 0 ? 'PASS' : 'FAILED',
      `gate-${String(gate.id).padStart(2, '0')}-matrix-fragments`,
      missing.length === 0 ? `${gate.title} matrix fragments are present.` : `Missing: ${missing.join(', ')}`,
      missing.length === 0 ? '' : `Update ${relative(gateDoc)} with the missing Gate ${gate.id} fragments.`,
      { gate: gate.id, missing },
    );
  }

  const globalMissing = globalFragments.filter((fragment) => !text.includes(fragment));
  addResult(
    globalMissing.length === 0 ? 'PASS' : 'FAILED',
    'global-security-fragments',
    globalMissing.length === 0 ? 'Global security fragments are present.' : `Missing: ${globalMissing.join(', ')}`,
    globalMissing.length === 0 ? '' : `Update ${relative(gateDoc)} with the missing security fragments.`,
    { missing: globalMissing },
  );
}

async function runLiveReadOnlyChecks() {
  const headers = buildHeaders();
  const allChecks = gates.flatMap((gate) => gate.live.map((check) => ({ ...check, gate: gate.id })));
  if (allChecks.length === 0) {
    addResult('WARN', 'live-checks-empty', 'No read-only live checks are configured.', 'Add GET endpoints after modules land.');
    return;
  }

  for (const check of allChecks) {
    const response = await apiRequest(check.method, check.path, headers);
    liveEvidence.push({ ...check, response: redact(response) });
    const status = liveStatus(response);
    const details = `Gate ${check.gate} ${check.label}: ${check.method} ${check.path} -> HTTP ${response.status}`;
    addResult(
      status,
      `gate-${String(check.gate).padStart(2, '0')}-${check.label}`,
      details,
      liveNextStep(response, check.path),
      { gate: check.gate, path: check.path, httpStatus: response.status },
    );
  }
}

async function apiRequest(method, path, headers) {
  const url = `${apiBase}${path}`;
  const startedAt = Date.now();
  const timeoutMs = Number(process.env.REDFOX_GATE_TIMEOUT_MS || 12000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers, signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      body: parseJson(text),
      bodyPreview: text.slice(0, 1000),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function liveStatus(response) {
  if (response.ok) {
    return 'PASS';
  }
  if ([401, 403, 404, 405].includes(response.status) || response.status === 0) {
    return 'BLOCKED';
  }
  return 'FAILED';
}

function liveNextStep(response, path) {
  if (response.ok) {
    return '';
  }
  if (response.status === 401 || response.status === 403) {
    return 'Provide a test tenant auth cookie through REDFOX_GATE_COOKIE_HEADER or COMMERCIAL_COOKIE_HEADER.';
  }
  if (response.status === 404 || response.status === 405) {
    return `Implement or route ${path}, then rerun the read-only gate.`;
  }
  if (response.status === 0) {
    return 'Start the backend on API_BASE or fix network/timeout before rerunning.';
  }
  return 'Inspect backend logs and RedFox module error mapping.';
}

function buildHeaders() {
  const headers = { Accept: 'application/json' };
  const cookieHeader = process.env.REDFOX_GATE_COOKIE_HEADER || process.env.COMMERCIAL_COOKIE_HEADER || '';
  const sessionToken = process.env.REDFOX_GATE_SESSION_TOKEN || process.env.COMMERCIAL_SESSION_TOKEN || '';
  const bearer = process.env.REDFOX_GATE_BEARER_TOKEN || '';
  const authCookieName = process.env.AUTH_COOKIE_NAME || 'ai_content_session';

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  } else if (sessionToken) {
    headers.Cookie = `${authCookieName}=${sessionToken}`;
  }
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  return headers;
}

function writeGateReport() {
  mkdirSync(evidenceDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    apiBase,
    live,
    statusCounts: countStatuses(results),
    results,
    liveEvidence,
  };
  writeFileSync(join(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(evidenceDir, 'report.md'), renderMarkdownReport(summary));
  addResult('PASS', 'gate-report-written', relative(evidenceDir), '');
}

function renderMarkdownReport(summary) {
  const lines = [
    '# RedFox Stable Launch Gate Report',
    '',
    `Generated at: ${summary.generatedAt}`,
    '',
    `API base: ${apiBase}`,
    '',
    `Live read-only smoke: ${live ? 'enabled' : 'skipped'}`,
    '',
    '## Status Counts',
    '',
    '| Status | Count |',
    '| --- | --- |',
  ];
  for (const [status, count] of Object.entries(summary.statusCounts)) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push('', '## Results', '', '| Status | Check | Details | Next step |', '| --- | --- | --- | --- |');
  for (const result of results) {
    lines.push(
      `| ${result.status} | ${escapePipes(result.name)} | ${escapePipes(result.details)} | ${escapePipes(result.nextStep || '')} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function printChecklist() {
  console.log('RedFox stable launch Gate checklist');
  for (const gate of gates) {
    console.log(`\nGate ${gate.id}: ${gate.name}`);
    for (const fragment of gate.fragments) {
      console.log(`- ${fragment}`);
    }
  }
  console.log('\nGlobal security fragments');
  for (const fragment of globalFragments) {
    console.log(`- ${fragment}`);
  }
}

function printSummary() {
  const counts = countStatuses(results);
  console.log('RedFox stable launch gate summary');
  console.log(`PASS=${counts.PASS || 0} WARN=${counts.WARN || 0} BLOCKED=${counts.BLOCKED || 0} FAILED=${counts.FAILED || 0}`);
  for (const item of results) {
    console.log(`[${item.status}] ${item.name}: ${item.details}${item.nextStep ? ` | next: ${item.nextStep}` : ''}`);
  }
}

function addResult(status, name, details, nextStep = '', meta = {}) {
  results.push({ status, name, details, nextStep, meta });
}

function countStatuses(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function parseArgs(argv) {
  const parsed = {
    live: false,
    writeReport: false,
    listOnly: false,
    help: false,
    apiBase: '',
    evidenceDir: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') parsed.live = true;
    else if (arg === '--write-report') parsed.writeReport = true;
    else if (arg === '--list-only') parsed.listOnly = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--api-base') parsed.apiBase = argv[++index] || '';
    else if (arg === '--evidence-dir') parsed.evidenceDir = argv[++index] || '';
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/redfox-stable-launch-gate.mjs --list-only
  node scripts/redfox-stable-launch-gate.mjs
  REDFOX_GATE_LIVE=1 REDFOX_GATE_COOKIE_HEADER='ai_content_session=...' node scripts/redfox-stable-launch-gate.mjs

Options:
  --list-only       Print Gate 1-10 checklist without checking files.
  --live            Run read-only API smoke against API_BASE.
  --write-report    Write summary.json and report.md.
  --api-base URL    Override API base, default http://localhost:3011/api.
  --evidence-dir D  Override evidence directory.
`);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redact(value) {
  const text = JSON.stringify(value, null, 2)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[REDACTED]')
    .replace(/(ai_content_session=)[^;"\s]+/g, '$1[REDACTED]')
    .replace(/(REDFOX_API_KEY["':=\s]+)[^"',\s]+/g, '$1[REDACTED]')
    .replace(/(apiKey["']?\s*:\s*["'])[^"']+(["'])/gi, '$1[REDACTED]$2')
    .replace(/(authorization["']?\s*:\s*["'])[^"']+(["'])/gi, '$1[REDACTED]$2');
  return parseJson(text) || text;
}

function relative(filePath) {
  return filePath.replace(`${repoRoot}/`, '');
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function dateForFile(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
}

function escapePipes(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
