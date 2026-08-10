#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseEvidence } from './lib/release-evidence.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const releaseEvidence = readReleaseEvidence();
const apiBase = stripTrailingSlash(process.env.API_BASE || 'http://localhost:3011/api');
const frontendUrl = stripTrailingSlash(process.env.FRONTEND_URL || 'http://localhost:3010');
const cookieHeader = process.env.GROWTH_ACCEPTANCE_COOKIE_HEADER || process.env.COMMERCIAL_COOKIE_HEADER || '';
const cookieFile = process.env.GROWTH_ACCEPTANCE_COOKIE_FILE || process.env.COMMERCIAL_COOKIE_FILE || '';
const providedSessionToken = process.env.GROWTH_ACCEPTANCE_SESSION_TOKEN || process.env.COMMERCIAL_SESSION_TOKEN || '';
const localAcceptanceLoginEnabled =
  process.env.GROWTH_ACCEPTANCE_LOCAL_LOGIN === '1' ||
  process.env.COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN === '1' ||
  process.env.SMOKE_LOCAL_ACCEPTANCE_LOGIN === '1';
const databasePath = resolveDatabasePath();
const evidenceDir =
  process.env.GROWTH_LIVE_GATE_EVIDENCE_DIR ||
  join(repoRoot, 'docs', `acceptance-evidence-${dateForFile()}`, `growth-commercial-live-gate-${timestampForFile()}`);

let createdLocalSessionId = '';
let createdLocalSessionToken = '';

const checks = [];
const evidence = {
  readOnly: true,
  apiBase,
  frontendUrl,
  databasePath,
  backend: {},
  auth: null,
  runtimeStatus: null,
  commercialLiveGate: null,
  accountHealth: null,
  schedulePlan: null,
  overview: null,
  reports: null,
  database: null,
};

process.once('exit', cleanupLocalAcceptanceSession);

await main();

async function main() {
  mkdirSync(evidenceDir, { recursive: true });

  const backend = inspectBackendProcess();
  evidence.backend = backend;
  addCheck(backend.pid ? 'pass' : 'blocker', 'backend-process', backend.pid ? `Backend listening on 3011, pid=${backend.pid}.` : 'No backend process is listening on 3011.');

  createLocalAcceptanceSessionIfRequested();

  const cookie = loadCookieHeader();
  addCheck(
    cookie ? 'pass' : 'blocker',
    'auth-cookie',
    appendNextSteps(
      cookie ? 'Auth cookie/session token was provided to the gate.' : 'No auth cookie/session token was provided.',
      cookie ? [] : [authSessionNextStep()],
    ),
  );

  const auth = await apiGet('/auth/me', cookie);
  evidence.auth = redact(auth);
  const user = auth.body?.data;
  addCheck(
    auth.ok ? 'pass' : 'blocker',
    'auth-me',
    appendNextSteps(
      auth.ok ? `Authenticated as ${user?.name || user?.username || user?.id}.` : `Auth failed: HTTP ${auth.status}.`,
      auth.ok ? [] : [apiNextStep('/api/auth/me', auth)],
    ),
  );
  if (auth.ok) {
    const commercialAllowed = user?.commercialExecutionAllowed === true;
    const planMode = `${user?.planMode || ''}`.toLowerCase();
    addCheck(
      commercialAllowed && planMode === 'commercial' ? 'pass' : 'blocker',
      'commercial-permission',
      appendNextSteps(
        `commercialExecutionAllowed=${commercialAllowed}, planMode=${planMode || 'missing'}, kaypalPlan=${user?.kaypalPlan || 'missing'}, expired=${user?.kaypalPlanExpired}.`,
        commercialAllowed && planMode === 'commercial'
          ? []
          : ['Use a non-expired commercial account with commercialExecutionAllowed=true, then rerun the gate.'],
      ),
    );
  }

  const runtimeStatus = await apiGet('/growth/runtime-status', cookie);
  evidence.runtimeStatus = redact(runtimeStatus);
  const runtimeData = runtimeStatus.body?.data || runtimeStatus.body || {};
  const runtimeStatusOk = runtimeStatus.ok;
  const executionEnabled = runtimeStatusOk
    ? runtimeData.executionEnabled === true
    : backend.env.GROWTH_EXECUTION_ENABLED === 'true';
  const schedulerDaemonEnabled = runtimeStatusOk
    ? runtimeData.schedulerDaemonEnabled === true
    : backend.env.GROWTH_SCHEDULER_DAEMON === 'true';
  const schedulerDaemonArmed =
    runtimeStatusOk
      ? runtimeData.schedulerDaemonArmed === true
      : executionEnabled &&
        backend.env.GROWTH_SCHEDULER_DAEMON === 'true' &&
        backend.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED === 'true';
  const runtimeNextSteps = [];
  if (!runtimeStatusOk) {
    runtimeNextSteps.push(apiNextStep('/api/growth/runtime-status', runtimeStatus));
  }
  if (!executionEnabled) {
    runtimeNextSteps.push('For commercial live execution, explicitly set GROWTH_EXECUTION_ENABLED=true and restart the backend.');
  }
  if (!schedulerDaemonEnabled) {
    runtimeNextSteps.push('For unattended commercial scheduling, explicitly set GROWTH_SCHEDULER_DAEMON=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true.');
  }
  if (schedulerDaemonEnabled && !schedulerDaemonArmed) {
    runtimeNextSteps.push('Arm unattended real scheduling by also setting GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true.');
  }
  addCheck(
    runtimeStatusOk && executionEnabled ? 'pass' : 'blocker',
    'growth-execution-switch',
    appendNextSteps(
      runtimeStatusOk
        ? `executionEnabled=${executionEnabled}; runtimeStatus.executionEnabled=${runtimeData.executionEnabled}; processEnv=${backend.env.GROWTH_EXECUTION_ENABLED || 'missing'}.`
        : `executionEnabled=${executionEnabled}; runtime status unavailable: HTTP ${runtimeStatus.status}; processEnv=${backend.env.GROWTH_EXECUTION_ENABLED || 'missing'}.`,
      runtimeNextSteps.filter((item) => /runtime-status|GROWTH_EXECUTION_ENABLED|commercial session/.test(item)),
    ),
  );
  addCheck(
    runtimeStatusOk && schedulerDaemonArmed ? 'pass' : 'blocker',
    'growth-scheduler-daemon-armed',
    appendNextSteps(
      runtimeStatusOk
        ? `schedulerDaemonEnabled=${schedulerDaemonEnabled}; schedulerDaemonArmed=${schedulerDaemonArmed}; envDaemon=${backend.env.GROWTH_SCHEDULER_DAEMON || 'missing'}; envRealAllowed=${backend.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED || 'missing'}.`
        : `schedulerDaemonEnabled=${schedulerDaemonEnabled}; schedulerDaemonArmed=${schedulerDaemonArmed}; runtime status unavailable: HTTP ${runtimeStatus.status}; envDaemon=${backend.env.GROWTH_SCHEDULER_DAEMON || 'missing'}; envRealAllowed=${backend.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED || 'missing'}.`,
      runtimeNextSteps.filter((item) => /runtime-status|GROWTH_SCHEDULER|commercial session/.test(item)),
    ),
  );

  const accountHealth = await apiGet('/growth/account-health', cookie);
  evidence.accountHealth = redact(accountHealth);
  const accounts = Array.isArray(accountHealth.body?.data) ? accountHealth.body.data : [];
  const onlineAccounts = accounts.filter((item) => item.loginStatus === 'online' && item.riskStatus === 'normal');
  const onlineNormalAccountCount = onlineAccounts.length;
  const accountNextSteps = [];
  if (!accountHealth.ok) {
    accountNextSteps.push(apiNextStep('/api/growth/account-health', accountHealth));
  } else if (onlineNormalAccountCount === 0) {
    accountNextSteps.push('Log in or re-authorize at least one real platform account, then re-run the account health check.');
  }
  addCheck(
    accountHealth.ok && onlineNormalAccountCount > 0 ? 'pass' : 'blocker',
    'verified-growth-account',
    appendNextSteps(
      accountHealth.ok
        ? `visibleAccounts=${accounts.length}, onlineNormalAccountCount=${onlineNormalAccountCount}.`
        : `visibleAccounts=0, onlineNormalAccountCount=0; account health API failed: HTTP ${accountHealth.status}.`,
      accountNextSteps,
    ),
  );

  const schedulePlan = await apiGet('/growth/acquisition/schedule-plan', cookie);
  evidence.schedulePlan = redact(schedulePlan);
  const plan = schedulePlan.body?.data;
  const readyCount = Number(plan?.readyCount || 0);
  const scheduleNextSteps = [];
  if (!schedulePlan.ok) {
    scheduleNextSteps.push(apiNextStep('/api/growth/acquisition/schedule-plan', schedulePlan));
  } else if (readyCount === 0) {
    scheduleNextSteps.push('Enable at least one scheduled auto-risk acquisition task bound to an online-normal real account with remaining daily quota.');
  }
  addCheck(
    schedulePlan.ok ? 'pass' : 'blocker',
    'schedule-plan-api',
    appendNextSteps(
      schedulePlan.ok ? `items=${plan?.items?.length || 0}, readyCount=${readyCount}, blocked=${plan?.blockedCount || 0}, waiting=${plan?.waitingCount || 0}.` : `Schedule plan failed: HTTP ${schedulePlan.status}.`,
      schedulePlan.ok ? [] : scheduleNextSteps,
    ),
  );
  addCheck(
    schedulePlan.ok && (plan?.items || []).some((item) => item.status === 'ready' && item.riskMode !== 'confirm-first') ? 'pass' : 'blocker',
    'ready-auto-task',
    appendNextSteps(
      schedulePlan.ok
        ? `readyCount=${readyCount}; a commercial live execution test needs at least one ready auto task bound to a verified account.`
        : 'readyCount=0; schedule plan unavailable.',
      scheduleNextSteps,
    ),
  );

  const liveGateNextSteps = uniqueNextSteps([
    ...runtimeNextSteps,
    ...accountNextSteps,
    ...scheduleNextSteps,
  ]);
  evidence.commercialLiveGate = {
    readOnly: true,
    executionEnabled,
    schedulerDaemonEnabled,
    schedulerDaemonArmed,
    readyCount,
    onlineNormalAccountCount,
    nextSteps: liveGateNextSteps,
  };
  addCheck(
    runtimeStatusOk &&
      accountHealth.ok &&
      schedulePlan.ok &&
      executionEnabled &&
      schedulerDaemonArmed &&
      readyCount > 0 &&
      onlineNormalAccountCount > 0
      ? 'pass'
      : 'blocker',
    'commercial-live-prerequisites-read-only',
    appendNextSteps(
      `executionEnabled=${executionEnabled}; schedulerDaemonEnabled=${schedulerDaemonEnabled}; schedulerDaemonArmed=${schedulerDaemonArmed}; readyCount=${readyCount}; onlineNormalAccountCount=${onlineNormalAccountCount}.`,
      liveGateNextSteps,
    ),
  );

  const overview = await apiGet('/growth/overview', cookie);
  evidence.overview = redact(overview);
  const overviewData = overview.body?.data;
  addCheck(
    overview.ok ? 'pass' : 'blocker',
    'overview-api',
    overview.ok ? `activeConfigCount=${overviewData?.activeConfigCount || 0}, todayLeadCount=${overviewData?.todayLeadCount || 0}, contacted=${overviewData?.todayContactedCount || 0}.` : `Overview failed: HTTP ${overview.status}.`,
  );

  const reports = await apiGet('/growth/reports', cookie);
  evidence.reports = redact(reports);
  const reportData = reports.body?.data;
  const saysNoBlocker =
    Array.isArray(reportData?.bottlenecks) &&
    reportData.bottlenecks.some((item) => /没有明显阻塞/.test(`${item.title} ${item.detail}`));
  addCheck(
    reports.ok && !(saysNoBlocker && accounts.length === 0) ? 'pass' : 'blocker',
    'report-diagnosis-honesty',
    reports.ok
      ? `bottlenecks=${reportData?.bottlenecks?.length || 0}; visibleAccounts=${accounts.length}; no-blocker-copy=${saysNoBlocker}.`
      : `Reports failed: HTTP ${reports.status}.`,
  );

  const database = inspectDatabase();
  evidence.database = database;
  addCheck(database.ok ? 'pass' : 'blocker', 'database-readable', database.ok ? `Read SQLite database at ${databasePath}.` : database.error || 'Database not readable.');
  if (database.ok) {
    addCheck(database.tables.growth_account_health > 0 ? 'pass' : 'blocker', 'database-account-health', `growth_account_health rows=${database.tables.growth_account_health}.`);
    addCheck(database.tables.growth_acquisition_configs > 0 ? 'pass' : 'blocker', 'database-configs', `growth_acquisition_configs rows=${database.tables.growth_acquisition_configs}.`);
    addCheck(database.tables.growth_acquisition_runs > 0 ? 'pass' : 'blocker', 'database-runs', `growth_acquisition_runs rows=${database.tables.growth_acquisition_runs}.`);
  }

  writeReports();
  printSummary();
  cleanupLocalAcceptanceSession();
  process.exit(checks.some((item) => item.status === 'blocker') ? 1 : 0);
}

async function apiGet(path, cookie) {
  try {
    const response = await fetch(`${apiBase}${path}`, {
      headers: cookie ? { cookie } : {},
    });
    const text = await response.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep raw text.
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function addCheck(status, name, detail) {
  checks.push({ status, name, detail });
  const label = status.toUpperCase();
  console.log(`${label} ${name}: ${detail}`);
}

function inspectBackendProcess() {
  try {
    const lsof = execFileSync('lsof', ['-nP', '-iTCP:3011', '-sTCP:LISTEN'], { encoding: 'utf8' });
    const line = lsof.split(/\r?\n/).find((item) => /^node\s+/.test(item));
    const pid = line?.trim().split(/\s+/)[1] || '';
    const ps = pid ? execFileSync('ps', ['eww', '-p', pid], { encoding: 'utf8' }) : '';
    return {
      pid,
      command: redactText(ps.split(/\r?\n/).slice(1).join('\n').trim()),
      env: extractEnv(ps),
    };
  } catch (error) {
    return { pid: '', command: '', env: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

function extractEnv(text) {
  const keys = [
    'PORT',
    'KAYPAL_DESKTOP_DATABASE_MODE',
    'GROWTH_EXECUTION_ENABLED',
    'GROWTH_SCHEDULER_DAEMON',
    'GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED',
    'GROWTH_SCHEDULER_LEASE_MS',
    'LOCAL_ENGINE_PLAN_MODE',
    'LOCAL_ENGINE_COMMERCIAL_EXECUTION_ENABLED',
  ];
  const env = {};
  for (const key of keys) {
    const match = text.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
    if (match) env[key] = match[1];
  }
  return env;
}

function inspectDatabase() {
  if (!databasePath || !existsSync(databasePath)) {
    return { ok: false, error: `Database file not found: ${databasePath || 'missing'}` };
  }
  const tables = {};
  const names = [
    'users',
    'growth_account_health',
    'growth_acquisition_configs',
    'growth_acquisition_runs',
    'growth_leads',
    'growth_scheduler_leases',
  ];
  try {
    for (const name of names) {
      const output = sqliteRun(`select count(*) from ${name};`).trim();
      tables[name] = Number(output || 0);
    }
    return { ok: true, tables };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), tables };
  }
}

function writeReports() {
  const summary = {
    generatedAt: new Date().toISOString(),
    ...(releaseEvidence || {}),
    readOnly: true,
    status: checks.some((item) => item.status === 'blocker') ? 'BLOCKED' : 'PASS',
    pass: checks.filter((item) => item.status === 'pass').length,
    blockers: checks.filter((item) => item.status === 'blocker').length,
    checks,
    evidence,
  };
  writeFileSync(join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
  const liveGate = evidence.commercialLiveGate;
  const liveGateLines = liveGate
    ? [
        '## Read-only Live Gate State',
        '',
        `- executionEnabled: \`${liveGate.executionEnabled}\``,
        `- schedulerDaemonEnabled: \`${liveGate.schedulerDaemonEnabled}\``,
        `- schedulerDaemonArmed: \`${liveGate.schedulerDaemonArmed}\``,
        `- readyCount: \`${liveGate.readyCount}\``,
        `- onlineNormalAccountCount: \`${liveGate.onlineNormalAccountCount}\``,
        ...liveGate.nextSteps.map((item) => `- nextStep: ${item}`),
        '',
      ]
    : [];
  const markdown = [
    '# Growth Commercial Live Gate',
    '',
    `Status: **${summary.status}**`,
    `Generated: ${summary.generatedAt}`,
    'Read-only: **true**',
    '',
    ...liveGateLines,
    '',
    '## Checks',
    '',
    ...checks.map((item) => `- **${item.status.toUpperCase()}** ${item.name}: ${item.detail}`),
    '',
    '## Evidence Files',
    '',
    '- `summary.json`',
    '',
  ].join('\n');
  writeFileSync(join(evidenceDir, 'report.md'), markdown);
}

function printSummary() {
  const blockers = checks.filter((item) => item.status === 'blocker').length;
  const pass = checks.filter((item) => item.status === 'pass').length;
  console.log(`\nReport: ${join(evidenceDir, 'report.md')}`);
  console.log(`Summary: PASS=${pass} BLOCKER=${blockers}`);
}

function loadCookieHeader() {
  if (cookieHeader) return cookieHeader;
  const sessionToken = createdLocalSessionToken || providedSessionToken;
  if (sessionToken) return `ai_content_session=${sessionToken}`;
  if (!cookieFile || !existsSync(cookieFile)) return '';
  const content = readFileSync(cookieFile, 'utf8').trim();
  if (/^[^=\s]+=/.test(content)) return content;
  return '';
}

function createLocalAcceptanceSessionIfRequested() {
  if (!localAcceptanceLoginEnabled || createdLocalSessionToken) return;
  if (!databasePath || !existsSync(databasePath)) {
    addCheck('blocker', 'local-acceptance-session', `SQLite database not found for local login: ${databasePath || 'missing'}`);
    return;
  }

  const userRows = sqliteJson(`
    select id, username, email
    from users
    where status = 'active'
    order by
      case when commercial_execution_allowed = 1 and lower(plan_mode) = 'commercial' then 0 else 1 end,
      updated_at desc
    limit 1;
  `);
  const user = userRows[0];
  if (!user?.id) {
    addCheck('blocker', 'local-acceptance-session', 'No active local user found for commercial live gate.');
    return;
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  createdLocalSessionToken = randomBytes(32).toString('base64url');
  createdLocalSessionId = `growth_live_gate_${randomBytes(12).toString('hex')}`;
  const tokenHash = createHash('sha256').update(createdLocalSessionToken).digest('hex');
  const metadata = JSON.stringify({
    source: 'growth-commercial-live-gate',
    localOnly: true,
    kaypalDesktopAccessToken: `local-growth-live-access-${randomBytes(8).toString('hex')}`,
    kaypalDesktopRefreshToken: `local-growth-live-refresh-${randomBytes(8).toString('hex')}`,
    kaypalDesktopTokenExpiresAt: expiresAt,
    kaypalDesktopDeviceId: `local-growth-live-device-${randomBytes(4).toString('hex')}`,
    kaypalSubscriptionPlan: 'ADVANCED',
    kaypalSubscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    kaypalRole: 'SUPER_ADMIN',
    kaypalPlatformRole: 'SUPER_ADMIN',
    kaypalPermissionNames: ['growth_acceptance', 'growth_live_gate'],
    kaypalMetadataSyncedAt: now,
  });

  sqliteExec(`
    insert into user_sessions (
      id,
      user_id,
      token_hash,
      expires_at,
      last_used_at,
      metadata,
      created_at,
      updated_at
    ) values (
      ${sqlQuote(createdLocalSessionId)},
      ${sqlQuote(user.id)},
      ${sqlQuote(tokenHash)},
      ${sqlQuote(expiresAt)},
      ${sqlQuote(now)},
      ${sqlQuote(metadata)},
      ${sqlQuote(now)},
      ${sqlQuote(now)}
    );
  `);
  addCheck('pass', 'local-acceptance-session', `Created local read-only gate session for ${user.username || user.email || user.id}.`);
}

function cleanupLocalAcceptanceSession() {
  if (!createdLocalSessionId || !databasePath || !existsSync(databasePath)) return;
  const sessionId = createdLocalSessionId;
  createdLocalSessionId = '';
  createdLocalSessionToken = '';
  try {
    sqliteExec(`delete from user_sessions where id = ${sqlQuote(sessionId)};`);
  } catch (error) {
    console.warn(`WARN could not clean local live gate session ${sessionId}: ${error.message}`);
  }
}

function sqliteJson(sql) {
  const output = sqliteRun(sql, ['-json']).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteExec(sql) {
  sqliteRun(sql);
}

function sqliteRun(sql, extraArgs = []) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return execFileSync(
        'sqlite3',
        [...extraArgs, '-cmd', '.timeout 10000', databasePath, sql],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    } catch (error) {
      lastError = error;
      const stderr = String(error?.stderr || error?.message || '');
      if (!/database is locked|SQLITE_BUSY/i.test(stderr)) {
        throw error;
      }
    }
  }
  throw lastError;
}

function sqlQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function appendNextSteps(detail, nextSteps) {
  if (!nextSteps.length) return detail;
  return `${detail} Next step: ${nextSteps.join(' | ')}`;
}

function apiNextStep(path, response) {
  if (response.status === 401 || response.status === 403) return authSessionNextStep();
  if (response.status === 0) return `Confirm the backend is reachable and ${path} returns 200.`;
  return `Confirm ${path} returns 200 for the commercial session.`;
}

function authSessionNextStep() {
  return 'Provide a valid commercial session via GROWTH_ACCEPTANCE_COOKIE_HEADER, GROWTH_ACCEPTANCE_COOKIE_FILE, or GROWTH_ACCEPTANCE_SESSION_TOKEN.';
}

function uniqueNextSteps(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function resolveDatabasePath() {
  const explicit = process.env.SQLITE_DATABASE_FILE || process.env.GROWTH_LIVE_GATE_SQLITE_FILE;
  if (explicit) return explicit;
  const pathFromUrl = sqlitePathFromUrl(
    process.env.GROWTH_LIVE_GATE_DATABASE_URL ||
      process.env.SQLITE_DATABASE_URL ||
      process.env.DATABASE_URL ||
      '',
  );
  if (pathFromUrl) return pathFromUrl;
  const support = join(process.env.HOME || '', 'Library', 'Application Support', 'ai-content-desktop', 'kaypal-ai.sqlite');
  if (existsSync(support)) return support;
  const candidates = [
    join(repoRoot, 'backend', 'prisma', 'ai-content-dev.db'),
    join(repoRoot, 'backend', 'prisma', 'data', 'sqlite-runtime', 'kaypal-ai.sqlite'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function sqlitePathFromUrl(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('file:')) return '';
  try {
    const url = new URL(text);
    if (url.protocol === 'file:' && url.pathname) {
      return decodeURIComponent(url.pathname);
    }
  } catch {
    // Prisma also accepts file:./relative/path.
  }
  const rawPath = text.replace(/^file:/, '');
  if (!rawPath) return '';
  return rawPath.startsWith('/') ? rawPath : resolve(repoRoot, rawPath);
}

function redact(input) {
  return JSON.parse(JSON.stringify(input, (key, value) => (/token|access|refresh/i.test(key) ? '[REDACTED]' : value)));
}

function redactText(value) {
  return `${value}`
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/(kda_|kdr_|sk-)[^\s]+/g, '[REDACTED]');
}

function stripTrailingSlash(value) {
  return `${value}`.replace(/\/+$/, '');
}

function dateForFile(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function timestampForFile(value = new Date()) {
  return value.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}
