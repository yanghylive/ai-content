// 验证账号 status 类型：后端 /auto-upload/accounts 返回的 account.status 应为 number(1=ready)
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const DB = `${process.env.HOME}/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite`;
const BASE = 'http://127.0.0.1:3011';
const run = (sql) =>
  execSync(`sqlite3 "${DB}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();

const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
const hash = createHash('sha256').update(token).digest('hex');
const sid = 'wbtest_' + randomUUID().slice(0, 12);
const now = new Date().toISOString();
const exp = new Date(Date.now() + 86400000).toISOString();
const meta = JSON.stringify({ source: 'wbtest', localOnly: true, kaypalSubscriptionPlan: 'ADVANCED', kaypalRole: 'SUPER_ADMIN', kaypalPlatformRole: 'SUPER_ADMIN' });
run(`INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sid}','cmsmjmskh01xwi5opfmpmu30n','${hash}','${exp}','${now}','${meta}','${now}','${now}');`);
const cookie = `ai_content_session=${token}`;

const resp = await fetch(`${BASE}/api/auto-upload/accounts`, { headers: { Cookie: cookie } });
const body = await resp.json();
const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;

console.log(`HTTP ${resp.status}, 返回 ${list ? list.length : '?'} 个账号`);
if (list && list.length > 0) {
  for (const a of list.slice(0, 5)) {
    console.log(`  id=${a.id} platform=${a.platform} status=${JSON.stringify(a.status)} (${typeof a.status}) statusCode=${a.statusCode} statusLabel=${a.statusLabel}`);
  }
  const readyCount = list.filter((a) => a.status === 1).length;
  const expiredCount = list.filter((a) => a.status !== 1).length;
  console.log(`\nready(status===1) = ${readyCount}, 非ready = ${expiredCount}`);
}

run(`DELETE FROM user_sessions WHERE id='${sid}';`);
console.log('已清理 session');
