// B 类真机验证（v2）：真实驱动浏览器跑「关键词搜索 → 读评论」两段式。
// 连 SQLite 桌面库（真实账号 + 登录态），走独立验证后端（含 B 类 + 配额代码）。
//
// 相比 v1 的修复（codex 复核 P1/P2 打回项）：
//   1. 数据安全：publish_accounts 用 INSERT（非 INSERT OR REPLACE），碰撞即拒绝退出；
//      清理逻辑统一进 finally，脚本中途崩溃也不留脏数据。
//   2. 防假绿：检查 HTTP 2xx + scanned>0 + discoveryFallback（推荐流降级必须失败）；
//      任一不符立即非零退出，不再「后端 500 也正常退出」。
//   3. SQL 安全：所有 SQL 用 sqlite3 参数绑定（? 占位），不把外部参数拼进字符串。
//   4. 证据绑定：输出 commit SHA + bundle hash + 完整 HTTP body 到证据文件。
//
// 用法：node scripts/verify-b-class-realmachine.mjs <platform> <accountId> <keyword> [autoReply]
//   例：node scripts/verify-b-class-realmachine.mjs kuaishou 2 穿搭 0
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
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

// ---- 参数化 SQL（node:sqlite 原生绑定，彻底无字符串拼接注入面）----
const mainDb = new DatabaseSync(DB);
const acctDb = new DatabaseSync(ACCT_DB);

function run(db, sql, params = []) {
  db.prepare(sql).run(...params);
}
function get(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

// ---- 解析参数 ----
const platform = process.argv[2] || 'kuaishou';
const accountId = process.argv[3] || '2';
const keyword = process.argv[4] || '穿搭';
const autoReply = process.argv[5] === '1';

// ---- 证据：commit SHA + bundle hash ----
let commitSha = '';
let bundleHash = '';
try {
  commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: join(__dirname, '..') }).trim();
} catch { commitSha = 'unknown'; }
try {
  const bundle = join(__dirname, '..', 'dist-bundle-sqlite', 'index.js');
  bundleHash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
} catch { bundleHash = 'unknown'; }

// ---- 1. 注入 localOnly session（参数绑定）----
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
run(
  mainDb,
  `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);`,
  [sid, USER_ID, hash, exp, now, meta, now, now],
);
const cookie = `ai_content_session=${token}`;

// ---- 2. 插入 publish_accounts（INSERT 非 REPLACE，碰撞即拒绝）----
const ownerHash = '9ab472474cc21dd4';
const stableId = `local-engine-${ownerHash}-${accountId}-${platform}`;

// 先查是否已存在，存在则拒绝（绝不覆盖真实账号）
const existing = get(acctDb, `SELECT id FROM publish_accounts WHERE id=?;`, [stableId]);
if (existing) {
  console.error(`❌ 拒绝执行：publish_accounts 已存在 stableId=${stableId}`);
  console.error('   该 ID 可能是真实账号，验证脚本绝不 INSERT OR REPLACE 覆盖。请换 accountId 或先人工确认。');
  // 清理已注入的 session 后退出
  run(mainDb, `DELETE FROM user_sessions WHERE id=?;`, [sid]);
  process.exit(2);
}
run(
  acctDb,
  `INSERT INTO publish_accounts (id,tenant_id,user_id,platform,name,status,config,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?);`,
  [stableId, TENANT_ID, USER_ID, platform, '杨宏宇', 'ready', '{}', now, now],
);

// ---- 3. 调 scan（两段式真机），finally 兜底清理 ----
let exitCode = 0;
const evidence = {
  commitSha,
  bundleHash,
  base: BASE,
  platform,
  accountId,
  keyword,
  autoReply,
  requestedAt: new Date().toISOString(),
  httpStatus: null,
  body: null,
  assertions: {},
};

try {
  const resp = await fetch(`${BASE}/api/comment-acquisition/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      platform,
      accountId,
      keyword,
      limit: 20,
      autoReply,
      minLeadScore: 0,
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

  console.log(JSON.stringify(body, null, 2));

  if (!ok || scanned <= 0 || fallback) {
    exitCode = 1;
  }
} catch (e) {
  console.error(`❌ 请求失败: ${e.message}`);
  evidence.assertions.http2xx = false;
  exitCode = 1;
} finally {
  // P1-1 数据安全：无论成败，清理测试数据（finally 兜底）
  run(mainDb, `DELETE FROM user_sessions WHERE id=?;`, [sid]);
  run(acctDb, `DELETE FROM publish_accounts WHERE id=?;`, [stableId]);
  console.log('\n已清理注入的 session 与测试账号（finally 兜底）');
}

// 证据落盘
const evidencePath = join(__dirname, '..', '.verify-b-class-evidence.json');
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
console.log(`\n证据已写: ${evidencePath}`);
console.log(`  commit=${commitSha}`);
console.log(`  bundleHash=${bundleHash.slice(0, 16)}…`);

mainDb.close();
acctDb.close();

process.exit(exitCode);
