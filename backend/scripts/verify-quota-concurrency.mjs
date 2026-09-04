/**
 * 配额并发穿透真验证脚本
 *
 * 目的：真并发验证 AccountTouchQuotaService.tryConsume 的原子 SQL
 * 确实堵住「同号多任务并发抢配额」导致的超发。
 *
 * 方法：开 N 个独立进程，每个进程各自用独立 pg 连接，并发调用
 * tryConsume（复现 service 里一模一样的两条 SQL），断言：
 *   1. 最终 touch_count === dailyLimit（恰好扣满，一条不多）
 *   2. 返回成功的次数 === dailyLimit（其余全被拦）
 *   3. 不存在超发（touch_count 永不 > dailyLimit）
 *
 * 用法：
 *   node scripts/verify-quota-concurrency.mjs --concurrency 50 --limit 20
 */

import pg from 'pg';

const CONCURRENCY = parseInt(process.argv[process.argv.indexOf('--concurrency') + 1] || '50', 10);
const DAILY_LIMIT = parseInt(process.argv[process.argv.indexOf('--limit') + 1] || '20', 10);
const USER_ID = 'verify-concurrency-u1';
const PLATFORM = 'douyin';
const ACCOUNT_ID = `verify-stable-${Date.now().toString(36)}`;

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5432/ai_content';

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function newId() {
  return `vq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// 完整复现 service.tryConsume 的 SQL
async function tryConsume(client) {
  const touchDate = today();
  await client.query(
    `INSERT INTO "account_touch_quotas"
       ("id", "user_id", "platform", "account_id", "daily_limit", "touch_date", "touch_count", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("user_id", "platform", "account_id", "touch_date") DO NOTHING`,
    [newId(), USER_ID, PLATFORM, ACCOUNT_ID, DAILY_LIMIT, touchDate],
  );
  const res = await client.query(
    `UPDATE "account_touch_quotas"
       SET "touch_count" = "touch_count" + 1, "updated_at" = CURRENT_TIMESTAMP
     WHERE "user_id" = $1 AND "platform" = $2 AND "account_id" = $3
       AND "touch_date" = $4 AND "touch_count" < "daily_limit"`,
    [USER_ID, PLATFORM, ACCOUNT_ID, touchDate],
  );
  return res.rowCount === 1;
}

async function worker() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  let success = 0;
  try {
    for (let i = 0; i < 3; i++) {
      if (await tryConsume(client)) success++;
    }
  } finally {
    await client.end();
  }
  return success;
}

async function main() {
  console.log(`\n=== 配额并发穿透真验证 ===`);
  console.log(`并发 worker 数: ${CONCURRENCY}`);
  console.log(`账号日上限 dailyLimit: ${DAILY_LIMIT}`);
  console.log(`账号: ${ACCOUNT_ID} (platform=${PLATFORM})`);
  console.log(`每 worker 尝试次数: 3（总尝试 ${CONCURRENCY * 3} 次）\n`);

  // 清掉可能残留的同 key 数据
  const admin = new pg.Client({ connectionString: DB_URL });
  await admin.connect();
  await admin.query(
    `DELETE FROM "account_touch_quotas" WHERE "user_id"=$1 AND "platform"=$2 AND "account_id"=$3`,
    [USER_ID, PLATFORM, ACCOUNT_ID],
  );
  await admin.end();

  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker()),
  );
  const totalSuccess = results.reduce((a, b) => a + b, 0);
  const elapsed = Date.now() - start;

  // 读最终计数
  const check = new pg.Client({ connectionString: DB_URL });
  await check.connect();
  const { rows } = await check.query(
    `SELECT "touch_count", "daily_limit" FROM "account_touch_quotas"
     WHERE "user_id"=$1 AND "platform"=$2 AND "account_id"=$3 AND "touch_date"=$4`,
    [USER_ID, PLATFORM, ACCOUNT_ID, today()],
  );
  await check.end();

  const finalCount = rows[0]?.touch_count ?? 0;
  const limit = rows[0]?.daily_limit ?? DAILY_LIMIT;

  console.log(`--- 结果 ---`);
  console.log(`总成功次数（should=成功数）: ${totalSuccess}`);
  console.log(`最终 touch_count: ${finalCount}`);
  console.log(`daily_limit: ${limit}`);
  console.log(`耗时: ${elapsed}ms\n`);

  const pass1 = finalCount === limit;                    // 恰好扣满
  const pass2 = totalSuccess === limit;                  // 成功次数 = 上限
  const pass3 = finalCount <= limit;                     // 绝不超发
  const pass = pass1 && pass2 && pass3;

  console.log(`[1] 最终计数 === 上限 (${finalCount} === ${limit}): ${pass1 ? '✅' : '❌'}`);
  console.log(`[2] 成功次数 === 上限 (${totalSuccess} === ${limit}): ${pass2 ? '✅' : '❌'}`);
  console.log(`[3] 绝不超发 (${finalCount} <= ${limit}): ${pass3 ? '✅' : '❌'}`);
  console.log(`\n${pass ? '🎉 并发穿透已堵住：原子扣减正确，无超发' : '❌ 验证失败：存在超发或扣减异常'}`);

  // 清理测试数据
  const clean = new pg.Client({ connectionString: DB_URL });
  await clean.connect();
  await clean.query(
    `DELETE FROM "account_touch_quotas" WHERE "user_id"=$1 AND "platform"=$2 AND "account_id"=$3`,
    [USER_ID, PLATFORM, ACCOUNT_ID],
  );
  await clean.end();

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
