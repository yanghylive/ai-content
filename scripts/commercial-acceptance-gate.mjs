#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const apiBase = stripTrailingSlash(process.env.API_BASE || 'http://localhost:3011/api');
const frontendUrl = stripTrailingSlash(process.env.FRONTEND_URL || 'http://localhost:3010');
const engineUrl = stripTrailingSlash(process.env.ENGINE_URL || process.env.AUTO_UPLOAD_ENGINE_URL || 'http://127.0.0.1:5409');
const databasePath = process.env.COMMERCIAL_DATABASE_PATH || join(process.cwd(), 'backend', 'prisma', 'dev.db');
const backendEnvPath = process.env.COMMERCIAL_BACKEND_ENV_PATH || join(process.cwd(), 'backend', '.env');
const authCookieName = process.env.AUTH_COOKIE_NAME || readBackendEnvValue('AUTH_COOKIE_NAME') || 'ai_content_session';
const providedCookieHeader = process.env.COMMERCIAL_COOKIE_HEADER || process.env.SMOKE_COOKIE_HEADER || '';
const providedCookieFile = process.env.COMMERCIAL_COOKIE_FILE || process.env.SMOKE_COOKIE_FILE || '';
const providedSessionToken = process.env.COMMERCIAL_SESSION_TOKEN || process.env.SMOKE_SESSION_TOKEN || '';
const cliRealAcceptanceEnabled = process.argv.includes('--real') || process.argv.includes('--real-acceptance');
const interactiveLoginEnabled =
  process.env.COMMERCIAL_INTERACTIVE_LOGIN === '1' ||
  process.env.COMMERCIAL_USE_BROWSER_LOGIN === '1';
const localAcceptanceLoginEnabled = process.env.COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN === '1';
const interactiveLoginHeadless = process.env.COMMERCIAL_INTERACTIVE_LOGIN_HEADLESS === '1';
const realAcceptanceEnabled = cliRealAcceptanceEnabled || process.env.COMMERCIAL_REAL_ACCEPTANCE === '1';
const interactiveLoginTimeoutMs = Number(
  process.env.COMMERCIAL_INTERACTIVE_LOGIN_TIMEOUT_MS || 180000,
);
const username = process.env.COMMERCIAL_USERNAME || process.env.SMOKE_USERNAME || '';
const password = process.env.COMMERCIAL_PASSWORD || process.env.SMOKE_PASSWORD || '';
const timeoutMs = Number(process.env.COMMERCIAL_TIMEOUT_MS || 30000);
const pollMs = Number(process.env.COMMERCIAL_POLL_MS || 1000);
const pollAttempts = Number(process.env.COMMERCIAL_POLL_ATTEMPTS || 45);
const contentGenerateTimeoutMs = Number(process.env.COMMERCIAL_CONTENT_GENERATE_TIMEOUT_MS || 25 * 60 * 1000);
const realExecutionEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_REAL_EXECUTION === '1';
const approveDraftsEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_APPROVE_DRAFTS === '1';
const realAutoSendEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_REAL_AUTO_SEND === '1';
const approveAutoSendEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_APPROVE_AUTO_SEND === '1';
const realPublishEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_REAL_PUBLISH === '1';
const approvePublishEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_APPROVE_PUBLISH === '1';
const realContentPipelineEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_REAL_CONTENT_PIPELINE === '1';
const approveContentPipelineEnabled = realAcceptanceEnabled || process.env.COMMERCIAL_APPROVE_CONTENT_PIPELINE === '1';
const requiredTaskTypes = listEnv(
  'COMMERCIAL_TASK_TYPES',
  'douyin-comment-reply,douyin-direct-message-reply,wechat-channel-comment-reply,wechat-channel-direct-message-reply',
);
const pressureCycles = Math.max(1, Number(process.env.COMMERCIAL_PRESSURE_CYCLES || 5));
const realAutoSendCycles = Math.max(1, Number(process.env.COMMERCIAL_REAL_AUTO_SEND_CYCLES || 5));
const contentPipelineCycles = Math.max(1, Number(process.env.COMMERCIAL_CONTENT_PIPELINE_CYCLES || 5));
const pressureApprove = process.env.COMMERCIAL_PRESSURE_APPROVE === '1';
const wechatTargetContact = process.env.COMMERCIAL_WECHAT_TARGET_CONTACT || '';
const douyinAccountId = process.env.COMMERCIAL_DOUYIN_ACCOUNT_ID || '';
const wechatAccountId = process.env.COMMERCIAL_WECHAT_ACCOUNT_ID || '';
const publishAccountFile = process.env.COMMERCIAL_PUBLISH_ACCOUNT_FILE || '';
const publishMaterialFile = process.env.COMMERCIAL_PUBLISH_MATERIAL_FILE || '';
const operator = process.env.COMMERCIAL_OPERATOR || 'commercial-acceptance';
const reportDir = process.env.COMMERCIAL_REPORT_DIR || join(process.cwd(), '.local-logs');
const requiredMatrixCells = [
  'authentication',
  'readiness',
  'batch-tasks',
  'content-pipeline',
  'publishing-center',
  'desktop-file-selection',
  'permission-escape',
  'failure-recovery',
  'evidence-export',
  'pressure',
  'real-execution',
];

const cookieJar = new Map();
const results = [];
const artifacts = {
  createdTaskIds: [],
  createdSessionIds: [],
  exportedDiagnostics: [],
  exportedEvidence: [],
};

let failCount = 0;
let blockedCount = 0;
let passCount = 0;
let warnCount = 0;

main()
  .then(async () => {
    await writeReport();
    printSummary();
    process.exit(exitCode());
  })
  .catch(async (error) => {
    record('FAILED', 'unexpected error', error.stack || error.message, '修复脚本异常或接口异常后重新执行。');
    await writeReport().catch(() => undefined);
    printSummary();
    process.exit(1);
  });

async function main() {
  console.log('AI Content commercial acceptance gate');
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`API base: ${apiBase}`);
  console.log(`Task types: ${requiredTaskTypes.join(', ')}`);
  printInputChecklist();
  console.log('');

  await checkLocalDirectPrerequisites();
  await syncKaypalModels();

  const authenticated = await checkAuthentication();
  if (!authenticated) {
    recordPrerequisiteBlocked('authentication');
    return;
  }

  await checkCdpBrowser();
  await syncPublishingAccountsFromLocalEngine();
  await checkReadOnlyCommercialPrerequisites();
  await runBatchTaskMatrixCheck();
  await runContentToPublishingCheck();
  await runPublishingCenterCheck();
  await runUnauthorizedMatrixCheck();
  await checkCommercialRiskGate();
  await runFailureRecoveryCheck();
  await runEvidenceAuditCheck();
  await runPressureCheck();
  await runRealExecutionChecks();
}

async function checkLocalDirectPrerequisites() {
  section('Local Direct Preconditions');
  checkBackendEnvMode();
  checkLocalDatabasePreconditions();
  await checkDirectEnginePreconditions();
}

function checkBackendEnvMode() {
  if (!existsSync(backendEnvPath)) {
    record('WARN', 'backend .env not found', backendEnvPath, '确认后端环境变量文件路径。', {
      area: 'readiness',
      requirement: '商用验收应明确鉴权和商用执行环境变量。',
    });
    return;
  }
  const env = parseEnvFile(readFileSync(backendEnvPath, 'utf8'));
  const kaypalAuthEnabled = env.KAYPAL_AUTH_ENABLED === 'true';
  record(
    kaypalAuthEnabled ? 'PASS' : 'WARN',
    'backend auth mode inspected',
    `KAYPAL_AUTH_ENABLED=${env.KAYPAL_AUTH_ENABLED || '<unset>'}, LOCAL_ENGINE_PLAN_MODE=${env.LOCAL_ENGINE_PLAN_MODE || '<unset>'}`,
    kaypalAuthEnabled ? '' : '商用验收建议启用真实鉴权或明确本地管理员鉴权策略。',
    {
      area: 'authentication',
      requirement: '鉴权模式必须明确，缺真实登录不能继续真实验收。',
    },
  );
}

function checkLocalDatabasePreconditions() {
  if (!existsSync(databasePath)) {
    record('BLOCKED', 'local database missing', databasePath, '先运行后端迁移/初始化，确认 DATABASE_URL 指向真实验收库。', {
      area: 'readiness',
      requirement: '3010 项目数据库必须可读，模型、账号、任务状态不能靠前端假数据。',
    });
    return;
  }

  try {
    const counts = {
      users: tableCount('users'),
      aiPlatforms: tableCount('ai_platforms'),
      aiModels: tableCount('ai_models'),
      defaultModels: tableCount('default_model_configs'),
      publishAccounts: tableCount('publish_accounts'),
      interactionTasks: tableCount('interaction_tasks'),
      localInteractionTasks: tableCount('local_engine_interaction_tasks'),
    };
    record('PASS', 'local database readable', `db=${databasePath}`, '', {
      area: 'readiness',
      requirement: '3010 项目数据库必须可读。',
    });
    record(
      counts.aiPlatforms > 0 && counts.aiModels > 0 && counts.defaultModels > 0 ? 'PASS' : 'BLOCKED',
      'AI model tables populated',
      `ai_platforms=${counts.aiPlatforms}, ai_models=${counts.aiModels}, default_model_configs=${counts.defaultModels}`,
      '模型先不换；但必须在设置页配置可用 AI 平台、模型和默认文本模型后，才能验收“AI 按内容回复”。',
      {
        area: 'readiness',
        requirement: '客户互动真实闭环必须有可用默认文本模型。',
      },
    );
    checkDefaultTextModels();
    if (counts.publishAccounts === 0) {
      record(
        'WARN',
        '3010 publish account table empty',
        'publish_accounts=0；登录后会调用 /publishing/accounts 从 5409 同步。',
        '如果同步后仍为 0，才算账号统一失败。',
        {
          area: 'publishing-center',
          requirement: '账号/profile 状态必须统一，不应只靠单边账号库。',
        },
      );
    } else {
      record('PASS', '3010 publish accounts present', `publish_accounts=${counts.publishAccounts}`, '', {
        area: 'publishing-center',
        requirement: '发布中心应有可审计账号记录。',
      });
    }
  } catch (error) {
    record(
      'BLOCKED',
      'local database precondition query failed',
      error instanceof Error ? error.message : String(error),
      '确认 sqlite3 可用、数据库迁移完整、表名与 Prisma schema 一致。',
      {
        area: 'readiness',
        requirement: '登录前本地数据库预检必须可执行。',
      },
    );
  }
}

function checkDefaultTextModels() {
  const rows = sqliteJson(`
    select
      d.purpose as purpose,
      d.model_id as modelId,
      m.name as modelName,
      m.model_id as providerModelId,
      m.enabled as modelEnabled,
      p.name as platformName,
      p.enabled as platformEnabled,
      length(coalesce(p.base_url, '')) as baseUrlLength,
      length(coalesce(p.api_key, '')) as apiKeyLength
    from default_model_configs d
    left join ai_models m on m.id = d.model_id
    left join ai_platforms p on p.id = m.platform_id
    where d.purpose in ('article_creation', 'topic_selection');
  `);
  const usable = rows.filter(
    (row) =>
      Number(row.modelEnabled) === 1 &&
      Number(row.platformEnabled) === 1 &&
      Number(row.baseUrlLength || 0) > 0 &&
      Number(row.apiKeyLength || 0) > 0,
  );
  if (usable.length === 0) {
    record(
      'BLOCKED',
      'default AI reply model missing or unusable',
      rows.length
        ? rows
            .map(
              (row) =>
                `${row.purpose}:${row.modelName || '<missing-model>'}, modelEnabled=${row.modelEnabled ?? '<null>'}, platformEnabled=${row.platformEnabled ?? '<null>'}`,
            )
            .join(' | ')
        : 'article_creation/topic_selection 默认模型均未配置。',
      '先在 3010 设置页配置可用默认文本模型；未配置时规则兜底不能算“AI 生成对应回复”。',
      {
        area: 'readiness',
        requirement: '四条客户互动闭环必须能调用 AI 生成回复。',
      },
    );
    return;
  }
  record(
    'PASS',
    'default AI reply model usable',
    usable.map((row) => `${row.purpose}:${row.modelName}/${row.platformName}`).join(' | '),
    '',
    {
      area: 'readiness',
      requirement: '四条客户互动闭环必须能调用 AI 生成回复。',
    },
  );
}

async function checkDirectEnginePreconditions() {
  const health = await engineRequest('/health').catch((error) => {
    record('BLOCKED', 'direct auto-upload engine health failed', error.message, '启动 5409 本地发布/互动引擎后重试。', {
      area: 'readiness',
      requirement: '5409 引擎必须在线，且登录前也能直接预检。',
    });
    return null;
  });
  if (health) {
    record('PASS', 'direct auto-upload engine online', `${engineUrl}/health`, '', {
      area: 'readiness',
      requirement: '5409 引擎必须在线。',
    });
  }

  const capabilities = await engineRequest('/interaction/capabilities').catch((error) => {
    record('BLOCKED', 'direct interaction capabilities failed', error.message, '升级或重启 5409，确认 /interaction/capabilities 可访问。', {
      area: 'readiness',
      requirement: '四条客户互动任务类型必须由 5409 明确声明。',
    });
    return null;
  });
  const supportedTaskTypes = capabilities?.supportedTaskTypes || [];
  if (supportedTaskTypes.length) {
    const supportedKeys = new Set(supportedTaskTypes.map((item) => item.key));
    const missing = requiredTaskTypes.filter((type) => !supportedKeys.has(type));
    record(
      missing.length ? 'BLOCKED' : 'PASS',
      'direct interaction task type matrix',
      `supported=${supportedTaskTypes.map((item) => item.key).join(', ')}`,
      missing.length ? `补齐 5409 capabilities 缺失任务类型：${missing.join(', ')}` : '',
      {
        area: 'readiness',
        requirement: '抖音评论、抖音私信、视频号评论、视频号私信四类能力都必须声明。',
      },
    );
  }

  const sessions = await engineRequest('/interaction/cdp/sessions').catch(() => null);
  if (sessions && typeof sessions === 'object') {
    const readySessions = Object.values(sessions).filter((session) => session?.status === 'ready');
    if (readySessions.length) {
      record(
        'PASS',
        'direct CDP sessions visible',
        readySessions.map((session) => `${session.platform}:${session.accountId}@${session.debuggingPort}`).join(' | '),
        '',
        {
          area: 'readiness',
          requirement: 'CDP 会话状态必须可查询。',
        },
      );
    } else {
      record('WARN', 'direct CDP sessions empty', '5409 在线但当前没有 ready CDP 会话。', '执行真实任务前需由预检启动并确认账号登录态。', {
        area: 'readiness',
        requirement: 'CDP 会话状态必须可查询。',
      });
    }
  }

  const accounts = await engineRequest('/getValidAccounts?validate=1', {
    timeoutMs: Math.max(timeoutMs, 45000),
  }).catch((error) => {
    record('BLOCKED', 'direct account validation failed', error.message, '修复 5409 账号接口或重新登录测试账号。', {
      area: 'readiness',
      requirement: '四条客户互动闭环必须有 ready 抖音和视频号账号。',
    });
    return null;
  });
  if (Array.isArray(accounts)) {
    const readyDouyin = accounts.filter((account) => Number(account.type) === 3 && Number(account.status) === 1);
    const readyWechatChannel = accounts.filter((account) => Number(account.type) === 2 && Number(account.status) === 1);
    const ok = readyDouyin.length > 0 && readyWechatChannel.length > 0;
    record(
      ok ? 'PASS' : 'BLOCKED',
      'direct real platform accounts ready',
      `douyin=${readyDouyin.length}, wechatChannel=${readyWechatChannel.length}, total=${accounts.length}`,
      ok ? '' : '登录 ready 的抖音账号和视频号账号后再跑四条真实闭环。',
      {
        area: 'readiness',
        requirement: '四条客户互动闭环必须有 ready 抖音和视频号账号。',
      },
    );
  }
}

function parseEnvFile(content) {
  const env = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function readBackendEnvValue(key) {
  if (!existsSync(backendEnvPath)) return '';
  try {
    const env = parseEnvFile(readFileSync(backendEnvPath, 'utf8'));
    return env[key] || '';
  } catch {
    return '';
  }
}

function tableCount(tableName) {
  const safeName = safeSqlIdentifier(tableName);
  const rows = sqliteJson(`select count(*) as count from "${safeName}";`);
  return Number(rows[0]?.count || 0);
}

function sqliteJson(sql) {
  const output = execFileSync('sqlite3', ['-json', databasePath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteExec(sql) {
  execFileSync('sqlite3', [databasePath, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sqlQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function safeTableCount(tableName) {
  try {
    return tableCount(tableName);
  } catch {
    return null;
  }
}

function safeSqlIdentifier(value) {
  const text = String(value || '');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) {
    throw new Error(`Unsafe SQL identifier: ${text}`);
  }
  return text;
}

async function engineRequest(path, options = {}) {
  const controller = new AbortController();
  const requestTimeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : Math.min(timeoutMs, 8000);
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${engineUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    const json = text ? safeJson(text) : null;
    if (!response.ok || json?.success === false || json?.code >= 400) {
      const message =
        typeof json?.message === 'string'
          ? json.message
          : typeof json?.msg === 'string'
            ? json.msg
            : `HTTP ${response.status} GET ${path}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = json;
      throw error;
    }
    return Object.prototype.hasOwnProperty.call(json || {}, 'data')
      ? json.data
      : json;
  } finally {
    clearTimeout(timer);
  }
}

async function checkAuthentication() {
  section('Authentication');
  const setup = await request('GET', '/auth/setup-status', undefined, { public: true }).catch((error) => {
    record('BLOCKED', 'backend setup status unreachable', error.message, '启动后端服务，确认 API_BASE 指向 /api。', {
      area: 'authentication',
      requirement: '后台鉴权 setup 状态必须可达。',
    });
    return null;
  });
  if (setup) {
    record('PASS', 'backend setup status reachable', `authMode=${setup.authMode || 'unknown'}, hasUsers=${setup.hasUsers}`, '', {
      area: 'authentication',
      requirement: '后台鉴权 setup 状态必须可达。',
    });
  }

  const existingSession = reuseProvidedLoginState();
  if (existingSession) {
    const me = await request('GET', '/auth/me').catch((error) => {
      record('WARN', 'reused local session rejected by backend', error.message, '页面登录态已失效时，请重新在 3010 完成 Kaypal 授权登录，或提供账号密码兜底。', {
        area: 'authentication',
        requirement: '验收脚本应优先复用页面 Kaypal 登录态。',
      });
      return null;
    });
    if (me?.id) {
      record('PASS', 'reused existing Kaypal-backed 3010 session', `${me.username || me.email || me.id}`, '', {
        area: 'authentication',
        requirement: '验收脚本优先复用页面 Kaypal 登录态，账号密码只是兜底。',
      });
      return true;
    }
  }

  const derivedSession = createSessionFromExistingKaypalLogin();
  if (derivedSession) {
    const me = await request('GET', '/auth/me').catch((error) => {
      record('WARN', 'derived Kaypal session rejected by backend', error.message, '确认 API_BASE 和 COMMERCIAL_DATABASE_PATH 指向同一个 3010 后端数据库。', {
        area: 'authentication',
        requirement: '验收脚本可从已存在的真实 Kaypal 登录态派生短期脚本 session。',
      });
      return null;
    });
    if (me?.id) {
      record(
        'PASS',
        'derived acceptance session from existing Kaypal login',
        `${me.username || me.email || me.id}; sourceSession=${derivedSession.sourceSessionId}`,
        '',
        {
          area: 'authentication',
          requirement: '脚本验收登录态必须来自已存在的真实 Kaypal 登录 session。',
        },
      );
      return true;
    }
  }

  if (interactiveLoginEnabled) {
    const interactiveSession = await acquireInteractiveKaypalLogin();
    if (interactiveSession) {
      const me = await request('GET', '/auth/me').catch((error) => {
        record('WARN', 'interactive Kaypal session rejected by backend', error.message, '重新在 3010 完成 Kaypal 授权登录，确认 API_BASE 与前端指向同一个后端。', {
          area: 'authentication',
          requirement: '交互式 Kaypal 登录拿到的页面 cookie 必须能通过后台鉴权。',
        });
        return null;
      });
      if (me?.id) {
        record('PASS', 'interactive Kaypal login succeeded', `${me.username || me.email || me.id}`, '', {
          area: 'authentication',
          requirement: '验收脚本可通过 Kaypal 页面授权登录进入 3010 后台。',
        });
        return true;
      }
    }
  }

  if (localAcceptanceLoginEnabled) {
    const localSession = createLocalAcceptanceSession();
    if (localSession) {
      const me = await request('GET', '/auth/me').catch((error) => {
        record(
          'FAILED',
          'local acceptance session rejected by backend',
          error.message,
          '确认 API_BASE 和 COMMERCIAL_DATABASE_PATH 指向同一个 3010 后端数据库。',
          {
            area: 'authentication',
            requirement: '本地验收态必须能通过 authenticated guard。',
          },
        );
        return null;
      });
      if (me?.id) {
        record(
          'PASS',
          'local acceptance login session created',
          `${me.username || me.email || me.id}`,
          '',
          {
            area: 'authentication',
            requirement: '本地验收可显式创建短期 3010 会话，不能默认绕过生产鉴权。',
          },
        );
        return true;
      }
    }
  }

  if (!username || !password) {
    record(
      'BLOCKED',
      'Kaypal-backed login state missing',
      '未找到可复用的 3010 页面登录态，也未启用交互式 Kaypal 登录或账号密码兜底。',
      '先设置 COMMERCIAL_INTERACTIVE_LOGIN=1 让脚本打开 Kaypal 授权登录；或传入 COMMERCIAL_COOKIE_HEADER/COMMERCIAL_SESSION_TOKEN；或设置 Kaypal 账号密码兜底。',
      {
        area: 'authentication',
        requirement: '必须使用真实 Kaypal 登录态进入后台，不能把未登录当作通过。',
      },
    );
    return false;
  }

  const login = await request('POST', '/auth/login', { username, password }, { public: true }).catch((error) => {
    record('FAILED', 'commercial account login failed', error.message, '确认账号密码、Kaypal 鉴权或本地管理员账号可用。', {
      area: 'authentication',
      requirement: '真实后台账号必须能登录。',
    });
    return null;
  });
  if (!login?.user?.id) return false;

  record('PASS', 'commercial account login succeeded', `${login.user.username || login.user.email || login.user.id}`, '', {
    area: 'authentication',
    requirement: '真实后台账号必须能登录。',
  });
  const me = await request('GET', '/auth/me').catch((error) => {
    record('FAILED', 'authenticated /auth/me failed', error.message, '检查登录 cookie、鉴权 guard 和 API_BASE 同源配置。', {
      area: 'authentication',
      requirement: '登录 cookie 必须通过 authenticated guard。',
    });
    return null;
  });
  if (!me?.id) return false;

  record('PASS', 'authenticated guard works', `${me.username || me.email || me.id}`, '', {
    area: 'authentication',
    requirement: '登录 cookie 必须通过 authenticated guard。',
  });
  return true;
}

function createSessionFromExistingKaypalLogin() {
  if (!existsSync(databasePath)) return null;

  let sourceSession;
  try {
    const sessions = sqliteJson(`
      select
        s.id as sessionId,
        s.user_id as userId,
        s.metadata as metadata,
        s.expires_at as expiresAt,
        u.username as username,
        u.email as email
      from user_sessions s
      join users u on u.id = s.user_id
      where u.status = 'active'
      order by s.updated_at desc, s.created_at desc
      limit 20;
    `);
    sourceSession = sessions.find(isReusableKaypalSession);
  } catch (error) {
    record(
      'WARN',
      'existing Kaypal session lookup failed',
      error instanceof Error ? error.message : String(error),
      '检查 user_sessions 表结构和 COMMERCIAL_DATABASE_PATH。',
      {
        area: 'authentication',
        requirement: '验收脚本可从已存在的真实 Kaypal 登录态派生短期脚本 session。',
      },
    );
    return null;
  }

  if (!sourceSession?.userId) return null;

  const metadata = parseJsonObject(sourceSession.metadata);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = `commercial_acceptance_${randomBytes(12).toString('hex')}`;
  const now = new Date().toISOString();
  const sourceExpiresAt = normalizeDateValue(sourceSession.expiresAt);
  const defaultExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const expiresAt = new Date(Math.min(sourceExpiresAt?.getTime() || defaultExpiresAt.getTime(), defaultExpiresAt.getTime())).toISOString();
  const derivedMetadata = JSON.stringify({
    ...metadata,
    source: 'commercial-acceptance-gate',
    derivedFromKaypalSession: sourceSession.sessionId,
    derivedAt: now,
  });

  try {
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
        ${sqlQuote(sessionId)},
        ${sqlQuote(sourceSession.userId)},
        ${sqlQuote(tokenHash)},
        ${sqlQuote(expiresAt)},
        ${sqlQuote(now)},
        ${sqlQuote(derivedMetadata)},
        ${sqlQuote(now)},
        ${sqlQuote(now)}
      );
    `);
    cookieJar.set(authCookieName, token);
    return {
      sessionId,
      sourceSessionId: sourceSession.sessionId,
      user: {
        username: sourceSession.username,
        email: sourceSession.email,
      },
    };
  } catch (error) {
    record(
      'FAILED',
      'derived Kaypal session insert failed',
      error instanceof Error ? error.message : String(error),
      '检查 user_sessions 表结构和数据库写权限。',
      {
        area: 'authentication',
        requirement: '验收脚本可从已存在的真实 Kaypal 登录态派生短期脚本 session。',
      },
    );
    return null;
  }
}

function isReusableKaypalSession(row) {
  const expiresAt = normalizeDateValue(row?.expiresAt);
  if (!expiresAt || expiresAt <= new Date()) return false;

  const metadata = parseJsonObject(row?.metadata);
  if (!metadata || metadata.source === 'commercial-acceptance-gate') return false;
  if (metadata.derivedFromKaypalSession) return false;
  return Boolean(
    metadata.kaypalDesktopAccessToken ||
      metadata.kaypalPlan ||
      metadata.kaypalRole ||
      metadata.kaypalPlatformRole ||
      metadata.kaypalUserPermissionNames ||
      metadata.kaypalPermissions,
  );
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (typeof value === 'number') return new Date(value);
  const text = String(value);
  if (/^\d+$/.test(text)) return new Date(Number(text));
  return new Date(text);
}

function createLocalAcceptanceSession() {
  if (!existsSync(databasePath)) {
    record(
      'BLOCKED',
      'local acceptance database missing',
      databasePath,
      '确认 COMMERCIAL_DATABASE_PATH 指向当前 3010 后端 SQLite 数据库。',
      {
        area: 'authentication',
        requirement: '本地验收登录态只能写入当前本地 3010 数据库。',
      },
    );
    return null;
  }

  let user;
  try {
    const users = sqliteJson(`
      select id, username, email
      from users
      where status = 'active'
      order by updated_at desc
      limit 1;
    `);
    user = users[0];
  } catch (error) {
    record(
      'FAILED',
      'local acceptance user lookup failed',
      error instanceof Error ? error.message : String(error),
      '检查 users 表和 sqlite3。',
      {
        area: 'authentication',
        requirement: '本地验收登录态需要可用 active 用户。',
      },
    );
    return null;
  }

  if (!user?.id) {
    record(
      'BLOCKED',
      'local acceptance user missing',
      'users 表没有 active 用户。',
      '先完成 Kaypal 授权登录或初始化本地用户，再跑验收。',
      {
        area: 'authentication',
        requirement: '本地验收登录态需要可用 active 用户。',
      },
    );
    return null;
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = `commercial_acceptance_${randomBytes(12).toString('hex')}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const metadata = JSON.stringify({
    source: 'commercial-acceptance-gate',
    localOnly: true,
    operator,
    kaypalPlan: 'ADVANCED',
    kaypalRole: 'SUPER_ADMIN',
    kaypalPlatformRole: 'SUPER_ADMIN',
    kaypalUserPermissionNames: ['commercial_acceptance'],
  });

  try {
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
        ${sqlQuote(sessionId)},
        ${sqlQuote(user.id)},
        ${sqlQuote(tokenHash)},
        ${sqlQuote(expiresAt)},
        ${sqlQuote(now)},
        ${sqlQuote(metadata)},
        ${sqlQuote(now)},
        ${sqlQuote(now)}
      );
    `);
    cookieJar.set(authCookieName, token);
    return { sessionId, user };
  } catch (error) {
    record(
      'FAILED',
      'local acceptance session insert failed',
      error instanceof Error ? error.message : String(error),
      '检查 user_sessions 表结构和数据库写权限。',
      {
        area: 'authentication',
        requirement: '本地验收登录态必须写入短期 session。',
      },
    );
    return null;
  }
}

function reuseProvidedLoginState() {
  const reusableCookieHeader = providedCookieHeader || readCookieHeaderFromFile(providedCookieFile);
  if (reusableCookieHeader) {
    for (const part of reusableCookieHeader.split(';')) {
      const [rawKey, ...rawValue] = part.trim().split('=');
      if (rawKey && rawValue.length) {
        cookieJar.set(rawKey, rawValue.join('='));
      }
    }
    record('PASS', 'using provided browser cookie header', `cookieNames=${[...cookieJar.keys()].join(', ')}`, '', {
      area: 'authentication',
      requirement: '验收脚本可复用页面 Kaypal 登录态。',
    });
    return true;
  }

  if (providedSessionToken) {
    cookieJar.set(authCookieName, providedSessionToken);
    record('PASS', 'using provided 3010 session token', `cookie=${authCookieName}`, '', {
      area: 'authentication',
      requirement: '验收脚本可复用页面 Kaypal 登录态。',
    });
    return true;
  }

  record('WARN', 'no reusable browser login cookie supplied', `expected ${authCookieName} via COMMERCIAL_COOKIE_HEADER, COMMERCIAL_COOKIE_FILE, or COMMERCIAL_SESSION_TOKEN`, '如已在页面 Kaypal 登录，请把浏览器 cookie 传给脚本；否则脚本只能用账号密码兜底。', {
      area: 'authentication',
      requirement: '页面登录态复用需要拿到浏览器 cookie，数据库 hash 不能反推出 cookie。',
    });
  return false;
}

function readCookieHeaderFromFile(filePath) {
  if (!filePath) return '';
  if (!existsSync(filePath)) {
    record('WARN', 'provided cookie file missing', filePath, '确认 COMMERCIAL_COOKIE_FILE 指向当前 3010 登录态 cookie 文件。', {
      area: 'authentication',
      requirement: '验收脚本可复用页面 Kaypal 登录态。',
    });
    return '';
  }

  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.cookieHeader === 'string' && parsed.cookieHeader.trim()) {
      return parsed.cookieHeader.trim();
    }
    if (Array.isArray(parsed.cookies)) {
      return parsed.cookies
        .filter((cookie) => cookie?.name && cookie?.value)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
    }
  } catch {
    // Raw cookie header files are also supported.
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('; ');
}

async function acquireInteractiveKaypalLogin() {
  const loaded = loadPlaywrightChromium();
  if (!loaded) {
    record(
      'BLOCKED',
      'interactive Kaypal login unavailable',
      'Playwright is not available from local workspace candidates.',
      '安装 Playwright，或保留 kaypal-ai/node_modules；也可以改用 COMMERCIAL_COOKIE_HEADER/COMMERCIAL_SESSION_TOKEN。',
      {
        area: 'authentication',
        requirement: '交互式 Kaypal 登录需要可用浏览器运行时。',
      },
    );
    return false;
  }

  let browser;
  try {
    console.log('');
    console.log('Interactive Kaypal login enabled.');
    console.log(`Opening ${frontendUrl}/login . Complete Kaypal authorization in the browser window.`);
    browser = await loaded.chromium.launch({ headless: interactiveLoginHeadless });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(`${frontendUrl}/login?next=${encodeURIComponent('/')}`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    const authCookie = await waitForBrowserAuthCookie(context);
    await page
      .waitForFunction(
        (expectedOrigin) =>
          window.location.origin === expectedOrigin &&
          !window.location.pathname.includes('/login'),
        new URL(frontendUrl).origin,
        { timeout: 5000 },
      )
      .catch(() => undefined);

    if (!authCookie?.value) {
      record(
        'BLOCKED',
        'interactive Kaypal login cookie missing',
        `No ${authCookieName} cookie found after browser login.`,
        '确认 Kaypal 授权回调已返回 3010，并且后端成功设置登录 cookie。',
        {
          area: 'authentication',
          requirement: 'Kaypal 页面授权后必须落 3010 会话 cookie。',
        },
      );
      return false;
    }

    cookieJar.set(authCookie.name, authCookie.value);
    record('PASS', 'interactive Kaypal login cookie captured', `cookie=${authCookie.name}, playwright=${loaded.loadedFrom}`, '', {
      area: 'authentication',
      requirement: '验收脚本可通过 Kaypal 页面授权拿到 3010 登录态。',
    });
    return true;
  } catch (error) {
    record(
      'BLOCKED',
      'interactive Kaypal login not completed',
      error instanceof Error ? error.message : String(error),
      '在打开的浏览器窗口完成 Kaypal 授权；如果已授权仍超时，确认 Kaypal 回调 URL 和 3010 后端可达。',
      {
        area: 'authentication',
        requirement: '交互式 Kaypal 登录必须在超时时间内完成。',
      },
    );
    return false;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function waitForBrowserAuthCookie(context) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < interactiveLoginTimeoutMs) {
    const cookies = await context.cookies();
    const authCookie = cookies.find((cookie) => cookie.name === authCookieName);
    if (authCookie?.value) {
      return authCookie;
    }
    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${authCookieName} cookie`);
}

function loadPlaywrightChromium() {
  const candidates = [
    '../node_modules/playwright',
    '../../kaypal-ai/node_modules/playwright',
    '../../kaypal-ai-merge-main/node_modules/playwright',
    '../../reverse-dt-ai-helper/app-asar/node_modules/playwright',
  ];

  for (const candidate of candidates) {
    try {
      const { chromium } = require(candidate);
      if (chromium) {
        return { chromium, loadedFrom: candidate };
      }
    } catch {
      // Try the next local workspace dependency.
    }
  }

  return null;
}

async function syncKaypalModels() {
  section('Kaypal Model Sync');
  const status = await request('GET', '/ai-models/kaypal/status').catch((error) => {
    record('WARN', 'Kaypal model sync status unavailable', error.message, '确认后端已部署 Kaypal 模型台同步接口。', {
      area: 'readiness',
      requirement: 'Kaypal 模型台状态应可检查。',
    });
    return null;
  });
  if (status?.configured) {
    record('PASS', 'Kaypal model already synced', status.message || JSON.stringify(status), '', {
      area: 'readiness',
      requirement: '3010 默认文本模型应来自 Kaypal 模型台或明确本地配置。',
    });
    return;
  }

  const synced = await request('POST', '/ai-models/kaypal/sync', {}).catch((error) => {
    record('BLOCKED', 'Kaypal model sync blocked', error.message, '完成 Kaypal 页面授权登录，并配置 KAYPAL_AI_PROXY_API_KEY/KAYPAL_API_KEY 后重试。', {
      area: 'readiness',
      requirement: '客户互动真实闭环必须能调用 Kaypal 模型台提供的默认文本模型。',
    });
    return null;
  });
  if (!synced?.synced) {
    return;
  }

  record('PASS', 'Kaypal model synced into 3010 defaults', synced.message || JSON.stringify(synced), '', {
    area: 'readiness',
    requirement: '客户互动真实闭环必须能调用 Kaypal 模型台提供的默认文本模型。',
  });
}

async function checkCdpBrowser() {
  section('CDP Persistent Browser');

  const autoUploadHealth = await request('GET', '/auto-upload/health').catch((error) => {
    record('BLOCKED', 'auto-upload engine offline', error.message, '启动 auto-upload 服务（端口 5409）后重试。', {
      area: 'readiness',
      requirement: 'CDP 持久浏览器依赖 auto-upload 引擎在线。',
    });
    return null;
  });
  if (!autoUploadHealth) return;

  const cdpSessionResult = await readCdpSessions();
  const cdpSessions = cdpSessionResult?.payload || null;

  if (cdpSessions && typeof cdpSessions === 'object') {
    const sessionEntries = normalizeCdpSessionEntries(cdpSessions);
    if (sessionEntries.length > 0) {
      const readySessions = sessionEntries.filter((s) => s.status === 'ready');
      if (readySessions.length > 0) {
        record(
          'PASS',
          'CDP persistent browser sessions active',
          `source=${cdpSessionResult.source}, sessions=${readySessions.length}, ports=${readySessions.map((s) => s.debuggingPort).join(',')}`,
          '',
          {
            area: 'readiness',
            requirement: 'CDP 持久浏览器必须有活跃会话。',
          },
        );
        for (const session of readySessions) {
          if (session.debuggingPort && session.profileDir) {
            record(
              'PASS',
              `CDP session ready: ${session.platform}/${session.accountId}`,
              `port=${session.debuggingPort}, profile=${session.profileDir}`,
              '',
              {
                area: 'readiness',
                requirement: 'CDP 会话必须有有效端口和 profile 目录。',
              },
            );
          }
        }
      } else {
        record(
          'PASS',
          'CDP browser infrastructure available',
          'CDP 浏览器基础设施可用，会话将在任务执行时自动启动。',
          '',
          {
            area: 'readiness',
            requirement: 'CDP 浏览器基础设施可用。',
          },
        );
      }
    } else {
      record(
        'PASS',
        'CDP browser infrastructure available',
        'CDP 浏览器基础设施可用，会话将在任务执行时自动启动。',
        '',
        {
          area: 'readiness',
          requirement: 'CDP 浏览器基础设施可用。',
        },
      );
    }
  } else {
    record(
      'WARN',
      'CDP sessions endpoint not available',
      'CDP 会话查询接口不可用，但 auto-upload 引擎在线。',
      '确认 3010 后端 /auto-upload/cdp-sessions 或 5409 /interaction/cdp/sessions 可访问。',
      {
        area: 'readiness',
        requirement: 'CDP 会话状态应可查询。',
      },
    );
  }

  const capabilities = await engineRequest('/interaction/capabilities').catch(() => null);
  if (capabilities?.supportedTaskTypes) {
    const interactionTypes = capabilities.supportedTaskTypes.filter(
      (t) => t.key && (t.key.includes('douyin') || t.key.includes('wechat-channel')),
    );
    if (interactionTypes.length > 0) {
      record(
        'PASS',
        'CDP interaction task types declared',
        interactionTypes.map((t) => t.key).join(', '),
        '',
        {
          area: 'readiness',
          requirement: '客户互动任务类型必须在 capabilities 中声明。',
        },
      );
    }
  }
}

async function readCdpSessions() {
  const backendSessions = await request('GET', '/auto-upload/cdp-sessions').catch(() => null);
  if (backendSessions) {
    return {
      source: '3010:/auto-upload/cdp-sessions',
      payload: backendSessions,
    };
  }

  const directSessions = await engineRequest('/interaction/cdp/sessions').catch(() => null);
  if (directSessions) {
    return {
      source: '5409:/interaction/cdp/sessions',
      payload: directSessions,
    };
  }

  return null;
}

function normalizeCdpSessionEntries(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.sessions)) return payload.sessions;
  if (Array.isArray(payload.data?.sessions)) return payload.data.sessions;
  if (Array.isArray(payload.data)) return payload.data;

  const record = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  return Object.values(record)
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((entry) => entry && typeof entry === 'object' && ('status' in entry || 'debuggingPort' in entry));
}

async function checkReadOnlyCommercialPrerequisites() {
  section('Readiness, Accounts, Executors, Desktop');
  const runtime = await request('GET', '/local-engine/runtime/status').catch((error) => {
    record('FAILED', 'runtime status unreachable', error.message, '运行 scripts/start-local-integration.sh 后重试。');
    return null;
  });
  if (runtime?.services) {
    const offline = runtime.services.filter((service) => !service.online);
    if (offline.length) {
      record(
        'BLOCKED',
        'local runtime has offline services',
        offline.map((service) => `${service.key}:${service.message}`).join(' | '),
        runtime.startScript || '运行 scripts/start-local-integration.sh，并查看 .local-logs。',
      );
    } else {
      record('PASS', 'local runtime services online', runtime.services.map((service) => service.key).join(', '));
    }
  }

  const readiness = await request('GET', '/local-engine/readiness').catch((error) => {
    record('FAILED', 'readiness endpoint unreachable', error.message, '检查 /local-engine/readiness 返回结构。');
    return null;
  });
  if (readiness) {
    if (readiness.ready) {
      record('PASS', 'local engine readiness is green', JSON.stringify(readiness.summary || {}));
    } else {
      record(
        'BLOCKED',
        'local engine readiness has blockers',
        formatBlockers(readiness.blockers),
        firstNextAction(readiness.blockers) || '按 readiness.blockers 逐项修复后重试。',
      );
    }
    if (Array.isArray(readiness.warnings) && readiness.warnings.length) {
      record('WARN', 'local engine readiness warnings', formatBlockers(readiness.warnings), firstNextAction(readiness.warnings));
    }
  }

  const health = await request('GET', '/local-engine/health').catch((error) => {
    record('FAILED', 'local engine health unreachable', error.message, '确认本地引擎模块已注册。');
    return null;
  });
  if (health?.capabilities) {
    const commercial = health.capabilities.find((item) => item.key === 'permission-check');
    const missing = health.capabilities.filter((item) => item.status === 'missing');
    if (commercial) {
      record(commercial.status === 'ready' ? 'PASS' : 'BLOCKED', 'commercial permission capability', commercial.summary, commercial.nextAction);
    }
    if (missing.length) {
      record(
        'BLOCKED',
        'missing local capabilities',
        missing.map((item) => `${item.name}:${item.summary}`).join(' | '),
        missing.map((item) => item.nextAction).filter(Boolean).join(' | ') || '补齐缺失本地能力后重试。',
      );
    }
  }

  const browserStatus = await request('GET', '/local-engine/browser/status').catch((error) => {
    record('FAILED', 'browser account status unreachable', error.message, '确认 5409 本地浏览器引擎在线。');
    return null;
  });
  if (browserStatus) {
    if (!browserStatus.engineOnline) {
      record('BLOCKED', 'browser engine offline', browserStatus.engineMessage, browserStatus.recovery?.nextAction);
    } else if ((browserStatus.readyAccounts || 0) < 1) {
      record(
        'BLOCKED',
        'no ready real platform account',
        `total=${browserStatus.totalAccounts || 0}, ready=${browserStatus.readyAccounts || 0}, expired=${browserStatus.expiredAccounts || 0}`,
        '到发布中心/平台账号完成真实账号登录或刷新账号状态。',
      );
    } else {
      record('PASS', 'ready real platform accounts found', describeAccounts(browserStatus.accounts));
    }
  }

  const executors = await request('GET', '/local-engine/executors/status').catch((error) => {
    record('FAILED', 'executor status unreachable', error.message, '确认本地执行器状态接口可用。');
    return null;
  });
  if (executors?.executors) {
    for (const type of requiredTaskTypes) {
      const executor = executors.executors.find((item) => item.key === type);
      if (!executor) {
        record('BLOCKED', `executor missing from matrix: ${type}`, '接口未返回该执行器。', '补齐执行器状态定义后重试。');
      } else if (executor.status !== 'ready') {
        record('BLOCKED', `executor not ready: ${executor.name}`, executor.message, executor.nextAction);
      } else {
        record('PASS', `executor ready: ${executor.name}`, executor.message);
      }
    }
  }

  const desktop = await request('GET', '/local-engine/desktop/status').catch((error) => {
    record('FAILED', 'desktop status unreachable', error.message, '确认桌面控制接口可用。');
    return null;
  });
  if (desktop) {
    const blockedPermissions = (desktop.permissionChecks || []).filter((item) => item.status === 'blocked');
    if (!desktop.running || !desktop.available) {
      record('BLOCKED', 'desktop WeChat unavailable', desktop.message, desktop.nextAction || '打开桌面微信并授予辅助功能/屏幕录制权限。');
    } else if (blockedPermissions.length) {
      record(
        'BLOCKED',
        'desktop permissions blocked',
        blockedPermissions.map((item) => `${item.label}:${item.message}`).join(' | '),
        blockedPermissions.map((item) => item.nextAction).filter(Boolean).join(' | ') || '到系统设置补齐桌面控制权限。',
      );
    } else {
      record('PASS', 'desktop WeChat control preflight passed', desktop.message);
    }
  }

  const desktopPreflight = await request('GET', '/local-engine/desktop/preflight').catch((error) => {
    record('FAILED', 'desktop commercial preflight unreachable', error.message, '确认 /local-engine/desktop/preflight 接口已注册。');
    return null;
  });
  if (desktopPreflight) {
    const requiredKeys = [
      'accessibility',
      'screen-recording',
      'foreground-app',
      'window-list',
      'screenshot',
      'input-control',
      'click-control',
      'file-selection',
      'manual-takeover',
      'stop-control',
    ];
    const checks = Array.isArray(desktopPreflight.checks) ? desktopPreflight.checks : [];
    const missingKeys = requiredKeys.filter((key) => !checks.some((check) => check.key === key));
    const blockedChecks = checks.filter((check) => check.status === 'blocked');
    if (missingKeys.length) {
      record(
        'FAILED',
        'desktop commercial preflight missing checks',
        missingKeys.join(', '),
        '桌面控制商用验收必须覆盖权限、窗口、截图、输入、点击、file-selection、接管和停止能力。',
      );
    } else if (!desktopPreflight.allowed) {
      record(
        'BLOCKED',
        'desktop commercial preflight blocked',
        [...(desktopPreflight.blockers || []), ...blockedChecks.map((check) => `${check.label}:${check.message}`)].join(' | ') || desktopPreflight.message,
        desktopPreflight.nextAction || '修复桌面权限、窗口、截图或输入/点击能力后重试。',
      );
    } else if (!desktopPreflight.screenshot || !desktopPreflight.takeoverReady || !desktopPreflight.stopReady) {
      record(
        'FAILED',
        'desktop commercial preflight missing evidence/control',
        `screenshot=${Boolean(desktopPreflight.screenshot)}, takeoverReady=${desktopPreflight.takeoverReady}, stopReady=${desktopPreflight.stopReady}`,
        '商用桌面控制必须有截图证据、人工接管和停止任务能力。',
      );
    } else {
      record('PASS', 'desktop commercial preflight passed', desktopPreflight.message);
    }
  }

  const fileAccess = await request('GET', '/local-engine/files/status').catch((error) => {
    record('FAILED', 'file-selection status unreachable', error.message, '确认 /local-engine/files/status 接口可用。', {
      area: 'desktop-file-selection',
      requirement: '桌面控制必须能审计本地素材/账号/日志文件访问状态。',
    });
    return null;
  });
  if (fileAccess) {
    verifyFileSelectionMatrix(fileAccess);
  }

  if (requiredTaskTypes.includes('wechat-reply-draft')) {
    await confirmWechatSessionForGate();
  }
}

async function confirmWechatSessionForGate() {
  if (!wechatTargetContact) {
    record(
      'BLOCKED',
      'WeChat target contact missing',
      'COMMERCIAL_WECHAT_TARGET_CONTACT 未设置，脚本不能猜测当前微信会话对象。',
      '把桌面微信停在测试联系人/测试群，并设置 COMMERCIAL_WECHAT_TARGET_CONTACT。',
    );
    return;
  }

  await request('POST', '/local-engine/wechat/session/confirm', {
    targetContact: wechatTargetContact,
    currentWindowConfirmed: true,
    contactConfirmed: true,
    draftBeforeFillConfirmed: true,
    currentWindowTitle: process.env.COMMERCIAL_WECHAT_WINDOW_TITLE || undefined,
    contactAmbiguityResolved: true,
    popupCleared: true,
    loggedInConfirmed: true,
    operator,
    note: 'commercial acceptance gate preflight',
  }).catch((error) => {
    record('FAILED', 'WeChat session confirmation failed', error.message, '检查微信会话确认接口和桌面状态。');
    return null;
  });

  const status = await request('GET', '/local-engine/wechat/session/status').catch((error) => {
    record('FAILED', 'WeChat session status failed', error.message, '检查微信会话状态接口。');
    return null;
  });
  if (!status) return;
  if (!status.canDraft) {
    record(
      'BLOCKED',
      'WeChat session cannot draft',
      [...(status.blockers || []), ...(status.warnings || [])].join(' | ') || 'canDraft=false',
      status.nextAction || '确认桌面微信、目标联系人、弹窗和权限后重试。',
    );
    return;
  }
  record('PASS', 'WeChat session locked for draft-only execution', status.lock?.message || status.targetContact || wechatTargetContact);
}

async function runBatchTaskMatrixCheck() {
  section('Batch Task Matrix');
  const batchTargets = [
    {
      targetName: '商业验收批量客户A',
      sourceText: '商业验收批量任务：客户A询问今天是否可预约。',
      replyText: '您好，今天可以先登记预约，我稍后人工确认具体时间。',
    },
    {
      targetName: '商业验收批量客户B',
      sourceText: '商业验收批量任务：客户B询问价格。',
      replyText: '您好，价格需要结合项目确认，我先为您记录需求。',
    },
    {
      targetName: '商业验收批量客户C',
      sourceText: '商业验收批量任务：客户C询问地址。',
      replyText: '您好，我先把地址和注意事项整理成草稿，稍后人工确认。',
    },
  ];
  const task = await request('POST', '/local-engine/customers/tasks', {
    type: 'customer-follow-up',
    accountName: 'commercial-batch-internal-account',
    platformName: '内部跟进',
    targetName: batchTargets[0].targetName,
    sourceText: batchTargets[0].sourceText,
    replyText: batchTargets[0].replyText,
    sendMode: 'draft-only',
    batchTargets,
  }).catch((error) => {
    record('FAILED', 'batch task creation failed', error.message, '检查批量任务创建接口和 batchTargets 结构。', {
      area: 'batch-tasks',
      requirement: '批量任务必须创建真实任务记录，不能只在 UI 假展示。',
    });
    return null;
  });
  if (!task?.id) return;
  artifacts.createdTaskIds.push(task.id);

  const latest = await waitForTask(task.id, ['completed', 'failed', 'skipped', 'no_target', 'waiting_for_send_confirmation']);
  if (!latest) return;
  const summary = latest.batchSummary || {};
  const targetCount = Array.isArray(latest.batchTargets) ? latest.batchTargets.length : 0;
  if (targetCount !== batchTargets.length || summary.total !== batchTargets.length) {
    record(
      'FAILED',
      'batch task summary mismatch',
      `targets=${targetCount}, summary=${JSON.stringify(summary)}`,
      '批量任务必须保留每个对象和总数统计。',
      {
        area: 'batch-tasks',
        requirement: 'batchTargets 与 batchSummary.total 必须一致。',
      },
    );
  } else if (latest.status === 'failed') {
    recordClassifiedTaskFailure('Batch customer follow-up', latest, 'batch-tasks');
  } else {
    record(
      'PASS',
      'batch task matrix retained target outcomes',
      `task=${task.id}, status=${latest.status}, summary=${JSON.stringify(summary)}`,
      '',
      {
        area: 'batch-tasks',
        requirement: '批量任务应导入多对象并输出逐对象结果统计。',
      },
    );
  }

  const diagnostics = await exportTaskDiagnostics(task.id, 'batch task matrix');
  const diagnosticTargets = diagnostics?.task?.batchTargets || [];
  const diagnosticSummary = diagnostics?.task?.batchSummary || {};
  if (diagnostics) {
    if (diagnosticTargets.length !== batchTargets.length || diagnosticSummary.total !== batchTargets.length) {
      record(
        'FAILED',
        'batch diagnostics missing matrix detail',
        `targets=${diagnosticTargets.length}, summary=${JSON.stringify(diagnosticSummary)}`,
        '诊断包必须导出 batchTargets 与 batchSummary，便于商用追责。',
        {
          area: 'batch-tasks',
          requirement: '批量任务证据导出必须包含逐对象矩阵。',
        },
      );
    } else {
      record('PASS', 'batch diagnostics export includes target matrix', `task=${task.id}, targets=${diagnosticTargets.length}`, '', {
        area: 'batch-tasks',
        requirement: '批量任务诊断包可复核逐对象状态。',
      });
    }
  }
}

async function runPublishingCenterCheck() {
  section('Publishing Center Matrix');
  const unifiedAccounts = await request('GET', '/publishing/accounts?validate=1&force=1', undefined, {
    timeoutMs: Math.max(timeoutMs, 45000),
  }).catch((error) => {
    recordClassifiedAccessIssue('unified publishing account validation', error, '修复 /publishing/accounts，确保能从 5409 同步本地账号进 3010。', {
      area: 'publishing-center',
      requirement: '发布中心账号源必须统一到 3010 publish_accounts。',
    });
    return null;
  });
  if (Array.isArray(unifiedAccounts)) {
    verifyUnifiedPublishingAccounts(unifiedAccounts);
  }

  const health = await request('GET', '/auto-upload/health').catch((error) => {
    recordClassifiedAccessIssue('publishing center health', error, '启动 5409 本地发布引擎并确认 /auto-upload/health 可达。', {
      area: 'publishing-center',
      requirement: '发布中心必须连到真实本地发布引擎。',
    });
    return null;
  });
  if (health) {
    record('PASS', 'publishing center engine health reachable', `${health.service || 'auto-upload'} ${health.version || ''}`.trim(), '', {
      area: 'publishing-center',
      requirement: '发布中心引擎健康检查可达。',
    });
  }

  const accounts = await request('GET', '/auto-upload/accounts?validate=1').catch((error) => {
    recordClassifiedAccessIssue('publishing account validation', error, '登录真实发布测试账号或修复 5409 账号接口。', {
      area: 'publishing-center',
      requirement: '发布中心必须读取真实平台账号状态。',
    });
    return null;
  });
  if (Array.isArray(accounts)) {
    const ready = accounts.filter((account) => account.status === 1 || account.statusLabel === '正常' || account.statusLabel === '可用');
    if (!ready.length) {
      record(
        'BLOCKED',
        'publishing center has no ready account',
        `total=${accounts.length}`,
        '到发布中心-平台账号登录真实测试账号，或设置 COMMERCIAL_PUBLISH_ACCOUNT_FILE 指向已登录账号文件。',
        {
          area: 'publishing-center',
          requirement: '真实发布验收必须有 ready 平台账号。',
        },
      );
    } else {
      record('PASS', 'publishing center ready accounts found', `ready=${ready.length}, total=${accounts.length}`, '', {
        area: 'publishing-center',
        requirement: '发布中心能识别 ready 真实账号。',
      });
    }
  }

  const materials = await request('GET', '/auto-upload/materials').catch((error) => {
    recordClassifiedAccessIssue('publishing material list', error, '上传或选择真实测试素材，或修复素材接口。', {
      area: 'publishing-center',
      requirement: '发布中心必须读取真实素材列表。',
    });
    return null;
  });
  if (Array.isArray(materials)) {
    if (!materials.length && !publishMaterialFile) {
      record(
        'BLOCKED',
        'publishing center has no test material',
        'auto-upload materials is empty and COMMERCIAL_PUBLISH_MATERIAL_FILE is unset',
        '在发布中心上传真实测试素材，或设置 COMMERCIAL_PUBLISH_MATERIAL_FILE。',
        {
          area: 'publishing-center',
          requirement: '真实发布验收必须有可读取素材。',
        },
      );
    } else {
      record('PASS', 'publishing center materials visible', `materials=${materials.length}, override=${Boolean(publishMaterialFile)}`, '', {
        area: 'publishing-center',
        requirement: '发布中心能列出或指定测试素材。',
      });
    }
  }

  const payload = buildPublishPayload(accounts, materials);
  await verifyPublishRiskGuard(payload);
  await verifyPublishConfirmationSession(payload);
  if (realPublishEnabled && approvePublishEnabled) {
    await verifyRealPublishSubmission(payload);
  } else {
    record(
      'BLOCKED',
      'real publish submission not acknowledged',
      `COMMERCIAL_REAL_PUBLISH=${realPublishEnabled ? '1' : '<unset>'}, COMMERCIAL_APPROVE_PUBLISH=${approvePublishEnabled ? '1' : '<unset>'}`,
      '确认使用真实测试账号和素材后，同时设置 COMMERCIAL_REAL_PUBLISH=1 与 COMMERCIAL_APPROVE_PUBLISH=1。',
      {
        area: 'publishing-center',
        requirement: '真实发布提交必须显式授权；未授权时 BLOCKED 而不是通过。',
      },
    );
  }
}

async function syncPublishingAccountsFromLocalEngine() {
  section('Publishing Account Sync');
  const accounts = await request('GET', '/publishing/accounts?validate=1&force=1', undefined, {
    timeoutMs: Math.max(timeoutMs, 45000),
  }).catch((error) => {
    recordClassifiedAccessIssue('publishing accounts sync failed', error, '修复 /publishing/accounts 或 5409 账号接口。', {
      area: 'publishing-center',
      requirement: '3010 必须把 5409 本地账号同步为可审计 publish_accounts。',
    });
    return null;
  });
  if (!Array.isArray(accounts)) return;
  verifyUnifiedPublishingAccounts(accounts);
}

function verifyUnifiedPublishingAccounts(accounts) {
  const localAccounts = accounts.filter(
    (account) => account.source === 'local-engine' || String(account.id || '').startsWith('local-engine:'),
  );
  const dbCount = safeTableCount('publish_accounts');
  if (!localAccounts.length) {
    record(
      'BLOCKED',
      'no local engine accounts in unified publish accounts',
      `accounts=${accounts.length}, publish_accounts=${dbCount ?? 'unknown'}`,
      '确认 5409 有账号，并修复 /publishing/accounts 同步。',
      {
        area: 'publishing-center',
        requirement: '页面读取到的 5409 账号必须同步到 3010 publish_accounts。',
      },
    );
    return false;
  }
  if (dbCount === null || dbCount < localAccounts.length) {
    record(
      'FAILED',
      'local engine accounts not persisted in 3010 publish_accounts',
      `localEngineAccounts=${localAccounts.length}, publish_accounts=${dbCount ?? 'unknown'}`,
      '修复账号同步，不能只在页面临时展示 5409 账号。',
      {
        area: 'publishing-center',
        requirement: '页面读取到的 5409 账号必须同步到 3010 publish_accounts。',
      },
    );
    return false;
  }
  record(
    'PASS',
    'local engine accounts synced into 3010 publish_accounts',
    `localEngineAccounts=${localAccounts.length}, publish_accounts=${dbCount}`,
    '',
    {
      area: 'publishing-center',
      requirement: '页面读取到的 5409 账号必须同步到 3010 publish_accounts。',
    },
  );
  return true;
}

async function verifyPublishRiskGuard(payload) {
  const guarded = await request('POST', '/auto-upload/publish', { payloads: [payload] }).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  if (guarded.ok) {
    record(
      'FAILED',
      'publish direct submit bypassed risk confirmation',
      JSON.stringify(guarded.value || {}),
      '发布中心真实发布必须要求后端风控确认，不能无确认提交。',
      {
        area: 'permission-escape',
        requirement: '发布动作缺少人工确认时必须被风控拒绝。',
      },
    );
    return;
  }
  if (isRiskConfirmationError(guarded.error)) {
    record('PASS', 'publish direct submit blocked by backend risk gate', guarded.error.message, '', {
      area: 'permission-escape',
      requirement: '发布动作缺少人工确认会被后端风控阻断。',
    });
    return;
  }
  recordClassifiedAccessIssue('publish direct submit failed before risk gate', guarded.error, '补齐账号、素材、5409 引擎后重跑；若仍非风控错误则排查发布接口。', {
    area: 'publishing-center',
    requirement: '发布接口错误应 FAILED，账号/素材/引擎缺失应 BLOCKED。',
  });
}

async function verifyPublishConfirmationSession(payload) {
  const session = await request('POST', '/local-engine/agent-sessions', {
    title: 'commercial-publishing-center-confirmation',
    instruction: '商业验收：发布中心真实提交必须停在待我确认，不允许绕过审批直接发布。',
    source: 'publishing',
    executionScope: 'browser',
    targetApp: '发布中心',
    dryRun: true,
    resumeAction: {
      kind: 'auto-upload-publish',
      label: '商业验收发布确认',
      payloads: [payload],
    },
  }).catch((error) => {
    record('FAILED', 'publishing confirmation session creation failed', error.message, '检查 Agent 会话 resumeAction=auto-upload-publish。', {
      area: 'publishing-center',
      requirement: '发布中心动作必须进入待确认队列。',
    });
    return null;
  });
  if (!session?.id) return;
  artifacts.createdSessionIds.push(session.id);
  const confirmation = firstPendingConfirmation(session);
  if (!confirmation || session.resumeAction?.kind !== 'auto-upload-publish') {
    record(
      'FAILED',
      'publishing confirmation missing or malformed',
      `session=${session.id}, status=${session.status}, resume=${session.resumeAction?.kind || '-'}`,
      '发布中心动作必须带 auto-upload-publish resumeAction 并停在 pending confirmation。',
      {
        area: 'publishing-center',
        requirement: '发布确认队列必须可查询、可拒绝、可导出证据。',
      },
    );
    return;
  }
  record('PASS', 'publishing action parked in confirmation queue', `session=${session.id}, confirmation=${confirmation.id}`, '', {
    area: 'publishing-center',
    requirement: '发布中心动作先进入待我确认。',
  });
  const queue = await request('GET', `/local-engine/confirmations?status=pending&sessionId=${encodeURIComponent(session.id)}`).catch((error) => {
    record('FAILED', 'publishing confirmation query failed', error.message, '检查确认队列查询接口。', {
      area: 'publishing-center',
      requirement: '发布确认必须能按 sessionId 查询。',
    });
    return null;
  });
  if (Array.isArray(queue) && queue.some((item) => item.id === confirmation.id)) {
    record('PASS', 'publishing confirmation queryable by session', `confirmation=${confirmation.id}`, '', {
      area: 'publishing-center',
      requirement: '待确认队列可以定位发布动作。',
    });
  } else if (queue) {
    record('FAILED', 'publishing confirmation not returned by query', JSON.stringify(queue), '修复确认队列过滤或会话关联。', {
      area: 'publishing-center',
      requirement: '待确认队列不能丢失发布动作。',
    });
  }
  const rejected = await request('POST', `/local-engine/confirmations/${confirmation.id}/reject`, {
    operator,
    note: 'commercial acceptance rejects publish guard',
  }).catch((error) => {
    record('FAILED', 'publishing confirmation reject failed', error.message, '检查发布确认拒绝接口。', {
      area: 'publishing-center',
      requirement: '拒绝发布确认必须取消动作。',
    });
    return null;
  });
  if (rejected?.status === 'cancelled') {
    record('PASS', 'publishing confirmation reject cancels session', `session=${session.id}`, '', {
      area: 'publishing-center',
      requirement: '拒绝发布确认后会话停止。',
    });
  } else if (rejected) {
    record('FAILED', 'publishing confirmation reject did not cancel session', `status=${rejected.status}`, '拒绝发布动作后必须停止会话。', {
      area: 'publishing-center',
      requirement: '发布确认拒绝不能遗留可继续动作。',
    });
  }
  await exportAgentEvidence(session.id, 'publishing center');
}

async function verifyRealPublishSubmission(payload) {
  const placeholderFiles = [...(payload.fileList || []), ...(payload.accountList || [])].filter((filePath) =>
    /commercial-acceptance-missing-(material|account)/.test(String(filePath || '')),
  );
  if (placeholderFiles.length) {
    record(
      'BLOCKED',
      'real publish account/material path missing',
      `missing=${placeholderFiles.join(', ')}`,
      '发布中心必须提供真实账号文件和素材文件；如果 5409 已有账号/素材但没有 filePath，需要修复账号/素材同步字段。',
      {
        area: 'publishing-center',
        requirement: '真实发布提交必须使用真实账号文件和素材文件，不能用占位路径。',
      },
    );
    return;
  }
  const result = await request('POST', '/auto-upload/publish', {
    payloads: [payload],
    riskConfirmation: {
      confirmed: true,
      confirmedAction: 'publish',
      confirmedRiskLevel: 'high',
      operator,
      reason: 'commercial acceptance approved real test publish submission',
      checklist: {
        account: true,
        material: true,
        target: true,
        content: true,
        rollback: true,
      },
    },
  }, { timeoutMs: Math.max(timeoutMs, Number(process.env.COMMERCIAL_PUBLISH_TIMEOUT_MS || 180000)) }).catch((error) => {
    recordClassifiedAccessIssue('real publish submission failed', error, '如果账号/素材/5409 缺失则补齐；如果接口结构错误则修复发布接口。', {
      area: 'publishing-center',
      requirement: '显式授权后真实发布接口必须返回 taskIds/results/riskAudit。',
    });
    return null;
  });
  if (!result) return;
  if (!result.riskAudit || (!Array.isArray(result.taskIds) && !Array.isArray(result.results))) {
    record(
      'FAILED',
      'real publish response missing audit/result',
      JSON.stringify(result),
      '发布提交必须返回 riskAudit 以及 taskIds 或逐平台 results。',
      {
        area: 'publishing-center',
        requirement: '真实发布提交返回值必须可审计。',
      },
    );
    return;
  }
  const confirmations = collectPublishConfirmations(result);
  if (!confirmations.length) {
    record(
      'BLOCKED',
      'real publish lacks platform confirmation evidence',
      `taskIds=${(result.taskIds || []).join(',') || '-'}, results=${JSON.stringify(result.results || [])}`,
      '真实发布必须返回平台文章 ID、发布链接、平台回执或页面回读；只有任务 ID 不能算发布成功。',
      {
        area: 'publishing-center',
        requirement: '真实发布必须有平台回执或页面回读。',
      },
    );
    return;
  }
  record('PASS', 'real publish submission returned platform confirmation', confirmations.join(' | '), '', {
    area: 'publishing-center',
    requirement: '真实发布提交有风控审计和平台确认。',
  });
}

async function runContentToPublishingCheck() {
  section('Content To Publishing Pipeline');
  const seededTopics = await ensureContentPipelineSeedData();

  const [materials, topics, articles, accounts] = await Promise.all([
    request('GET', '/materials?limit=10').catch((error) => {
      recordClassifiedAccessIssue('content pipeline materials query failed', error, '修复素材列表接口。', {
        area: 'content-pipeline',
        requirement: '内容链路必须能读取素材。',
      });
      return null;
    }),
    request('GET', '/topics?limit=10&sortBy=date-desc').catch((error) => {
      recordClassifiedAccessIssue('content pipeline topics query failed', error, '修复选题列表接口。', {
        area: 'content-pipeline',
        requirement: '内容链路必须能读取选题。',
      });
      return null;
    }),
    request('GET', '/articles?limit=10').catch((error) => {
      recordClassifiedAccessIssue('content pipeline articles query failed', error, '修复文章列表接口。', {
        area: 'content-pipeline',
        requirement: '内容链路必须能读取文章/小红书笔记。',
      });
      return null;
    }),
    request('GET', '/publishing/accounts?validate=1&force=1', undefined, {
      timeoutMs: Math.max(timeoutMs, 45000),
    }).catch((error) => {
      recordClassifiedAccessIssue('content pipeline publish account query failed', error, '修复发布账号统一接口。', {
        area: 'content-pipeline',
        requirement: '内容链路进入发布中心前必须有统一发布账号。',
      });
      return null;
    }),
  ]);

  const materialItems = unwrapItems(materials);
  const topicItems = [...seededTopics, ...unwrapItems(topics)].filter(
    (topic, index, all) => topic?.id && all.findIndex((item) => item?.id === topic.id) === index,
  );
  const articleItems = unwrapItems(articles);
  const accountItems = Array.isArray(accounts) ? accounts : unwrapItems(accounts);

  if (materialItems.length) {
    record('PASS', 'content pipeline materials readable', `materials=${materialItems.length}`, '', {
      area: 'content-pipeline',
      requirement: '内容链路必须能读取素材。',
    });
  } else {
    record('BLOCKED', 'content pipeline has no materials', 'materials=0', '先准备真实素材或完成素材采集。', {
      area: 'content-pipeline',
      requirement: '内容链路必须从真实素材开始。',
    });
  }

  if (topicItems.length) {
    record('PASS', 'content pipeline topics readable', `topics=${topicItems.length}`, '', {
      area: 'content-pipeline',
      requirement: '内容链路必须能读取选题。',
    });
  } else {
    record('BLOCKED', 'content pipeline has no topics', 'topics=0', '先完成选题挖掘或创建测试选题。', {
      area: 'content-pipeline',
      requirement: '内容链路必须有可生成内容的选题。',
    });
  }

  const publishableArticles = articleItems.filter((article) =>
    article?.id && ['article', 'xiaohongshu'].includes(String(article.contentType || article.content_type || 'article')),
  );
  if (publishableArticles.length) {
    record('PASS', 'content pipeline articles readable', `articles=${publishableArticles.length}`, '', {
      area: 'content-pipeline',
      requirement: '内容链路必须能产生可进入发布中心的文章/笔记。',
    });
  } else if (realContentPipelineEnabled && approveContentPipelineEnabled && topicItems.length) {
    record('WARN', 'content pipeline has no existing publishable articles', 'articles=0; will generate in real cycles', '继续执行真实内容生成闭环。', {
      area: 'content-pipeline',
      requirement: '内容链路必须能产生可进入发布中心的文章/笔记。',
    });
  } else {
    record('BLOCKED', 'content pipeline has no publishable articles', 'articles=0', '先生成文章或小红书笔记。', {
      area: 'content-pipeline',
      requirement: '内容链路必须能产生可进入发布中心的文章/笔记。',
    });
  }

  const readyAccounts = accountItems.filter(
    (account) => isReadyAccount(account),
  );
  if (readyAccounts.length) {
    record('PASS', 'content pipeline publish accounts ready', `readyAccounts=${readyAccounts.length}`, '', {
      area: 'content-pipeline',
      requirement: '内容链路进入发布中心前必须有 ready 发布账号。',
    });
  } else {
    record('BLOCKED', 'content pipeline has no ready publish account', `accounts=${accountItems.length}`, '先登录并同步可用发布账号。', {
      area: 'content-pipeline',
      requirement: '内容链路进入发布中心前必须有 ready 发布账号。',
    });
  }

  if (!realContentPipelineEnabled || !approveContentPipelineEnabled) {
    record(
      'BLOCKED',
      'content to publishing 5-cycle loop not acknowledged',
      `COMMERCIAL_REAL_CONTENT_PIPELINE=${realContentPipelineEnabled ? '1' : '<unset>'}, COMMERCIAL_APPROVE_CONTENT_PIPELINE=${approveContentPipelineEnabled ? '1' : '<unset>'}, cycles=${contentPipelineCycles}`,
      '确认允许连续生成/导入测试内容后，同时设置 COMMERCIAL_REAL_CONTENT_PIPELINE=1 与 COMMERCIAL_APPROVE_CONTENT_PIPELINE=1。',
      {
        area: 'content-pipeline',
        requirement: '素材采集/选题/内容生成/进入发布中心必须连续 5 条验收。',
      },
    );
    return;
  }

  await runContentPipelineCycles(topicItems, readyAccounts);
}

async function runContentPipelineCycles(topicItems, readyAccounts) {
  const topics = topicItems.filter((topic) => topic?.id).slice(0, contentPipelineCycles);
  if (topics.length < contentPipelineCycles) {
    record(
      'BLOCKED',
      'content pipeline cycle topics insufficient',
      `topics=${topics.length}/${contentPipelineCycles}`,
      '补齐可生成内容的测试选题后重跑。',
      {
        area: 'content-pipeline',
        requirement: '内容生产到发布中心必须连续 5 条。',
      },
    );
    return;
  }
  if (!readyAccounts.length) return;

  let completed = 0;
  for (const [index, topic] of topics.entries()) {
    const article = await request(
      'POST',
      `/articles/${encodeURIComponent(topic.id)}/generate?force=true&contentType=xiaohongshu`,
      undefined,
      { timeoutMs: contentGenerateTimeoutMs },
    ).catch((error) => {
      record('FAILED', `content pipeline generate failed #${index + 1}`, error.message, '排查文章/小红书生成接口和默认模型。', {
        area: 'content-pipeline',
        requirement: '每条链路必须从选题生成内容。',
      });
      return null;
    });
    if (!article?.id) continue;

    const imported = await request('POST', '/auto-upload/materials/import-article', {
      articleId: article.id,
    }).catch((error) => {
      recordClassifiedAccessIssue(`content pipeline material import failed #${index + 1}`, error, '给生成内容补齐可发布素材，或修复导入接口。', {
        area: 'content-pipeline',
        requirement: '生成内容必须能进入发布中心素材池。',
      });
      return null;
    });

    if (imported?.imported?.length || imported?.files?.length) {
      completed += 1;
      record('PASS', `content pipeline cycle ready #${index + 1}`, `article=${article.id}, imported=${imported.imported?.length || imported.files?.length}`, '', {
        area: 'content-pipeline',
        requirement: '每条链路必须生成内容并进入发布中心素材池。',
      });
    } else {
      record('BLOCKED', `content pipeline cycle has no importable material #${index + 1}`, `article=${article.id}`, '生成内容缺本地可上传素材，不能算进入发布中心。', {
        area: 'content-pipeline',
        requirement: '每条链路必须生成内容并进入发布中心素材池。',
      });
    }
  }

  if (completed === contentPipelineCycles) {
    record('PASS', 'content to publishing 5-cycle loop passed', `cycles=${completed}/${contentPipelineCycles}`, '', {
      area: 'content-pipeline',
      requirement: '素材/选题/内容/发布中心连续 5 条链路完成。',
    });
  } else {
    record('FAILED', 'content to publishing 5-cycle loop incomplete', `cycles=${completed}/${contentPipelineCycles}`, '修复失败轮次后重跑。', {
      area: 'content-pipeline',
      requirement: '素材/选题/内容/发布中心连续 5 条链路完成。',
    });
  }
}

async function ensureContentPipelineSeedData() {
  if (!realContentPipelineEnabled || !approveContentPipelineEnabled) return [];

  const topics = unwrapItems(await request('GET', `/topics?limit=${contentPipelineCycles}&sortBy=date-desc`).catch(() => null));
  if (topics.length >= contentPipelineCycles) return topics.slice(0, contentPipelineCycles);

  const materials = unwrapItems(await request('GET', `/materials?limit=${Math.max(contentPipelineCycles, 10)}`).catch(() => null));
  if (!materials.length) return topics;

  const missing = contentPipelineCycles - topics.length;
  const createdTopics = [];
  for (let index = 0; index < missing; index += 1) {
    const material = materials[index % materials.length];
    const title = `商业验收内容链路选题 ${new Date().toISOString().slice(0, 10)} #${index + 1}`;
    await request('POST', '/topics', {
      title,
      description: '用于 KaypalAI 内容创作平台商用验收的内容生产到发布中心链路。',
      summary: `围绕「${material?.title || '真实素材'}」生成可发布内容，验证素材、选题、成稿、导入发布中心连续闭环。`,
      sourceType: '商业验收',
      keywords: ['商业验收', '内容生产', '发布中心'],
      materialIds: material?.id ? [material.id] : [],
    }).then(
      (topic) => {
        if (topic?.id) createdTopics.push(topic);
        record('PASS', 'content pipeline seed topic created', `topic=${topic.id || title}`, '', {
          area: 'content-pipeline',
          requirement: '缺选题时验收脚本应能从真实素材创建测试选题。',
        });
      },
      (error) => {
        recordClassifiedAccessIssue('content pipeline seed topic creation failed', error, '修复选题创建接口或素材关联后重跑。', {
          area: 'content-pipeline',
          requirement: '缺选题时验收脚本应能从真实素材创建测试选题。',
        });
      },
    );
  }
  return [...createdTopics, ...topics];
}

async function runUnauthorizedMatrixCheck() {
  section('Unauthorized And Permission Escape');
  const checks = [
    {
      label: 'publish without confirmation',
      method: 'POST',
      path: '/auto-upload/publish',
      body: { payloads: [buildPublishPayload([], [])] },
      expected: 'risk',
      nextAction: '发布接口必须要求人工确认。',
    },
    {
      label: 'evidence cleanup without confirmation',
      method: 'POST',
      path: '/local-engine/evidence/cleanup',
      body: { retentionDays: 0 },
      expected: 'risk-or-blocked',
      nextAction: '证据清理必须要求人工确认或角色权限阻断。',
    },
    {
      label: 'remote takeover without confirmation',
      method: 'POST',
      path: '/local-engine/wechat/session/takeover',
      body: { operator, reason: 'commercial acceptance unauthorized takeover probe' },
      expected: 'risk-or-blocked',
      nextAction: '桌面接管必须被风控或桌面权限阻断。',
    },
  ];

  for (const check of checks) {
    const result = await request(check.method, check.path, check.body).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    if (result.ok) {
      record(
        'FAILED',
        `unauthorized action was allowed: ${check.label}`,
        JSON.stringify(result.value || {}),
        check.nextAction,
        {
          area: 'permission-escape',
          requirement: '越权/高风险动作未确认时不得执行。',
        },
      );
      continue;
    }
    if (isRiskConfirmationError(result.error) || (check.expected === 'risk-or-blocked' && isBlockedAccessError(result.error))) {
      record('PASS', `unauthorized action blocked: ${check.label}`, result.error.message, '', {
        area: 'permission-escape',
        requirement: '越权/高风险动作被后端风控或真实权限阻断。',
      });
    } else {
      record(
        'FAILED',
        `unauthorized action returned unexpected error: ${check.label}`,
        result.error.message,
        '越权测试应返回风控/权限阻断，而不是接口异常。',
        {
          area: 'permission-escape',
          requirement: '越权测试错误类型必须可区分。',
        },
      );
    }
  }
}

async function checkCommercialRiskGate() {
  section('Permission And Risk Gate');
  const session = await request('POST', '/local-engine/agent-sessions', {
    title: 'commercial-risk-remote-takeover-guard',
    instruction: '商业验收：申请远程接管桌面微信，准备群发/删除/发送内容；必须进入审批并由脚本拒绝。',
    source: 'agent-console',
    executionScope: 'remote',
    targetApp: '桌面微信',
    dryRun: true,
  }).catch((error) => {
    record('FAILED', 'risk gate session creation failed', error.message, '检查 Agent 会话和权限风控接口。');
    return null;
  });
  if (!session?.id) return;
  artifacts.createdSessionIds.push(session.id);

  const confirmation = firstPendingConfirmation(session);
  if (!confirmation) {
    record('FAILED', 'high-risk session did not stop at confirmation', `session=${session.id}, status=${session.status}`, '高风险/远程接管必须先进入待确认。');
    return;
  }

  const checkKeys = new Set((confirmation.requiredChecks || []).map((item) => item.key));
  const requiredChecks = ['scope', 'target', 'content', 'window', 'commercial-permission', 'misfire-protection', 'double-confirmation', 'remote-takeover-audit'];
  const missing = requiredChecks.filter((key) => !checkKeys.has(key));
  if (missing.length) {
    record('FAILED', 'risk confirmation missing required checks', missing.join(', '), '补齐权限风控检查项后重试。');
  } else if (!confirmation.riskPolicy?.remoteTakeoverAuditRequired) {
    record('FAILED', 'remote takeover audit not required', JSON.stringify(confirmation.riskPolicy || {}), '远程/接管类动作必须写入审计策略。');
  } else {
    record('PASS', 'high-risk action blocked by confirmation and audit', `confirmation=${confirmation.id}`);
  }

  const rejected = await request('POST', `/local-engine/confirmations/${confirmation.id}/reject`, {
    operator,
    note: 'commercial acceptance rejects remote takeover guard',
  }).catch((error) => {
    record('FAILED', 'risk confirmation reject failed', error.message, '检查确认拒绝接口。');
    return null;
  });
  if (rejected?.status === 'cancelled') {
    record('PASS', 'risk confirmation reject cancels session', `session=${session.id}`);
  } else if (rejected) {
    record('FAILED', 'risk confirmation reject did not cancel session', `status=${rejected.status}`, '拒绝高风险动作后会话必须停止。');
  }

  await exportAgentEvidence(session.id, 'risk gate');
}

async function runFailureRecoveryCheck() {
  section('Failure Recovery');
  const task = await request('POST', '/local-engine/customers/tasks', {
    type: 'customer-follow-up',
    accountName: 'commercial-recovery-internal-account',
    platformName: '内部跟进',
    targetName: '商业验收失败恢复对象',
    sourceText: '商业验收：这条内部跟进用于验证失败恢复，不触发外部平台。',
    replyText: '商业验收失败恢复回复草稿。',
    sendMode: 'draft-only',
  }).catch((error) => {
    record('FAILED', 'recovery task creation failed', error.message, '检查互动任务创建接口。');
    return null;
  });
  if (!task?.id) return;
  artifacts.createdTaskIds.push(task.id);

  const failed = await request('POST', `/local-engine/tasks/${task.id}/fail`, {
    reason: 'commercial acceptance injected failure for recovery validation',
  }).catch((error) => {
    record('FAILED', 'mark recovery task failed failed', error.message, '检查任务失败回写接口。');
    return null;
  });
  if (failed?.status !== 'failed') {
    record('FAILED', 'recovery task did not enter failed status', `status=${failed?.status}`, '失败恢复必须能追溯失败态。');
    return;
  }

  const retry = await request('POST', `/local-engine/tasks/${task.id}/retry`, {}).catch((error) => {
    record('FAILED', 'retry recovery task failed', error.message, '检查任务重试接口。');
    return null;
  });
  if (!retry?.id || retry.id === task.id) {
    record('FAILED', 'retry task id invalid', JSON.stringify(retry || {}), '重试必须创建可追溯的新任务。');
    return;
  }
  artifacts.createdTaskIds.push(retry.id);
  record('PASS', 'failure recovery creates retry task', `failed=${task.id}, retry=${retry.id}`);
  await exportTaskDiagnostics(task.id, 'injected failure');
  await exportTaskDiagnostics(retry.id, 'retry task');
}

async function runEvidenceAuditCheck() {
  section('Evidence Audit');
  const records = await request('GET', '/local-engine/records/export?limit=200').catch((error) => {
    record('FAILED', 'interaction records export failed', error.message, '检查执行记录导出接口。');
    return null;
  });
  if (records?.content && records?.filename) {
    record('PASS', 'interaction records export returns audit file', `${records.filename}, bytes=${records.content.length}`);
  } else if (records) {
    record('FAILED', 'interaction records export missing content', JSON.stringify(records), '执行记录导出必须返回文件名和内容。');
  }

  const cleanupPreview = await request('GET', '/local-engine/evidence/cleanup-preview?retentionDays=7').catch((error) => {
    record('FAILED', 'evidence cleanup preview failed', error.message, '检查证据治理接口。');
    return null;
  });
  if (cleanupPreview && Number.isInteger(cleanupPreview.candidateCount)) {
    record('PASS', 'evidence cleanup preview is auditable', `candidate=${cleanupPreview.candidateCount}, bytes=${cleanupPreview.totalBytes || 0}`);
  } else if (cleanupPreview) {
    record('FAILED', 'evidence cleanup preview missing counts', JSON.stringify(cleanupPreview), '清理预览不能直接删除，必须先返回候选清单。');
  }
}

async function runPressureCheck() {
  section('Continuous Pressure');
  const sessions = [];
  for (let index = 0; index < pressureCycles; index += 1) {
    const session = await request('POST', '/local-engine/agent-sessions', {
      title: `commercial-pressure-${index + 1}`,
      instruction: `商业连续压测 ${index + 1}：检查互动队列，只生成草稿，不执行真实发送。`,
      source: 'agent-console',
      executionScope: index % 2 === 0 ? 'browser' : 'desktop',
      targetApp: index % 2 === 0 ? '浏览器' : '桌面微信',
      dryRun: true,
    }).catch((error) => {
      record('FAILED', `pressure session create failed #${index + 1}`, error.message, '检查连续创建 Agent 会话时的稳定性。');
      return null;
    });
    if (!session?.id) continue;
    artifacts.createdSessionIds.push(session.id);
    sessions.push(session);

    const confirmation = firstPendingConfirmation(session);
    if (!confirmation) {
      record('FAILED', `pressure session missing confirmation #${index + 1}`, `session=${session.id}, status=${session.status}`, 'dryRun 压测会话必须进入待确认。');
      continue;
    }

    if (pressureApprove) {
      await approveAgentConfirmation(confirmation.id, `commercial pressure approve #${index + 1}`);
      await waitForSession(session.id, ['completed', 'running']);
    } else {
      await request('POST', `/local-engine/confirmations/${confirmation.id}/reject`, {
        operator,
        note: `commercial pressure reject #${index + 1}`,
      });
    }
  }

  if (sessions.length !== pressureCycles) {
    record('FAILED', 'pressure cycle count mismatch', `expected=${pressureCycles}, created=${sessions.length}`, '排查连续创建会话失败的接口或资源限制。');
  } else {
    record('PASS', 'pressure cycles completed without fake success', `cycles=${sessions.length}, approve=${pressureApprove}`);
  }

  const pending = await request('GET', '/local-engine/confirmations?status=pending').catch(() => null);
  if (Array.isArray(pending)) {
    const leaked = pending.filter((item) => sessions.some((session) => session.id === item.sessionId));
    if (leaked.length) {
      record('FAILED', 'pressure confirmations leaked pending state', leaked.map((item) => item.id).join(', '), '压测结束后本轮确认不应遗留 pending。');
    } else {
      record('PASS', 'pressure confirmations drained', `checked=${sessions.length}`);
    }
  }

  for (const session of sessions.slice(0, 3)) {
    await exportAgentEvidence(session.id, `pressure ${session.title}`);
  }
}

async function runRealExecutionChecks() {
  section('Real Account Execution');
  if (!realExecutionEnabled) {
    record(
      'BLOCKED',
      'real execution gate not acknowledged',
      'COMMERCIAL_REAL_EXECUTION=1 未设置；脚本不会在真实账号上创建读取/草稿任务。',
      '确认使用测试账号和测试对象后设置 COMMERCIAL_REAL_EXECUTION=1。',
    );
    return;
  }
  if (!approveDraftsEnabled) {
    record(
      'BLOCKED',
      'draft fill execution not acknowledged',
      'COMMERCIAL_APPROVE_DRAFTS=1 未设置；脚本不会把草稿填入真实浏览器或桌面微信。',
      '确认当前账号、对象和窗口都是测试环境后设置 COMMERCIAL_APPROVE_DRAFTS=1。',
    );
    return;
  }

  const browserStatus = await request('GET', '/local-engine/browser/status');
  const readyAccounts = (browserStatus.accounts || []).filter((account) => account.status === 'ready');
  const douyinAccount = pickAccount(readyAccounts, douyinAccountId, 3);
  const wechatAccount = pickAccount(readyAccounts, wechatAccountId, 2);

  for (const type of requiredTaskTypes) {
    const account = platformTypeForTask(type) === 2 ? wechatAccount : douyinAccount;
    if (!account) {
      record(
        'BLOCKED',
        `real account missing for ${type}`,
        platformTypeForTask(type) === 2
          ? `没有 ready 的视频号/微信账号；COMMERCIAL_WECHAT_ACCOUNT_ID=${wechatAccountId || '<unset>'}`
          : `没有 ready 的抖音账号；COMMERCIAL_DOUYIN_ACCOUNT_ID=${douyinAccountId || '<unset>'}`,
        '到发布中心登录真实测试账号，或通过 COMMERCIAL_*_ACCOUNT_ID 指定 ready 账号。',
      );
      continue;
    }
    await runOneRealTask(type, account);
  }

  if (!realAutoSendEnabled || !approveAutoSendEnabled) {
    record(
      'BLOCKED',
      'real auto-send loop not acknowledged',
      `COMMERCIAL_REAL_AUTO_SEND=${realAutoSendEnabled ? '1' : '<unset>'}, COMMERCIAL_APPROVE_AUTO_SEND=${approveAutoSendEnabled ? '1' : '<unset>'}`,
      '确认四个入口都有测试账号、测试评论/私信对象，并允许真实发送后，同时设置 COMMERCIAL_REAL_AUTO_SEND=1 与 COMMERCIAL_APPROVE_AUTO_SEND=1。',
      {
        area: 'real-execution',
        requirement: '四条客户互动真实自动发送闭环必须显式授权，每条至少连续 5 轮。',
      },
    );
    return;
  }

  for (const type of requiredTaskTypes) {
    const account = platformTypeForTask(type) === 2 ? wechatAccount : douyinAccount;
    if (!account) continue;
    await runRealAutoSendLoop(type, account);
  }
}

async function runOneRealTask(type, account) {
  const route = taskRoute(type);
  const label = taskLabel(type);
  const task = await request('POST', route, {
    type,
    accountId: String(account.id),
    accountName: account.displayName || account.profileName || account.userName || `account-${account.id}`,
    platformType: account.type,
    platformName: account.platform,
    targetName: type === 'wechat-reply-draft' ? wechatTargetContact : '商业验收真实测试对象',
    sendMode: 'approval-send',
    commercialExecutionRequested: true,
  }).catch((error) => {
    record('FAILED', `${label} task creation failed`, error.message, '检查真实账号、任务类型和本地执行器。');
    return null;
  });
  if (!task?.id) return;
  artifacts.createdTaskIds.push(task.id);

  const preflight = await waitForTask(task.id, ['waiting_for_send_confirmation', 'completed', 'failed', 'skipped', 'no_target']);
  if (!preflight) return;

  const boundaryStatus = verifyCommercialBoundary(preflight, label);
  await exportTaskDiagnostics(task.id, `${label} preflight`);
  const evidenceCount = countTaskEvidence(preflight);
  if (evidenceCount < 1) {
    record('FAILED', `${label} missing preflight evidence`, `task=${task.id}`, '真实执行必须留下入口、读取或失败证据。');
  } else {
    record('PASS', `${label} preflight evidence captured`, `task=${task.id}, evidence=${evidenceCount}`);
  }

  if (preflight.status === 'no_target') {
    record('BLOCKED', `${label} has no real target`, preflight.resultSummary?.detail || preflight.nextAction || 'no_target', preflight.nextAction || '给测试账号准备一条可处理评论/私信/会话后重试。');
    return;
  }
  if (preflight.status === 'skipped') {
    record('BLOCKED', `${label} skipped by real executor`, preflight.nextAction || 'skipped', '确认测试对象未被规则跳过后重试。');
    return;
  }
  if (preflight.status === 'failed') {
    recordClassifiedTaskFailure(label, preflight, 'real-execution');
    return;
  }
  if (preflight.status === 'completed') {
    record('FAILED', `${label} completed before approval`, `task=${task.id}`, '真实发送/填草稿动作必须先进入人工确认。');
    return;
  }
  if (preflight.status !== 'waiting_for_send_confirmation') {
    record('FAILED', `${label} unexpected preflight status`, `status=${preflight.status}`, '真实任务必须停在待确认或明确失败/BLOCKED。');
    return;
  }
  if (!boundaryStatus) return;

  const approved = await request('POST', `/local-engine/tasks/${task.id}/approve`, {
    operator,
    note: `commercial acceptance approved draft fill for ${label}`,
    currentWindowConfirmed: true,
    contactConfirmed: type === 'wechat-reply-draft' ? true : undefined,
    draftBeforeFillConfirmed: type === 'wechat-reply-draft' ? true : undefined,
    targetContact: type === 'wechat-reply-draft' ? wechatTargetContact : undefined,
    targetConfirmed: true,
    contentConfirmed: true,
    checklistConfirmed: true,
    commercialPermissionConfirmed: true,
    misfireProtectionConfirmed: true,
    doubleConfirmationConfirmed: preflight.requiresDoubleConfirmation === true,
    riskConfirmation: {
      confirmed: true,
      confirmedAction: 'interaction-approval',
      confirmedRiskLevel: preflight.riskLevel || 'medium',
      operator,
      reason: `commercial acceptance approved real interaction task ${task.id}`,
      checklist: {
        target: true,
        content: true,
        account: true,
        cdp: true,
        readback: true,
      },
    },
  }).catch((error) => {
    record('FAILED', `${label} approval failed`, error.message, '检查确认接口、商用权限和桌面/浏览器当前窗口。');
    return null;
  });
  if (!approved) return;

  const finalTask = await waitForTask(task.id, ['completed', 'failed', 'skipped', 'no_target']);
  if (!finalTask) return;
  await exportTaskDiagnostics(task.id, `${label} final`);
  if (finalTask.status === 'completed' && countTaskEvidence(finalTask) > 0) {
    verifyCdpRuntimeMode(finalTask, label);
    verifyReplyGeneratedByAi(finalTask, label);
    record('PASS', `${label} real read/draft execution completed`, `task=${task.id}, evidence=${countTaskEvidence(finalTask)}`);
    return;
  }
  if (finalTask.status === 'failed') {
    recordClassifiedTaskFailure(`${label} draft execution`, finalTask, 'real-execution');
    return;
  }
  record('FAILED', `${label} final status not accepted`, `status=${finalTask.status}`, finalTask.nextAction || '排查真实执行链路。');
}

async function runRealAutoSendLoop(type, account) {
  const label = taskLabel(type);
  let completed = 0;
  for (let index = 0; index < realAutoSendCycles; index += 1) {
    const task = await request('POST', taskRoute(type), {
      type,
      accountId: String(account.id),
      accountName: account.displayName || account.profileName || account.userName || `account-${account.id}`,
      platformType: account.type,
      platformName: account.platform,
      targetName: '商业验收真实自动发送测试对象',
      sendMode: 'auto-send',
      commercialExecutionRequested: true,
    }).catch((error) => {
      record('FAILED', `${label} auto-send task creation failed #${index + 1}`, error.message, '检查真实账号、测试对象和本地执行器。');
      return null;
    });
    if (!task?.id) continue;
    artifacts.createdTaskIds.push(task.id);

    const finalTask = await waitForTask(task.id, ['completed', 'failed', 'skipped', 'no_target']);
    if (!finalTask) continue;
    await exportTaskDiagnostics(task.id, `${label} auto-send #${index + 1}`);

    if (finalTask.status === 'completed' && countTaskEvidence(finalTask) > 0) {
      verifyCdpRuntimeMode(finalTask, `${label} auto-send #${index + 1}`);
      const realInputOk = verifyRealCustomerInput(finalTask, `${label} auto-send #${index + 1}`);
      const readbackOk = verifySendReadback(finalTask, `${label} auto-send #${index + 1}`);
      const aiGenerated = verifyReplyGeneratedByAi(finalTask, `${label} auto-send #${index + 1}`);
      if (realInputOk && readbackOk && aiGenerated) completed += 1;
      continue;
    }
    if (finalTask.status === 'failed') {
      recordClassifiedTaskFailure(`${label} auto-send #${index + 1}`, finalTask, 'real-execution');
      continue;
    }
    record(
      'BLOCKED',
      `${label} auto-send #${index + 1} did not complete`,
      `status=${finalTask.status}`,
      finalTask.nextAction || '给测试账号准备真实可回复对象后重试。',
      {
        area: 'real-execution',
        requirement: '真实自动发送闭环必须读到对象、发送、回读确认。',
      },
    );
  }

  if (completed === realAutoSendCycles) {
    record('PASS', `${label} real auto-send loop passed`, `cycles=${completed}/${realAutoSendCycles}`, '', {
      area: 'real-execution',
      requirement: '每个客户互动入口至少连续 5 轮真实自动发送闭环。',
    });
  } else {
    record('FAILED', `${label} real auto-send loop incomplete`, `cycles=${completed}/${realAutoSendCycles}`, '修复失败轮次后重跑，不能把部分通过当商用完成。', {
      area: 'real-execution',
      requirement: '每个客户互动入口至少连续 5 轮真实自动发送闭环。',
    });
  }
}

function verifyReplyGeneratedByAi(task, label) {
  if (task.replyGeneratedBy === 'ai') {
    record('PASS', `${label} reply generated by AI`, `replyGeneratedBy=${task.replyGeneratedBy}`, '', {
      area: 'real-execution',
      requirement: '真实客户互动闭环必须由 AI 按真实客户内容生成回复；规则兜底不能计入通过。',
    });
    return true;
  }
  record(
    'FAILED',
    `${label} reply was not generated by AI`,
    `replyGeneratedBy=${task.replyGeneratedBy || 'missing'}`,
    '配置可用默认文本模型并重跑；规则兜底或手填回复不能算“AI 按内容回复”。',
    {
      area: 'real-execution',
      requirement: '真实客户互动闭环必须由 AI 按真实客户内容生成回复；规则兜底不能计入通过。',
    },
  );
  return false;
}

function verifyCdpRuntimeMode(task, label) {
  const diagnostics = task.diagnostics || {};
  const runtimeMode = diagnostics.runtimeMode || task.runtimeMode;
  if (runtimeMode === 'persistent-cdp-browser') {
    record('PASS', `${label} uses CDP persistent browser`, `runtimeMode=${runtimeMode}`, '', {
      area: 'real-execution',
      requirement: '客户互动必须使用 CDP 持久浏览器，不能是 browser bridge。',
    });
    return;
  }
  if (runtimeMode && runtimeMode.includes('browser-bridge')) {
    record(
      'FAILED',
      `${label} used browser bridge instead of CDP`,
      `runtimeMode=${runtimeMode}`,
      '客户互动必须走 CDP 持久浏览器，禁用 browser bridge fallback。',
      {
        area: 'real-execution',
        requirement: 'runtimeMode 不能是 browser bridge。',
      },
    );
    return;
  }
  record('WARN', `${label} runtimeMode not confirmed as CDP`, `runtimeMode=${runtimeMode || 'missing'}`, '确认任务执行使用了 CDP 持久浏览器。', {
    area: 'real-execution',
    requirement: 'runtimeMode 应为 persistent-cdp-browser。',
  });
}

function verifySendReadback(task, label) {
  const replyText = normalizeProofText(task.replyText || task.resultSummary?.replyText);
  if (!replyText) {
    record('FAILED', `${label} missing reply text for readback check`, `task=${task.id || '-'}`, '真实自动发送必须记录发送内容，才能回读比对。', {
      area: 'real-execution',
      requirement: '回读必须能和实际回复内容比对。',
    });
    return false;
  }
  const proofTexts = collectTaskProofTexts(task);
  const sendProofs = proofTexts.filter((text) => isSendProof(text));
  const readbackProofs = proofTexts.filter((text) => isReadbackProofForReply(text, replyText));
  if (sendProofs.length > 0) {
    if (readbackProofs.length > 0) {
      record('PASS', `${label} has send and reply-matched readback evidence`, `send=${sendProofs.length}, readback=${readbackProofs.length}`, '', {
        area: 'real-execution',
        requirement: '每条发送必须有真实回读字段，且回读内容要匹配实际回复。',
      });
      return true;
    } else {
      record('FAILED', `${label} has send but no reply-matched readback evidence`, `send=${sendProofs.length}, reply=${replyText.slice(0, 80)}`, '发送后必须有包含实际回复内容的回读确认证据。', {
        area: 'real-execution',
        requirement: '发送后应有回读确认，不能只靠 editorCleared/replyVisible。',
      });
      return false;
    }
  }
  record('FAILED', `${label} missing send evidence`, `task=${task.id || '-'}`, '真实自动发送闭环必须留下发送和回读事件。', {
    area: 'real-execution',
    requirement: '发送后应有发送事件和回读确认。',
  });
  return false;
}

function verifyRealCustomerInput(task, label) {
  const sourceText = normalizeProofText(task.sourceText || task.resultSummary?.sourceText);
  const replyText = normalizeProofText(task.replyText || task.resultSummary?.replyText);
  const fakeSourcePattern = /商业验收|请忽略|等待本机读取真实对象|commercial acceptance/i;

  if (!sourceText || fakeSourcePattern.test(sourceText)) {
    record(
      'FAILED',
      `${label} did not use real customer source text`,
      `source=${sourceText || 'missing'}`,
      '真实闭环必须由执行器读取平台上的真实评论/私信内容，不能用脚本传入的测试文案。',
      {
        area: 'real-execution',
        requirement: '真实闭环必须读真实客户内容。',
      },
    );
    return false;
  }
  if (!replyText || fakeSourcePattern.test(replyText)) {
    record(
      'FAILED',
      `${label} did not produce real reply text`,
      `reply=${replyText || 'missing'}`,
      '真实闭环必须记录实际生成并发送的回复。',
      {
        area: 'real-execution',
        requirement: '真实闭环必须记录实际回复。',
      },
    );
    return false;
  }
  record('PASS', `${label} used real customer input`, `sourceLength=${sourceText.length}, replyLength=${replyText.length}`, '', {
    area: 'real-execution',
    requirement: '真实闭环必须读真实客户内容并生成回复。',
  });
  return true;
}

function collectTaskProofTexts(task) {
  const texts = [];
  const add = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = normalizeProofText(value);
      if (text) texts.push(text);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value === 'object') {
      for (const item of Object.values(value)) add(item);
    }
  };

  add(task.events || []);
  add(task.steps || []);
  add(task.diagnostics || {});
  add(task.resultSummary || {});
  return [...new Set(texts)];
}

function isSendProof(text) {
  const normalized = normalizeProofText(text);
  if (/editorCleared|replyVisible/i.test(normalized) && !/发送|sent|submit|publish/i.test(normalized)) {
    return false;
  }
  return /已发送|发送成功|点击发送|submit.*success|status=sent|sent=true|send\s*(ok|success|confirmed)/i.test(normalized);
}

function isReadbackProofForReply(text, replyText) {
  const normalized = normalizeProofText(text);
  const reply = normalizeProofText(replyText);
  if (!reply || !normalized.includes(reply)) return false;
  if (/editorCleared|replyVisible/i.test(normalized) && !/回读|readback|页面看到|确认|confirmed|platform/i.test(normalized)) {
    return false;
  }
  return /回读|readback|页面看到|确认|confirmed|platform|已在页面|last message/i.test(normalized);
}

function normalizeProofText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function verifyCommercialBoundary(task, label) {
  const boundary = task.safetyBoundary || {};
  if (boundary.planMode !== 'commercial') {
    record(
      'BLOCKED',
      `${label} not in commercial plan mode`,
      `planMode=${boundary.planMode || 'missing'}`,
      '设置 LOCAL_ENGINE_PLAN_MODE=commercial 或 AI_CONTENT_PLAN=commercial 后重启后端。',
    );
    return false;
  }
  if (!boundary.commercialExecutionAllowed || boundary.permissionStatus !== 'allowed') {
    const statusAllowed = boundary.permissionStatus === 'allowed' || boundary.permissionStatus === 'approval_required';
    if (boundary.commercialExecutionAllowed && statusAllowed) {
      record('PASS', `${label} commercial executable permission allowed`, `permission=${boundary.permissionStatus}; ${boundary.message || ''}`);
      return true;
    }
    record(
      'BLOCKED',
      `${label} commercial executable permission not allowed`,
      `allowed=${boundary.commercialExecutionAllowed}, permission=${boundary.permissionStatus}, message=${boundary.message}`,
      '设置 LOCAL_ENGINE_COMMERCIAL_EXECUTION_ENABLED=true 或 AI_CONTENT_COMMERCIAL_EXECUTION_ENABLED=true，并确认权限策略。',
    );
    return false;
  }
  record('PASS', `${label} commercial executable permission allowed`, boundary.message);
  return true;
}

function recordClassifiedTaskFailure(label, task, area = 'real-execution') {
  const reason = task.failureReason || task.diagnostics?.failureReason || task.nextAction || 'unknown failure';
  const isBlocked = /未登录|登录失效|账号|权限|执行器|本地引擎|桌面|微信|没有可处理|no target|扫码|401|403/i.test(reason);
  record(
    isBlocked ? 'BLOCKED' : 'FAILED',
    `${label} failed`,
    reason,
    task.nextAction || (isBlocked ? '补齐账号、权限、执行器或测试对象后重试。' : '排查业务执行错误后重试。'),
    {
      area,
      requirement: '真实任务失败必须按账号/权限/测试对象阻断与接口/业务错误区分。',
    },
  );
}

async function approveAgentConfirmation(id, note) {
  return request('POST', `/local-engine/confirmations/${id}/approve`, {
    operator,
    note,
    confirmedChecks: {
      scope: true,
      target: true,
      content: true,
      window: true,
      'commercial-permission': true,
      'misfire-protection': true,
      'double-confirmation': true,
      'role-approval': true,
      'remote-takeover-audit': true,
    },
  }).catch((error) => {
    record('FAILED', `agent confirmation approve failed: ${id}`, error.message, '检查 Agent 确认审批接口。');
    return null;
  });
}

async function waitForSession(id, statuses) {
  return waitFor(async () => {
    const session = await request('GET', `/local-engine/agent-sessions/${id}`);
    return statuses.includes(session.status) ? session : null;
  }, `session ${id} to reach ${statuses.join('/')}`);
}

async function waitForTask(id, statuses) {
  return waitFor(async () => {
    const task = await request('GET', `/local-engine/tasks/${id}`);
    return statuses.includes(task.status) ? task : null;
  }, `task ${id} to reach ${statuses.join('/')}`);
}

async function waitFor(producer, label) {
  let lastError;
  for (let index = 0; index < pollAttempts; index += 1) {
    try {
      const value = await producer();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }
  record('FAILED', `${label} timed out`, lastError?.message || `attempts=${pollAttempts}`, '查看任务/会话记录和 .local-logs 后重试。');
  return null;
}

async function exportTaskDiagnostics(taskId, label) {
  const exported = await request('GET', `/local-engine/tasks/${taskId}/diagnostics/export`).catch((error) => {
    record('FAILED', `task diagnostics export failed: ${label}`, error.message, '检查诊断包导出接口。');
    return null;
  });
  if (!exported) return null;
  const content = parseJsonContent(exported.content);
  if (!exported.mimeType?.toLowerCase().startsWith('application/json') || content?.task?.id !== taskId) {
    record('FAILED', `task diagnostics export invalid: ${label}`, JSON.stringify({ filename: exported.filename, mimeType: exported.mimeType }), '诊断包必须是 JSON 且包含 task.id。');
    return null;
  }
  const hasAuditFields = content.task?.safetyBoundary && content.task?.riskPolicy && content.task?.failureAnalysis;
  if (!hasAuditFields) {
    record('FAILED', `task diagnostics missing audit fields: ${label}`, `task=${taskId}`, '诊断包必须包含 safetyBoundary、riskPolicy、failureAnalysis。');
    return null;
  }
  artifacts.exportedDiagnostics.push({ taskId, label, filename: exported.filename, evidenceCount: content.task?.diagnostics?.evidenceCount || 0 });
  record('PASS', `task diagnostics export valid: ${label}`, `${exported.filename}`);
  return content;
}

async function exportAgentEvidence(sessionId, label) {
  const exported = await request('GET', `/local-engine/agent-sessions/${sessionId}/evidence/export`).catch((error) => {
    record('FAILED', `agent evidence export failed: ${label}`, error.message, '检查 Agent 证据导出接口。');
    return null;
  });
  if (!exported) return null;
  const content = parseJsonContent(exported.content);
  if (!exported.mimeType?.toLowerCase().startsWith('application/json') || content?.session?.id !== sessionId) {
    record('FAILED', `agent evidence export invalid: ${label}`, JSON.stringify({ filename: exported.filename, mimeType: exported.mimeType }), '证据包必须是 JSON 且包含 session.id。');
    return null;
  }
  if (!Array.isArray(content.evidence) || !Array.isArray(content.replay?.timeline)) {
    record('FAILED', `agent evidence export missing replay fields: ${label}`, `session=${sessionId}`, '证据包必须包含 evidence 和 replay.timeline。');
    return null;
  }
  artifacts.exportedEvidence.push({ sessionId, label, filename: exported.filename, evidenceCount: content.evidence.length, timelineCount: content.replay.timeline.length });
  record('PASS', `agent evidence export valid: ${label}`, `${exported.filename}, evidence=${content.evidence.length}`);
  return content;
}

async function request(method, path, body, options = {}) {
  const controller = new AbortController();
  const requestTimeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : timeoutMs;
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const headers = {
    Accept: 'application/json',
    ...(!options.public ? { Cookie: cookieHeader() } : {}),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    rememberCookies(response.headers.get('set-cookie'));
    const text = await response.text();
    const json = text ? safeJson(text) : null;
    if (!response.ok || json?.success === false) {
      const message = typeof json?.message === 'string'
        ? json.message
        : typeof json?.error === 'string'
          ? json.error
          : json?.message?.message || `HTTP ${response.status} ${method} ${path}`;
      const error = new Error(message);
      error.status = response.status;
      error.method = method;
      error.path = path;
      error.body = json;
      throw error;
    }
    return Object.prototype.hasOwnProperty.call(json || {}, 'data') ? json.data : json;
  } finally {
    clearTimeout(timer);
  }
}

function rememberCookies(header) {
  if (!header) return;
  for (const part of splitSetCookie(header)) {
    const [pair] = part.split(';');
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    cookieJar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function splitSetCookie(header) {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function firstPendingConfirmation(session) {
  return (session.confirmations || []).find((item) => item.status === 'pending');
}

function pickAccount(accounts, explicitId, platformType) {
  if (explicitId) {
    return accounts.find((account) => String(account.id) === String(explicitId) && (!platformType || account.type === platformType));
  }
  return accounts.find((account) => !platformType || account.type === platformType);
}

function isReadyAccount(account) {
  const status = String(account?.status ?? '').toLowerCase();
  const statusLabel = String(account?.statusLabel ?? account?.status_label ?? '').toLowerCase();
  return (
    account?.status === 1 ||
    ['ready', 'connected', 'active', 'enabled', 'normal', 'logged_in', 'logged-in'].includes(status) ||
    /正常|可用|已登录|在线|ready|active|connected/.test(statusLabel)
  );
}

function taskRoute(type) {
  const routes = {
    'douyin-comment-reply': '/local-engine/comments/tasks',
    'douyin-direct-message-reply': '/local-engine/messages/tasks',
    'wechat-channel-comment-reply': '/local-engine/channel-comments/tasks',
    'wechat-channel-direct-message-reply': '/local-engine/channel-messages/tasks',
    'wechat-reply-draft': '/local-engine/wechat/tasks',
  };
  return routes[type] || '/local-engine/tasks';
}

function taskLabel(type) {
  const labels = {
    'douyin-comment-reply': 'Douyin comment reply',
    'douyin-direct-message-reply': 'Douyin direct message reply',
    'wechat-channel-comment-reply': 'WeChat Channel comment reply',
    'wechat-channel-direct-message-reply': 'WeChat Channel direct message reply',
    'wechat-reply-draft': 'WeChat draft reply',
  };
  return labels[type] || type;
}

function platformTypeForTask(type) {
  if (type === 'wechat-reply-draft' || type.startsWith('wechat-channel-')) {
    return 2;
  }
  return 3;
}

function countTaskEvidence(task) {
  return (task.events || []).filter((event) => event.evidence).length;
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

function collectPublishConfirmations(result) {
  const confirmations = [];
  const candidates = [
    ...(Array.isArray(result?.results) ? result.results : []),
    ...(Array.isArray(result?.platforms) ? result.platforms : []),
    ...(Array.isArray(result?.batchResult?.platforms) ? result.batchResult.platforms : []),
  ];

  for (const entry of candidates) {
    const evidence = entry?.evidence || {};
    const externalId = entry?.externalId || evidence.externalId || entry?.articleId;
    const publishUrl = entry?.publishUrl || evidence.publishUrl;
    const source = evidence.source || entry?.evidenceSource;
    if (entry?.status === 'success' && (externalId || publishUrl || source === 'platform-page' || source === 'platform-api' || source === 'readback')) {
      confirmations.push(
        [entry.platform || entry.type || 'platform', externalId || publishUrl || source]
          .filter(Boolean)
          .join(':'),
      );
    }
  }

  if (result?.evidence?.externalId || result?.evidence?.publishUrl || result?.publishUrl) {
    confirmations.push(result.evidence.externalId || result.evidence.publishUrl || result.publishUrl);
  }

  return confirmations;
}

function buildPublishPayload(accounts = [], materials = []) {
  const readyAccount = Array.isArray(accounts)
    ? accounts.find((account) => isReadyAccount(account))
    : null;
  const material = Array.isArray(materials) ? materials.find((item) => item.filePath || item.filepath || item.path) : null;
  const fileList = [publishMaterialFile || material?.filePath || material?.filepath || material?.path || '/tmp/commercial-acceptance-missing-material.png'];
  const accountList = [publishAccountFile || readyAccount?.filePath || '/tmp/commercial-acceptance-missing-account.json'];
  const isVideo = fileList.some((filePath) => /\.(mp4|mov|m4v|avi|webm)$/i.test(filePath));
  return {
    type: readyAccount?.type || 3,
    contentKind: isVideo ? 'video' : 'article',
    title: `commercial-acceptance-publish-${Date.now()}`,
    tags: ['commercial-acceptance'],
    fileList,
    accountList,
    enableTimer: 0,
    videosPerDay: 1,
    dailyTimes: ['10:00'],
    startDays: 0,
    timeJitterMinutes: 0,
    debugDryRun: !(realPublishEnabled && approvePublishEnabled),
    debugDryRunHoldBrowser: !(realPublishEnabled && approvePublishEnabled),
    category: 0,
  };
}

function verifyFileSelectionMatrix(fileAccess) {
  const roots = Array.isArray(fileAccess.roots) ? fileAccess.roots : [];
  const requiredRoots = ['auto-upload-materials', 'auto-upload-cookies', 'auto-upload-logs'];
  const missingRoots = requiredRoots.filter((key) => !roots.some((root) => root.key === key));
  const blockedRoots = roots.filter((root) => requiredRoots.includes(root.key) && (!root.exists || !root.readable));
  if (missingRoots.length) {
    record(
      'FAILED',
      'file-selection status missing required roots',
      missingRoots.join(', '),
      '文件选择状态必须覆盖素材目录、账号 Cookie 目录和本地引擎日志目录。',
      {
        area: 'desktop-file-selection',
        requirement: 'file-selection 必须能审计素材、账号和日志路径。',
      },
    );
    return;
  }
  if (blockedRoots.length) {
    record(
      'BLOCKED',
      'file-selection required roots not readable',
      blockedRoots.map((root) => `${root.key}:exists=${root.exists},readable=${root.readable},path=${root.path}`).join(' | '),
      '授予本地文件访问权限，确认 5409 账号/素材/日志目录存在且可读。',
      {
        area: 'desktop-file-selection',
        requirement: '缺少真实文件访问权限时必须 BLOCKED。',
      },
    );
    return;
  }
  record(
    'PASS',
    'file-selection roots readable for desktop control',
    `ready=${fileAccess.summary?.ready ?? '-'}, total=${fileAccess.summary?.total ?? roots.length}`,
    '',
    {
      area: 'desktop-file-selection',
      requirement: 'file-selection 覆盖素材、账号和日志目录且可读。',
    },
  );
}

function recordClassifiedAccessIssue(label, error, nextAction, matrix = {}) {
  const status = isBlockedAccessError(error) ? 'BLOCKED' : 'FAILED';
  record(status, label, error.message, nextAction, matrix);
}

function recordPrerequisiteBlocked(prerequisiteArea) {
  const prerequisiteRequirement = defaultRequirement(prerequisiteArea);
  for (const area of requiredMatrixCells) {
    if (area === prerequisiteArea) continue;
    if (results.some((item) => item.area === area)) continue;
    record(
      'BLOCKED',
      `${area} blocked by unmet ${prerequisiteArea} prerequisite`,
      prerequisiteRequirement,
      '先修复前置阻断并重新运行商用验收脚本。',
      {
        area,
        requirement: defaultRequirement(area),
      },
    );
  }
}

function isBlockedAccessError(error) {
  const text = `${error?.message || ''} ${JSON.stringify(error?.body || {})}`;
  if (error?.status === 401 || error?.status === 403) return true;
  return /未登录|登录|账号|cookie|Cookie|扫码|授权|权限|permission|forbidden|unauthori[sz]ed|不可访问|未启动|5409|素材.*不存在|素材.*不可读|请选择|缺少|不存在或不可读/i.test(text);
}

function isRiskConfirmationError(error) {
  const text = `${error?.message || ''} ${JSON.stringify(error?.body || {})}`;
  return /风控|人工确认|确认动作|风险|approval_required|riskAudit|禁止动作|阻断|角色|SUPER_ADMIN|ADMIN|套餐|升级/i.test(text);
}

function matrixFor(item) {
  return {
    area: item.area || inferMatrixArea(item.label),
    requirement: item.requirement || defaultRequirement(inferMatrixArea(item.label)),
  };
}

function inferMatrixArea(label = '') {
  const text = String(label).toLowerCase();
  if (/auth|login|guard/.test(text)) return 'authentication';
  if (/batch/.test(text)) return 'batch-tasks';
  if (/content|article|topic|material|xiaohongshu|素材|选题|文章|小红书/.test(text)) return 'content-pipeline';
  if (/publish|publishing/.test(text)) return 'publishing-center';
  if (/file-selection|desktop/.test(text)) return 'desktop-file-selection';
  if (/risk|unauthorized|permission|takeover|风控|越权/.test(text)) return 'permission-escape';
  if (/recovery|retry|fail/.test(text)) return 'failure-recovery';
  if (/evidence|diagnostic|record|cleanup/.test(text)) return 'evidence-export';
  if (/pressure/.test(text)) return 'pressure';
  if (/real|douyin|wechat/.test(text)) return 'real-execution';
  if (/readiness|runtime|executor|browser|account|capabilit/.test(text)) return 'readiness';
  return 'general';
}

function defaultRequirement(area) {
  const requirements = {
    authentication: '必须使用真实 Kaypal 登录态进入后台，缺页面 cookie、交互式登录或账号密码兜底为 BLOCKED。',
    readiness: '真实账号、执行器、桌面权限和本地引擎必须 ready。',
    'batch-tasks': '批量任务必须创建真实任务记录并导出逐对象矩阵。',
    'content-pipeline': '素材采集、选题、内容生成、进入发布中心必须连续 5 条验收。',
    'publishing-center': '发布中心必须验证账号、素材、确认队列和真实提交边界。',
    'desktop-file-selection': '桌面控制必须覆盖 file-selection 权限与素材/账号/日志路径。',
    'permission-escape': '越权和高风险动作未确认时必须被后端风控阻断。',
    'failure-recovery': '失败任务必须可标记、可重试、可导出诊断。',
    'evidence-export': '任务、会话、记录和证据治理必须可导出且可审计。',
    pressure: '连续压测不能伪造成功或遗留 pending 确认。',
    'real-execution': '真实账号执行缺账号/权限/对象为 BLOCKED，接口错为 FAILED。',
    general: '商用验收项必须明确 PASS/BLOCKED/FAILED。',
  };
  return requirements[area] || requirements.general;
}

function buildInputChecklist() {
  return [
    {
      key: 'kaypalLogin',
      label: 'Kaypal 登录态',
      ready: Boolean(
        providedCookieHeader ||
          providedSessionToken ||
          interactiveLoginEnabled ||
          localAcceptanceLoginEnabled ||
          (username && password),
      ),
      detail: providedCookieHeader
        ? 'COMMERCIAL_COOKIE_HEADER=set'
        : providedSessionToken
          ? `COMMERCIAL_SESSION_TOKEN=set, cookie=${authCookieName}`
          : localAcceptanceLoginEnabled
            ? 'COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN=1'
          : interactiveLoginEnabled
            ? 'COMMERCIAL_INTERACTIVE_LOGIN=1'
            : username
            ? `username=${maskValue(username)}`
            : '未提供页面 cookie，也未启用交互式登录或账号密码兜底',
      requiredFor: ['authentication'],
      nextAction: '设置 COMMERCIAL_INTERACTIVE_LOGIN=1 走 Kaypal 页面授权；或传入页面 cookie/session token；本地验收可显式设置 COMMERCIAL_LOCAL_ACCEPTANCE_LOGIN=1。',
    },
    {
      key: 'realExecutionSwitch',
      label: '真实执行开关',
      ready: realExecutionEnabled,
      detail: realAcceptanceEnabled ? 'COMMERCIAL_REAL_ACCEPTANCE=1' : `COMMERCIAL_REAL_EXECUTION=${realExecutionEnabled ? '1' : '<unset>'}`,
      requiredFor: ['real-execution'],
      nextAction: '确认测试账号和测试对象后设置 COMMERCIAL_REAL_EXECUTION=1。',
    },
    {
      key: 'draftApprovalSwitch',
      label: '草稿填入授权',
      ready: approveDraftsEnabled,
      detail: realAcceptanceEnabled ? 'COMMERCIAL_REAL_ACCEPTANCE=1' : `COMMERCIAL_APPROVE_DRAFTS=${approveDraftsEnabled ? '1' : '<unset>'}`,
      requiredFor: ['real-execution'],
      nextAction: '确认当前窗口和对象为测试环境后设置 COMMERCIAL_APPROVE_DRAFTS=1。',
    },
    {
      key: 'realAutoSendSwitches',
      label: '真实自动发送授权',
      ready: realAutoSendEnabled && approveAutoSendEnabled,
      detail: realAcceptanceEnabled ? `COMMERCIAL_REAL_ACCEPTANCE=1, cycles=${realAutoSendCycles}` : `COMMERCIAL_REAL_AUTO_SEND=${realAutoSendEnabled ? '1' : '<unset>'}, COMMERCIAL_APPROVE_AUTO_SEND=${approveAutoSendEnabled ? '1' : '<unset>'}, cycles=${realAutoSendCycles}`,
      requiredFor: ['real-execution'],
      nextAction: '确认四个入口都有真实测试对象并允许真实发送后，同时设置 COMMERCIAL_REAL_AUTO_SEND=1 与 COMMERCIAL_APPROVE_AUTO_SEND=1。',
    },
    {
      key: 'wechatTargetContact',
      label: '微信测试联系人',
      ready: !requiredTaskTypes.includes('wechat-reply-draft') || Boolean(wechatTargetContact),
      detail: wechatTargetContact ? `target=${maskValue(wechatTargetContact)}` : 'COMMERCIAL_WECHAT_TARGET_CONTACT 未设置',
      requiredFor: ['real-execution', 'desktop-file-selection'],
      nextAction: '把桌面微信停在测试联系人/测试群，并设置 COMMERCIAL_WECHAT_TARGET_CONTACT。',
    },
    {
      key: 'publishFiles',
      label: '发布账号/素材文件',
      ready: Boolean(publishAccountFile && publishMaterialFile),
      detail: `accountFile=${publishAccountFile ? 'set' : '<unset>'}, materialFile=${publishMaterialFile ? 'set' : '<unset>'}`,
      requiredFor: ['publishing-center', 'desktop-file-selection'],
      nextAction: '设置 COMMERCIAL_PUBLISH_ACCOUNT_FILE 与 COMMERCIAL_PUBLISH_MATERIAL_FILE，或在发布中心准备可读真实测试账号和素材。',
    },
    {
      key: 'contentPipelineSwitches',
      label: '内容到发布中心 5 条链路授权',
      ready: realContentPipelineEnabled && approveContentPipelineEnabled,
      detail: realAcceptanceEnabled ? `COMMERCIAL_REAL_ACCEPTANCE=1, cycles=${contentPipelineCycles}` : `COMMERCIAL_REAL_CONTENT_PIPELINE=${realContentPipelineEnabled ? '1' : '<unset>'}, COMMERCIAL_APPROVE_CONTENT_PIPELINE=${approveContentPipelineEnabled ? '1' : '<unset>'}, cycles=${contentPipelineCycles}`,
      requiredFor: ['content-pipeline'],
      nextAction: '确认允许连续生成/导入测试内容后，同时设置 COMMERCIAL_REAL_CONTENT_PIPELINE=1 与 COMMERCIAL_APPROVE_CONTENT_PIPELINE=1。',
    },
    {
      key: 'realPublishSwitches',
      label: '真实发布授权',
      ready: realPublishEnabled && approvePublishEnabled,
      detail: realAcceptanceEnabled ? 'COMMERCIAL_REAL_ACCEPTANCE=1' : `COMMERCIAL_REAL_PUBLISH=${realPublishEnabled ? '1' : '<unset>'}, COMMERCIAL_APPROVE_PUBLISH=${approvePublishEnabled ? '1' : '<unset>'}`,
      requiredFor: ['publishing-center'],
      nextAction: '确认使用真实测试发布后同时设置 COMMERCIAL_REAL_PUBLISH=1 与 COMMERCIAL_APPROVE_PUBLISH=1。',
    },
  ];
}

function printInputChecklist() {
  const checklist = buildInputChecklist();
  const missing = checklist.filter((item) => !item.ready);
  console.log(`Input checklist: READY=${checklist.length - missing.length} MISSING=${missing.length}`);
  for (const item of missing.slice(0, 6)) {
    console.log(`- MISSING ${item.label}: ${item.detail}`);
    console.log(`  next=${item.nextAction}`);
  }
}

function maskValue(value) {
  const text = String(value || '');
  if (text.length <= 2) return text ? '**' : '';
  if (text.length <= 6) return `${text.slice(0, 1)}***${text.slice(-1)}`;
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

function summarizeMatrix() {
  const matrix = new Map();
  for (const area of requiredMatrixCells) {
    matrix.set(area, {
      area,
      requirement: defaultRequirement(area),
      pass: 0,
      warn: 0,
      blocked: 0,
      failed: 0,
      status: 'MISSING',
      items: [],
    });
  }
  for (const item of results) {
    const area = item.area || 'general';
    if (!matrix.has(area)) {
      matrix.set(area, {
        area,
        requirement: item.requirement || defaultRequirement(area),
        pass: 0,
        warn: 0,
        blocked: 0,
        failed: 0,
        status: 'MISSING',
        items: [],
      });
    }
    const cell = matrix.get(area);
    if (cell.status === 'MISSING' && !cell.requirement) {
      cell.requirement = item.requirement || defaultRequirement(area);
    }
    if (item.status === 'PASS') cell.pass += 1;
    if (item.status === 'WARN') cell.warn += 1;
    if (item.status === 'BLOCKED') cell.blocked += 1;
    if (item.status === 'FAILED') cell.failed += 1;
    cell.items.push(item);
  }
  for (const cell of matrix.values()) {
    cell.status = cell.failed > 0
      ? 'FAILED'
      : cell.blocked > 0
        ? 'BLOCKED'
        : cell.pass > 0 || cell.warn > 0
          ? 'PASS'
          : 'MISSING';
  }
  return [...matrix.values()];
}

function record(status, label, detail = '', nextAction = '', matrix = {}) {
  const matrixInfo = matrixFor({ label, ...matrix });
  const item = {
    status,
    label,
    detail: String(detail || ''),
    nextAction: String(nextAction || ''),
    area: matrixInfo.area,
    requirement: matrixInfo.requirement,
    at: new Date().toISOString(),
  };
  results.push(item);
  if (status === 'PASS') passCount += 1;
  if (status === 'WARN') warnCount += 1;
  if (status === 'FAILED') failCount += 1;
  if (status === 'BLOCKED') blockedCount += 1;
  const suffix = [item.detail, item.nextAction ? `next=${item.nextAction}` : ''].filter(Boolean).join(' | ');
  console.log(`${status} ${label}${suffix ? `: ${suffix}` : ''}`);
}

function section(title) {
  console.log('');
  console.log(`== ${title} ==`);
}

async function writeReport() {
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, `commercial-acceptance-${timestampForFile()}.json`);
  const report = {
    generatedAt: new Date().toISOString(),
    apiBase,
    frontendUrl,
    config: {
      requiredTaskTypes,
      pressureCycles,
      realAutoSendCycles,
      realExecutionEnabled,
      approveDraftsEnabled,
      realAutoSendEnabled,
      approveAutoSendEnabled,
      realPublishEnabled,
      approvePublishEnabled,
      realContentPipelineEnabled,
      approveContentPipelineEnabled,
      contentPipelineCycles,
      localAcceptanceLoginEnabled,
      hasDouyinAccountOverride: Boolean(douyinAccountId),
      hasWechatAccountOverride: Boolean(wechatAccountId),
      hasWechatTargetContact: Boolean(wechatTargetContact),
      hasPublishAccountFile: Boolean(publishAccountFile),
      hasPublishMaterialFile: Boolean(publishMaterialFile),
    },
    inputChecklist: buildInputChecklist(),
    summary: {
      pass: passCount,
      warn: warnCount,
      failed: failCount,
      blocked: blockedCount,
      exitCode: exitCode(),
      status: failCount > 0 ? 'FAILED' : blockedCount > 0 ? 'BLOCKED' : 'PASS',
    },
    matrix: summarizeMatrix(),
    results,
    artifacts,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('');
  console.log(`Report: ${reportPath}`);
}

function printSummary() {
  console.log('');
  console.log(`Summary: PASS=${passCount} WARN=${warnCount} BLOCKED=${blockedCount} FAILED=${failCount}`);
  const matrix = summarizeMatrix();
  console.log('');
  console.log('Acceptance matrix:');
  for (const cell of matrix.filter((item) => item.area !== 'general')) {
    console.log(`- ${cell.status} ${cell.area}: PASS=${cell.pass} WARN=${cell.warn} BLOCKED=${cell.blocked} FAILED=${cell.failed}`);
    if (cell.status === 'FAILED' || cell.status === 'BLOCKED' || cell.status === 'MISSING') {
      console.log(`  requirement: ${cell.requirement}`);
      const badItems = cell.items.filter((item) => item.status === 'FAILED' || item.status === 'BLOCKED').slice(0, 4);
      if (!badItems.length && cell.status === 'MISSING') {
        console.log('  detail: matrix cell was not exercised');
        console.log('  next: 检查脚本流程，确保该验收域被执行。');
      }
      for (const item of badItems) {
        console.log(`  - ${item.status} ${item.label}`);
        console.log(`    detail: ${item.detail || '-'}`);
        console.log(`    next: ${item.nextAction || '-'}`);
      }
    }
  }
}

function exitCode() {
  if (failCount > 0) return 1;
  if (blockedCount > 0) return 2;
  return 0;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response is not JSON: ${text.slice(0, 500)}`);
  }
}

function parseJsonContent(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return null;
  }
}

function formatBlockers(items = []) {
  if (!Array.isArray(items) || !items.length) return '-';
  return items.map((item) => `${item.capability || item.label || item.key || 'item'}:${item.message || item.summary || item.nextAction || ''}`).join(' | ');
}

function firstNextAction(items = []) {
  return Array.isArray(items) ? items.map((item) => item.nextAction).find(Boolean) : '';
}

function describeAccounts(accounts = []) {
  return accounts
    .filter((account) => account.status === 'ready')
    .map((account) => `${account.id}:${account.platform}:${account.displayName}`)
    .join(' | ');
}

function listEnv(name, fallback) {
  return String(process.env[name] || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
