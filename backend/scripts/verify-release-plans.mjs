// 验证 listReleasePlans 修复：读 runtimeJson（而非不存在的 envelope）能正确返回定时发布计划。
// 用法：node scripts/verify-release-plans.mjs（需后端 3011 已启动）
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const DB = `${process.env.HOME}/Library/Application Support/ai-content-desktop/kaypal-ai.sqlite`;
const BASE = 'http://127.0.0.1:3011';
const run = (sql) =>
  execSync(`sqlite3 "${DB}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();

const ok = (name, detail) => console.log(`✅ ${name}${detail ? ` —— ${detail}` : ''}`);
const bad = (name, detail) => {
  console.log(`❌ ${name} —— ${detail}`);
  process.exitCode = 1;
};

// 1. 造 session
const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
const hash = createHash('sha256').update(token).digest('hex');
const sid = 'wbtest_' + randomUUID().slice(0, 12);
const now = new Date().toISOString();
const exp = new Date(Date.now() + 86400000).toISOString();
const meta = JSON.stringify({
  source: 'wbtest',
  localOnly: true,
  kaypalSubscriptionPlan: 'ADVANCED',
  kaypalRole: 'SUPER_ADMIN',
  kaypalPlatformRole: 'SUPER_ADMIN',
  kaypalPermissionNames: ['console_quality_scan'],
});
run(
  `INSERT INTO user_sessions (id,user_id,token_hash,expires_at,last_used_at,metadata,created_at,updated_at) VALUES ('${sid}','cmsmjmskh01xwi5opfmpmu30n','${hash}','${exp}','${now}','${meta}','${now}','${now}');`,
);
const cookie = `ai_content_session=${token}`;

// 2. 插一条 enableTimer=1 的定时发布记录（模拟真实结构）
const execId = 'e2e-plan-' + randomUUID().slice(0, 8);
const runtimeJson = JSON.stringify({
  source: 'durable_publish_record',
  version: 1,
  title: '定时发布验证-视频A',
  platformType: 3,
  accountFile: '',
  fileList: [],
  tags: [],
  dryRun: false,
  payloads: [
    {
      type: 3,
      title: '定时发布验证-视频A',
      tags: [],
      fileList: [],
      accountList: [],
      enableTimer: 1,
      scheduleTime: '2026-08-20T10:00:00.000Z',
      accountIdentity: { platform: 'douyin' },
    },
  ],
  result: { platforms: [], summary: { total: 0 } },
  engineTaskIds: [],
  createdAt: now,
  updatedAt: now,
});
run(
  `INSERT INTO runtime_executions (id,tenant_id,user_id,relatedId,relatedType,executor,platform,taskType,ok,status,reasonCode,userMessage,runtimeJson,evidenceJson,createdAt,updated_at) VALUES ('${execId}','legacy-local-desktop','cmsmjmskh01xwi5opfmpmu30n','rel-1','video','local','douyin','auto-upload-publish-record-v1',1,'waiting','ok','ok','${runtimeJson.replace(/'/g, "''")}','[]','${now}','${now}');`,
);
ok('插入定时发布测试数据', execId);

// 3. 调接口
const resp = await fetch(`${BASE}/api/video/release-plans`, {
  headers: { Cookie: cookie },
});
const body = await resp.json();
const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;
if (resp.status !== 200) {
  bad('GET /api/video/release-plans', `status=${resp.status}`);
} else if (!list) {
  bad('返回不含 data 数组', JSON.stringify(body).slice(0, 120));
} else {
  const hit = list.find((p) => p.id === execId);
  if (!hit) {
    bad('接口未返回刚插入的定时计划', `返回 ${list.length} 条`);
  } else {
    ok('接口返回定时计划', `title=${hit.title}`);
    ok('scheduled 判定', String(hit.scheduled));
    ok('scheduleTime 提取', String(hit.scheduleTime));
    ok('platforms 提取', JSON.stringify(hit.platforms));
  }
}

// 4. 清理
run(`DELETE FROM runtime_executions WHERE id='${execId}'; DELETE FROM user_sessions WHERE id='${sid}';`);
console.log('已清理测试数据');
