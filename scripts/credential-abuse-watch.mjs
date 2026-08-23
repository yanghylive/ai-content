#!/usr/bin/env node
/**
 * 凭据盗用用量巡检（credential-abuse-watch）
 *
 * 背景：服务端凭据曾泄露进 git 历史 + 安装包（P5-2026-08-22）。大王拍板
 * "现在不换、将来再换"，本脚本是"不换期间"的兜底检测：
 *
 * 核心信号 = kaypal 网关账户余额下降速率 vs 本地记录的 AI 调用量。
 * 盗用者用泄露的 key 直连网关（不经本地后端、不落 ai_chat_logs），但消耗的
 * 是同一个 kaypal 账户的钱——所以"余额在掉、本地调用量没涨"就是盗用嫌疑。
 *
 * 用法：
 *   node scripts/credential-abuse-watch.mjs                 # 单次巡检
 *   node scripts/credential-abuse-watch.mjs --strict        # 门禁模式（告警即 exit 2）
 *   node scripts/credential-abuse-watch.mjs --billing-user-id <云端userId>  # 计费账号覆盖
 *   ALERT_WEBHOOK_URL=https://... node scripts/credential-abuse-watch.mjs   # 告警推送
 *
 * 建议挂 cron（每 6h 一次，避开 JS 注释结束符）：
 *   0 0,6,12,18 * * * cd <repo> && /usr/bin/env node scripts/credential-abuse-watch.mjs >> /tmp/credential-abuse-watch.log 2>&1
 *
 * 状态：余额快照存 scripts/.credential-watch-state.json（不入库），
 * 首次运行建立基线，第二次起开始对比。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const statePath = join(scriptDir, '.credential-watch-state.json');
const envPath = join(repoRoot, 'backend', '.env');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const billingUserIdOverride = readArg(args, '--billing-user-id');

// ---- 阈值（可被 env 覆盖）----
const BALANCE_DROP_ALERT_AMOUNT = Number(process.env.WATCH_BALANCE_ALERT_AMOUNT || 10); // 单次间隔余额下降超过该金额(元) → 盗用嫌疑
const LOCAL_SURGE_RATIO = Number(process.env.WATCH_LOCAL_SURGE_RATIO || 5); // 本地调用量超 7 日均值 N 倍 → 异常
const MIN_INTERVAL_MS = Number(process.env.WATCH_MIN_INTERVAL_MS || 2 * 3600 * 1000); // 两次快照最小间隔（防重复告警）

// ---- env 解析（只读 backend/.env，不 dotenv 依赖）----
function parseEnvFile(p) {
  const out = {};
  try {
    const text = readFileSync(p, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    /* env 缺失时跳过 */
  }
  return out;
}

function readArg(list, name) {
  const i = list.findIndex((a) => a.startsWith(name + '='));
  if (i >= 0) return list[i].slice(name.length + 1);
  const j = list.indexOf(name);
  if (j >= 0 && list[j + 1] && !list[j + 1].startsWith('--')) return list[j + 1];
  return undefined;
}

// ---- kaypal 网关余额探针（1 token 最小请求，读 billing.balanceAfter）----
async function probeGatewayBalance(env) {
  const baseUrl = (env.KAYPAL_AI_PROXY_BASE_URL || 'https://kaypal.cn/api/ai').replace(/\/+$/, '');
  const apiKey = env.KAYPAL_AI_PROXY_API_KEY;
  const model = env.KAYPAL_MODEL_SYNC_DEFAULT_MODEL || 'kaypal-fast';
  const billingUserId = billingUserIdOverride || env.KAYPAL_BILLING_USER_ID;
  if (!apiKey) {
    return { ok: false, error: '缺少 KAYPAL_AI_PROXY_API_KEY（backend/.env）' };
  }
  const headers = {
    'content-type': 'application/json',
    'x-kaypal-api-key': apiKey,
    ...(billingUserId ? { 'x-kaypal-user-id': billingUserId } : {}),
  };
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { ok: false, error: `网关请求失败: ${e instanceof Error ? e.message : String(e)}` };
  }
  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* 非 JSON */
  }
  if (!res.ok) {
    const code = data?.error?.code || data?.code || res.status;
    const msg = data?.error?.message || data?.message || raw.slice(0, 200);
    // 402/insufficient balance：网关对该计费账号返回欠费。
    // ⚠️ 2026-08-23 修正：探针账号欠费 ≠ 用户 AI 不可用——真实用户走独立计费路径
    // （实测用户 AI 对话正常返回真实回复，provider=jiuzhang-ai-content）。
    // 该 ALERT 语义 = 「探针计费账号余额不足」，需人工确认该账号是否为核心计费账号。
    if (res.status === 402 || /insufficient balance/i.test(msg)) {
      return {
        ok: true,
        gatewayDown: true,
        error: `网关对探针计费账号返回 402（Insufficient Balance）——该账号余额不足；注意真实用户计费路径独立，实测用户 AI 对话正常，需人工确认该探针账号是否为核心计费账号`,
      };
    }
    return { ok: false, error: `网关 ${res.status} ${code}: ${msg}` };
  }
  const balance =
    data?.billing?.balanceAfter ??
    data?.balanceAfter ??
    data?.usage?.balanceAfter ??
    undefined;
  return {
    ok: true,
    balance: typeof balance === 'number' ? balance : undefined,
    model,
    billingUserId: billingUserId || null,
  };
}

// ---- 本地 SQLite 用量基线（ai_chat_logs 按日计数）----
function findSqliteDb(env) {
  // 优先：backend/.env 的 SQLite_DATABASE_URL / 桌面库
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    env.SQLITE_DATABASE_URL,
    env.KAYPAL_DESKTOP_DATABASE_URL,
  ]
    .filter(Boolean)
    .map((u) => u.replace(/^file:/, '').replace(/^\?.*$/, ''));
  // 常见桌面库路径
  for (const rel of [
    'desktop/dist/kaypal-ai.sqlite',
    'desktop/kaypal-ai.sqlite',
    'backend/prisma/dev.db',
  ]) {
    candidates.push(join(repoRoot, rel));
  }
  // macOS 桌面端真实运行库（用户数据目录）
  if (home) {
    candidates.push(join(home, 'Library/Application Support/ai-content-desktop/kaypal-ai.sqlite'));
  }
  for (const c of candidates) {
    const p = c.startsWith('/') ? c : join(repoRoot, c);
    if (!existsSync(p)) continue;
    // 必须是真实运行库：含 ai_chat_logs 表（排除 dev.db 等种子/模板库）
    try {
      const db = new DatabaseSync(p, { readOnly: true });
      const has = db
        .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='ai_chat_logs'`)
        .get();
      db.close();
      if (has && Number(has.n) > 0) return p;
    } catch {
      /* 打不开则跳过 */
    }
  }
  return undefined;
}

function localChatStats(dbPath, days = 8) {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT date(created_at/1000, 'unixepoch') AS d, count(*) AS n,
                sum(CASE WHEN status='error' THEN 1 ELSE 0 END) AS err
         FROM ai_chat_logs
         WHERE created_at >= (strftime('%s','now') - ?) * 1000
         GROUP BY d ORDER BY d`,
      )
      .all(days * 86400);
    db.close();
    return rows;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- 状态文件读写 ----
function loadState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return { snapshots: [] };
  }
}
function saveState(s) {
  try {
    writeFileSync(statePath, JSON.stringify(s, null, 2));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

// ---- 告警推送（可选 webhook，兼容企业微信/飞书/钉钉机器人）----
async function pushAlert(text) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
      signal: AbortSignal.timeout(10000),
    });
    return true;
  } catch {
    return false;
  }
}

// ---- 主流程 ----
async function main() {
  const env = parseEnvFile(envPath);
  const findings = [];
  const statuses = new Set();

  // 1. 网关余额探针
  const probe = await probeGatewayBalance(env);
  if (probe.gatewayDown) {
    statuses.add('ALERT');
    findings.push({ level: 'ALERT', topic: 'gateway-down', message: probe.error });
  } else if (!probe.ok) {
    statuses.add('WARN');
    findings.push({ level: 'WARN', topic: 'gateway-probe', message: probe.error });
  } else if (typeof probe.balance !== 'number') {
    statuses.add('WARN');
    findings.push({
      level: 'WARN',
      topic: 'gateway-probe',
      message: '网关响应无 balanceAfter（无法读取账户余额）',
      raw: probe,
    });
  } else {
    findings.push({
      level: 'INFO',
      topic: 'gateway-probe',
      message: `kaypal 网关账户余额 ¥${probe.balance.toFixed(2)}`,
      balance: probe.balance,
    });
  }

  // 2. 本地用量基线
  const dbPath = findSqliteDb(env);
  let chatStats = [];
  if (dbPath) {
    const r = localChatStats(dbPath);
    if (Array.isArray(r)) {
      chatStats = r;
      const recent = chatStats.slice(-1)[0];
      const prior = chatStats.slice(0, -1);
      const priorAvg =
        prior.length > 0 ? prior.reduce((a, b) => a + Number(b.n), 0) / prior.length : 0;
      findings.push({
        level: 'INFO',
        topic: 'local-usage',
        message: `SQLite ${dbPath.split('/').pop()}：近 ${chatStats.length} 天调用 ${chatStats.reduce((a, b) => a + Number(b.n), 0)} 次`,
        daily: chatStats.map((r2) => ({ d: r2.d, n: Number(r2.n), err: Number(r2.err) })),
      });
      if (recent && priorAvg > 0 && Number(recent.n) > priorAvg * LOCAL_SURGE_RATIO) {
        statuses.add('WARN');
        findings.push({
          level: 'WARN',
          topic: 'local-surge',
          message: `今日本地调用 ${recent.n} 次，超 7 日均值 ${priorAvg.toFixed(1)} 的 ${LOCAL_SURGE_RATIO} 倍——检查是否有异常流量`,
        });
      }
    } else {
      findings.push({ level: 'INFO', topic: 'local-usage', message: `SQLite 读取失败: ${r.error}` });
    }
  } else {
    findings.push({
      level: 'INFO',
      topic: 'local-usage',
      message: '未找到本地 SQLite 库（跳过调用量基线，仅余额探针）',
    });
  }

  // 3. 余额消耗对比（盗用核心判定）
  const state = loadState();
  const last = state.snapshots.at(-1);
  const now = Date.now();
  if (probe.ok && typeof probe.balance === 'number') {
    if (last && typeof last.balance === 'number') {
      const intervalMs = now - last.ts;
      if (intervalMs >= MIN_INTERVAL_MS) {
        const dropped = last.balance - probe.balance;
        if (dropped > 0) {
          const perDay = (dropped / intervalMs) * 24 * 3600 * 1000;
          findings.push({
            level: 'INFO',
            topic: 'balance-consumption',
            message: `间隔 ${(intervalMs / 3600000).toFixed(1)}h 余额下降 ¥${dropped.toFixed(2)}（约 ¥${perDay.toFixed(2)}/天）`,
            dropped,
            perDay,
          });
          if (dropped > BALANCE_DROP_ALERT_AMOUNT) {
            statuses.add('ALERT');
            findings.push({
              level: 'ALERT',
              topic: 'abuse-suspect',
              message: `单次间隔余额下降 ¥${dropped.toFixed(2)}，超过告警阈值 ¥${BALANCE_DROP_ALERT_AMOUNT}——若本地调用量无对应增长，高度怀疑凭据被外部盗用！`,
            });
          }
        } else if (dropped < 0) {
          findings.push({
            level: 'INFO',
            topic: 'balance-consumption',
            message: `间隔内余额增加 ¥${(-dropped).toFixed(2)}（充值或校准）`,
          });
        }
      } else {
        findings.push({
          level: 'INFO',
          topic: 'balance-consumption',
          message: `距上次快照 ${(intervalMs / 60000).toFixed(0)}min，小于最小间隔，跳过消耗对比`,
        });
      }
    } else {
      findings.push({
        level: 'INFO',
        topic: 'balance-consumption',
        message: '首次余额快照（基线建立中，下次巡检开始对比）',
      });
    }
    state.snapshots.push({ ts: now, balance: probe.balance });
    if (state.snapshots.length > 90) state.snapshots = state.snapshots.slice(-90);
    const saveErr = saveState(state);
    if (saveErr) {
      statuses.add('WARN');
      findings.push({ level: 'WARN', topic: 'state', message: `状态写入失败: ${saveErr}` });
    }
  }

  // 4. 汇总
  const levelOrder = ['ALERT', 'WARN', 'INFO'];
  const finalStatus = statuses.has('ALERT')
    ? 'ALERT'
    : statuses.has('WARN')
      ? 'WARN'
      : 'PASS';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = join(
    repoRoot,
    'docs',
    `acceptance-evidence-${new Date().toISOString().slice(0, 10)}`,
    `credential-abuse-watch-${ts}`,
  );
  mkdirSync(evidenceDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    status: finalStatus,
    strict,
    statePath,
    findings: findings.sort(
      (a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level),
    ),
  };
  writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));

  // 5. 输出
  console.log(`[credential-abuse-watch] ${finalStatus}`);
  for (const f of report.findings) {
    console.log(`  [${f.level}] ${f.message}`);
  }
  console.log(`  报告: ${evidenceDir}/report.json`);
  if (finalStatus !== 'PASS') {
    const text = report.findings
      .filter((f) => f.level !== 'INFO')
      .map((f) => `[${f.level}] ${f.topic}: ${f.message}`)
      .join('\n');
    const pushed = await pushAlert(`【凭据盗用巡检 ${finalStatus}】\n${text}`);
    if (pushed) console.log('  告警已推送 webhook');
  }
  if (strict && (finalStatus === 'ALERT' || finalStatus === 'WARN')) {
    process.exit(2);
  }
  if (finalStatus === 'ALERT') process.exit(2);
  if (finalStatus === 'WARN') process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error('[credential-abuse-watch] 运行异常:', e);
  process.exit(2);
});
