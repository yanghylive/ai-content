// 验证假消费修复：lead.created 事件（无对应消费者）应保留 published，不被 markConsumed
import { execSync } from 'node:child_process';

const DB = `${process.env.HOME}/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite`;
const run = (sql) =>
  execSync(`sqlite3 "${DB}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();

const id = 'e2e-lead-event-' + Date.now();
const now = new Date().toISOString();
const payload = JSON.stringify({ type: 'lead.created', leadId: 'lead-e2e', userId: 'u1', at: now });

// 1. 插一条 lead.created 事件
run(
  `INSERT INTO lead_event_outbox (id,event_type,payload,status,created_at) VALUES ('${id}','lead.created','${payload.replace(/'/g, "''")}','published','${now}');`,
);
console.log(`✅ 插入 lead.created 事件 ${id}`);

// 2. 等 35s，让 relay（每 30s）跑一轮
console.log('⏳ 等待 relay 跑一轮（35s）...');
await new Promise((r) => setTimeout(r, 35000));

// 3. 查 status
const status = run(`SELECT status FROM lead_event_outbox WHERE id='${id}';`);
if (status === 'published') {
  console.log('✅ lead.created 保留 published（未被假消费）');
} else {
  console.log(`❌ lead.created 被标记为 ${status}（假消费未修复）`);
  process.exitCode = 1;
}

// 4. 清理
run(`DELETE FROM lead_event_outbox WHERE id='${id}';`);
console.log('已清理测试事件');
