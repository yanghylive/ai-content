// B 类真机验证：真实驱动浏览器跑「关键词搜索 → 读作品 → 读评论」三段式。
// 连 SQLite 桌面库（真实账号 + 登录态），走已起的 3013 验证后端（含 B 类 + 配额代码）。
// 前置：先注入 localOnly session 绕过鉴权 + 插入 publish_accounts 测试记录让 assertAccountOwnership 通过。
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const DB = `${process.env.HOME}/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite`;
// 账号库：publish_accounts 等业务表按用户分库存储（backend 日志「账号库组织关系已回补」坐实）
const ACCT_DB = `${process.env.HOME}/Library/Application Support/ai-content-desktop/accounts/cms2ktllp03u9j1wprksvwy8w.sqlite`;
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3013';
const USER_ID = 'cms2ktllp03u9j1wprksvwy8w'; // 本机登录用户（杨宏宇）
const TENANT_ID = 'cmtix3lr3000sgozi0rz3mm6a'; // 验收用户的组织（现有抖音 publish_accounts 记录用的 tenant）

const run = (sql) =>
  execSync(`sqlite3 "${DB}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const runAcct = (sql) =>
  execSync(`sqlite3 "${ACCT_DB}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();

// ---- 0. 解析参数（供后续构造 stableId + 请求体）----
const platform = process.argv[2] || 'kuaishou';
const accountId = process.argv[3] || '2';
const keyword = process.argv[4] || '穿搭';
const autoReply = process.argv[5] === '1';

// ---- 1. 注入 localOnly session（绕过鉴权，tenantId=null）----
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
  `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sid}','${USER_ID}','${hash}','${exp}','${now}','${meta}','${now}','${now}');`,
);
const cookie = `ai_content_session=${token}`;

// ---- 2. 插入 publish_accounts 记录（账号库！stableId 对齐，让 assertAccountOwnership 通过）----
// ownerHash = sha256(tenantId\0userId) 前16 = 9ab472474cc21dd4（对齐现有抖音记录）
// stableId = local-engine-9ab472474cc21dd4-{engineAccountId}-{platform}
const ownerHash = '9ab472474cc21dd4';
const stableId = `local-engine-${ownerHash}-${accountId}-${platform}`;
runAcct(
  `INSERT OR REPLACE INTO publish_accounts (id,tenant_id,user_id,platform,name,status,config,created_at,updated_at) VALUES ('${stableId}','${TENANT_ID}','${USER_ID}','${platform}','杨宏宇','ready','{}','${now}','${now}');`,
);
console.log(`已插入账号库 publish_accounts: ${stableId}`);

// ---- 3. 调 scan 触发三段式真机 ----
console.log(`\n=== B 类真机验证 ===`);
console.log(`platform=${platform} accountId=${accountId} keyword="${keyword}" autoReply=${autoReply}`);
console.log(`后端=${BASE} 库=${DB}\n`);

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
      minLeadScore: 0, // 全量收，验证扫描本身，不被评分门槛过滤
    }),
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`HTTP ${resp.status}`);
  console.log(JSON.stringify(body, null, 2));
} catch (e) {
  console.error(`❌ 请求失败: ${e.message}`);
}

// ---- 4. 清理测试数据 ----
run(`DELETE FROM user_sessions WHERE id='${sid}';`);
runAcct(`DELETE FROM publish_accounts WHERE id='${stableId}';`);
console.log('\n已清理注入的 session 与测试账号');
