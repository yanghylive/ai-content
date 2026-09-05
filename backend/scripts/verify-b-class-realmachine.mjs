// B 类真机验证（v2.2）：真实驱动浏览器跑「关键词搜索 → 读评论」两段式（只读，零副作用）。
// 连 SQLite 桌面库（真实账号 + 登录态），走独立验证后端（含 B 类 + 配额代码）。
//
// 相比 v1 的修复（codex 复核 P1/P2 打回项，v2.2 融合补齐）：
//   1.[P1-1]数据安全：publish_accounts 用 INSERT（非 INSERT OR REPLACE）；stableId 含独占
//     verify<时间戳> 段（真实账号该段是纯数字，永不碰撞；ownership 按 id 后缀
//     '-{accountId}-{platform}' 匹配，verify 段插在中间不影响命中）；INSERT 前碰撞断言，
//     DELETE 前校验 config 哨兵（只删自己插入的行，双重保险）；清理统一进 finally。
//   2.[P1-2]防假绿：断言 HTTP 2xx + scanned>0 + discoveryFallback!==true（推荐流降级判失败）；
//     任一不符非零退出。SQL 全部 node:sqlite 参数绑定（? 占位），无字符串拼接注入面。
//   3.[P1-4]零副作用：minLeadScore=999——评分门槛挡住全部线索：不生成 AI 回复（v1 用 0 曾触发
//     AI 生成 + 409 BILLING_IDEMPOTENCY_REPLAY）、不写 interaction_events/leads。scanned 统计
//     在评分循环之前（scan 主流程），不受门槛影响。断言含 leads===0 && replies===0 只读校验。
//     autoReply 能力整体移除：B 类验证只读，真实发回复必须另走受控流程。
//   4.[P1-5]证据绑定：evidence JSON 带时间戳落盘 docs/b-class-evidence/——commit SHA、
//     bundle hash、完整 HTTP body、断言逐项、3010/3011/3013 三端口实时状态。
//     结论只声明所测端口与当次源码，不外推 3010/3011/发布包。
//   5.[P2]注释与文案改「两段式」；本脚本走 localOnly+SUPER_ADMIN 验证后门，
//     不覆盖普通用户租户/权限链路（如实交底）。
//   6.已知边界：小红书（登录 expired）、回复链路（replyComment）、小红书搜索→详情页点击
//     均未验证，保持 BLOCKED。
//   7.[v2.2 修复复核 P1-3]：session 注入 + 账号插入整体纳入 try/finally，任一步失败
//     不残留；finally 用 sessionInjected/accountInjected 布尔标记幂等清理。
//   8.[v2.2 修复复核 P1-5]：证据加 worktreeDirty/worktreeDirtyFiles——即使 commit SHA 正确，
//     脏工作区也无法证明运行 bundle 干净，结论只声明所测源码+bundle hash。
//
// 用法：node scripts/verify-b-class-realmachine.mjs [platform] [accountId] [keyword]
//   例：node scripts/verify-b-class-realmachine.mjs kuaishou 2 穿搭
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = `${process.env.HOME}/Library/Application Support/ai-content-desktop`;
const DB = `${USER_DATA_DIR}/kaypal-ai.sqlite`;
// 账号库：publish_accounts 等业务表按用户分库存储
const ACCT_DB = `${USER_DATA_DIR}/accounts/cms2ktllp03u9j1wprksvwy8w.sqlite`;
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3013';
const USER_ID = 'cms2ktllp03u9j1wprksvwy8w'; // 本机登录用户
const TENANT_ID = 'cmtix3lr3000sgozi0rz3mm6a'; // 现有抖音 publish_accounts 记录用的 tenant
// 只读验证：评分门槛拉满，零线索入库、零 AI 生成（见头部 3）
const MIN_LEAD_SCORE = Number(process.env.VERIFY_MIN_LEAD_SCORE ?? 999);

// ---- 参数化 SQL（node:sqlite 原生绑定，彻底无字符串拼接注入面）----
const mainDb = new DatabaseSync(DB);
const acctDb = new DatabaseSync(ACCT_DB);

function run(db, sql, params = []) {
  db.prepare(sql).run(...params);
}
function get(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

// ---- 解析参数（autoReply 已移除——B 类验证只读）----
const platform = process.argv[2] || 'kuaishou';
const accountId = process.argv[3] || '2';
const keyword = process.argv[4] || '穿搭';

// ---- 证据：commit SHA + bundle hash + 工作区脏状态 ----
let commitSha = '';
let bundleHash = '';
let worktreeDirty = false;
let worktreeDirtyFiles = [];
try {
  commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: join(__dirname, '..') }).trim();
  // P1-5：记录工作区是否有未提交改动。即使 SHA 正确，脏工作区也无法证明运行 bundle 干净。
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: join(__dirname, '..') }).trim();
  worktreeDirtyFiles = dirty.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  worktreeDirty = worktreeDirtyFiles.length > 0;
} catch { commitSha = 'unknown'; }
try {
  const bundle = join(__dirname, '..', 'dist-bundle-sqlite', 'index.js');
  bundleHash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
} catch { bundleHash = 'unknown'; }

// ---- 0. 三端口现场探测（证据只声明所测端口，不外推）----
async function probePort(name, url) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    return { url, httpStatus: r.status, ok: r.ok, ms: Date.now() - t0 };
  } catch (e) {
    return { url, unreachable: true, reason: String(e.message || e), ms: Date.now() - t0 };
  }
}
const portStatus = {};
await Promise.all([
  probePort('backend_3013', `${BASE}/`).then((v) => (portStatus.backend_3013 = v)),
  probePort('desktop_3010', 'http://127.0.0.1:3010/').then((v) => (portStatus.desktop_3010 = v)),
  probePort('backend_3011', 'http://127.0.0.1:3011/').then((v) => (portStatus.backend_3011 = v)),
]);

// ---- 1. 预生成注入标识（不落库，落库统一进 try/finally）----
const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
const hash = createHash('sha256').update(token).digest('hex');
const sid = 'wbverify_' + randomUUID().slice(0, 12);
const now = new Date().toISOString();
const exp = new Date(Date.now() + 86400000).toISOString();
const meta = JSON.stringify({
  source: 'wbverify',
  localOnly: true,
  kaypalSubscriptionPlan: 'ADVANCED',
  kaypalRole: 'SUPER_ADMIN',
  kaypalPlatformRole: 'SUPER_ADMIN',
});
const cookie = `ai_content_session=${token}`;

// ---- 2. 预生成临时 publish_accounts 标识（不落库，落库统一进 try/finally）----
// ownership 匹配规则（comment-acquisition.service assertAccountOwnership）：
//   OR: [{ id }, { id: { endsWith: `-${accountId}-${platform}` } }]
// verify<ts> 插在 ownerHash 与 accountId 之间：后缀 '-2-kuaishou' 完整保留 → 命中；
// 真实账号该段是纯数字 engineAccountId → 与 verify<ts> 永不碰撞。
const ownerHash = '9ab472474cc21dd4';
const verifyTag = `verify${Date.now()}`;
const stableId = `local-engine-${ownerHash}-${verifyTag}-${accountId}-${platform}`;
// 哨兵：config 写入独占标记，DELETE 前校验，杜绝任何形式的误删真实账号
const sentinel = JSON.stringify({ __wbverify: verifyTag });

// ---- 3. 调 scan（两段式真机），断言 + finally 兜底清理 ----
// P1-3：session 注入 + 账号插入全部纳入 try/finally，任一步失败都不会残留。
let exitCode = 0;
let sessionInjected = false;
let accountInjected = false;
const evidence = {
  commitSha,
  bundleHash,
  worktreeDirty,
  worktreeDirtyFiles,
  base: BASE,
  platform,
  accountId,
  keyword,
  autoReply: false,
  minLeadScore: MIN_LEAD_SCORE,
  requestedAt: new Date().toISOString(),
  portStatus,
  httpStatus: null,
  body: null,
  assertions: {},
  injected: { session: sid, account: stableId },
  cleanup: {},
};

try {
  // ---- 3a. 注入 localOnly session（参数绑定；sid 全局唯一随机，INSERT 非 REPLACE）----
  if (get(mainDb, `SELECT id FROM user_sessions WHERE id=?;`, [sid])) {
    throw new Error(`session id 碰撞（${sid}），拒绝继续`);
  }
  run(
    mainDb,
    `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);`,
    [sid, USER_ID, hash, exp, now, meta, now, now],
  );
  sessionInjected = true;

  // ---- 3b. 插入临时 publish_accounts（INSERT 非 REPLACE + 独占 verify 段 + 哨兵）----
  const existing = get(acctDb, `SELECT id FROM publish_accounts WHERE id=?;`, [stableId]);
  if (existing) {
    throw new Error(`临时 stableId 意外碰撞=${stableId}（概率事件，换一次运行即可）`);
  }
  run(
    acctDb,
    `INSERT INTO publish_accounts (id,tenant_id,user_id,platform,name,status,config,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?);`,
    [stableId, TENANT_ID, USER_ID, platform, '杨宏宇(verify)', 'ready', sentinel, now, now],
  );
  accountInjected = true;
  console.log(`已插入临时账号（verify 独占 id，不覆盖任何已有记录）: ${stableId}`);

  // ---- 3c. 前后快照（P2：零副作用不只靠接口返回，还要核对真实库行数）----
  // 只读验证下，这些表行数应保持不变。
  const snapTables = {
    main: ['leads', 'interaction_events', 'comment_acquisition_leads', 'lead_signals', 'lead_score_snapshots'],
    acct: ['acquisition_quotas', 'comment_insights'],
  };
  const beforeSnap = {};
  for (const t of snapTables.main) {
    try { beforeSnap[t] = get(mainDb, `SELECT COUNT(*) AS c FROM ${t};`).c; } catch { beforeSnap[t] = 'n/a'; }
  }
  for (const t of snapTables.acct) {
    try { beforeSnap[t] = get(acctDb, `SELECT COUNT(*) AS c FROM ${t};`).c; } catch { beforeSnap[t] = 'n/a'; }
  }

  // ---- 3d. 调 scan ----
  const resp = await fetch(`${BASE}/api/comment-acquisition/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      platform,
      accountId,
      keyword,
      limit: 20,
      autoReply: false,
      minLeadScore: MIN_LEAD_SCORE, // 999=评分门槛挡住全部线索 → 零 AI 生成、零写库（只读验证）
    }),
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }

  evidence.httpStatus = resp.status;
  evidence.body = body;

  // 响应体可能是 {success, data:{scanned,...}} 包裹，或裸 {scanned,...}，兼容两种
  const data = typeof body === 'object' && body !== null
    ? (body.data && typeof body.data === 'object' ? body.data : body)
    : {};

  // P1-2 防假绿断言：HTTP 2xx
  const ok = resp.status >= 200 && resp.status < 300;
  evidence.assertions.http2xx = ok;
  console.log(`HTTP ${resp.status}${ok ? '' : ' ❌ 非 2xx'}`);

  // P1-2 防假绿断言：scanned > 0（必须从 data 层取，兼容包裹结构）
  const scanned = Number(data.scanned ?? 0);
  evidence.assertions.scannedPositive = scanned > 0;
  console.log(`scanned=${scanned}${scanned > 0 ? '' : ' ❌ 未扫到任何评论'}`);

  // P1-3 防假绿断言：不能是推荐流降级
  const fallback = data.discoveryFallback === true;
  evidence.assertions.notFallback = !fallback;
  if (fallback) {
    console.log('❌ discoveryFallback=true：结果来自推荐流降级，非关键词搜索，判失败');
  }

  // P1-4 只读断言：门槛 999 下必须零入库、零 AI 回复（scanned 统计不受门槛影响）
  const readOnlyOk = Number(data.leads ?? -1) === 0
    && Number(data.replies ?? -1) === 0
    && Array.isArray(data.items) && data.items.length === 0;
  evidence.assertions.readOnlyNoSideEffect = readOnlyOk;
  console.log(`只读校验 leads=${data.leads} replies=${data.replies} items=${Array.isArray(data.items) ? data.items.length : '?'}${readOnlyOk ? '' : ' ❌ 只读验证出现副作用'}`);

  // P2 零副作用：前后库快照对比（接口返回零 ≠ 库没写）
  const afterSnap = {};
  const snapDiff = {};
  for (const t of snapTables.main) {
    try { afterSnap[t] = get(mainDb, `SELECT COUNT(*) AS c FROM ${t};`).c; } catch { afterSnap[t] = 'n/a'; }
  }
  for (const t of snapTables.acct) {
    try { afterSnap[t] = get(acctDb, `SELECT COUNT(*) AS c FROM ${t};`).c; } catch { afterSnap[t] = 'n/a'; }
  }
  let snapClean = true;
  for (const t of [...snapTables.main, ...snapTables.acct]) {
    snapDiff[t] = { before: beforeSnap[t], after: afterSnap[t] };
    if (beforeSnap[t] !== 'n/a' && afterSnap[t] !== 'n/a' && beforeSnap[t] !== afterSnap[t]) {
      snapClean = false;
      console.log(`❌ 库快照变化 ${t}: ${beforeSnap[t]} → ${afterSnap[t]}`);
    }
  }
  evidence.assertions.snapshotNoSideEffect = snapClean;
  evidence.snapshot = snapDiff;
  console.log(`库快照校验 ${snapClean ? '✅ 无变化' : '❌ 有变化'}`);

  console.log(JSON.stringify(body, null, 2));

  if (!ok || scanned <= 0 || fallback || !readOnlyOk || !snapClean) {
    exitCode = 1;
  }
} catch (e) {
  console.error(`❌ 请求失败: ${e.message}`);
  evidence.assertions.http2xx = false;
  exitCode = 1;
} finally {
  // P1-1/P1-3 数据安全：无论成败、无论插库到哪一步，finally 兜底清理（幂等 + 哨兵校验，只删自己插入的行）
  if (sessionInjected) {
    try {
      run(mainDb, `DELETE FROM user_sessions WHERE id=?;`, [sid]);
      evidence.cleanup.session = 'deleted';
    } catch (e) { evidence.cleanup.session = 'error: ' + e.message; }
  } else {
    evidence.cleanup.session = 'not-injected(no-cleanup-needed)';
  }
  if (accountInjected) {
    try {
      const row = get(acctDb, `SELECT config FROM publish_accounts WHERE id=?;`, [stableId]);
      if (!row) {
        evidence.cleanup.account = 'already-absent';
      } else if (row.config === sentinel) {
        run(acctDb, `DELETE FROM publish_accounts WHERE id=?;`, [stableId]);
        const left = get(acctDb, `SELECT id FROM publish_accounts WHERE id=?;`, [stableId]);
        evidence.cleanup.account = left ? 'DELETE-FAILED-still-present' : 'deleted-and-verified';
        if (left) exitCode = 1;
      } else {
        // 哨兵不匹配 = 该行不是本脚本插入的（理论上不可能），保留并要求人工检查
        evidence.cleanup.account = 'sentinel-mismatch-kept(请人工检查)';
        exitCode = 1;
      }
    } catch (e) { evidence.cleanup.account = 'error: ' + e.message; }
  } else {
    evidence.cleanup.account = 'not-injected(no-cleanup-needed)';
  }
  console.log(`\n清理: session=${evidence.cleanup.session} account=${evidence.cleanup.account}`);
}

// ---- 证据落盘（带时间戳，多轮证据并存）----
const verdict = exitCode === 0 ? 'PASS' : 'FAIL';
try {
  const dir = join(__dirname, '..', 'docs', 'b-class-evidence');
  mkdirSync(dir, { recursive: true });
  const evidencePath = join(
    dir,
    `verify-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}-${verdict}.json`,
  );
  writeFileSync(evidencePath, JSON.stringify({ ...evidence, verdict }, null, 2));
  console.log(`\n证据已写: ${evidencePath}`);
  console.log(`  commit=${commitSha} bundleHash=${bundleHash.slice(0, 16)}…`);
} catch (e) {
  console.error(`证据落盘失败: ${e.message}`);
}

mainDb.close();
acctDb.close();

console.log(`\n==== B 类真机验证 v2.1: ${verdict} ====`);
process.exit(exitCode);
