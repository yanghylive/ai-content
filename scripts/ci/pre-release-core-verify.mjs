// 本次发版核心验证：灰度遮罩 10 页 + 首页 AI 简报卡 + 获客页
import { createRequire } from 'node:module';
const require = createRequire('/Users/yanghy/Documents/New project/ai-content/backend/');
const { chromium } = require('playwright');
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3010';
const TOKEN = fs.readFileSync('/tmp/electron-test-token.txt', 'utf8').trim();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: 'ai_content_session', value: TOKEN, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// 灰度遮罩页抽查（6 个代表）
// 2026-08-29：企业微信助手 8/24 路由收敛后已从灰度转正（/wecom-assistant 重定向
// 到 /engagement/wecom-assistant 功能页，无遮罩），从抽查清单移除，换成 /mobile-capabilities
for (const [name, route] of [
  ['BOSS 直聘', '/boss-recruit'],
  ['移动端能力', '/mobile-capabilities'],
  ['省钱比价', '/savings'],
  ['视频引擎', '/video-workshop'],
  ['朋友圈发布', '/engagement/wechat/moments-publish'],
  ['视频工作室', '/video-studio'],
]) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => document.body.innerText);
  check(`${name}遮罩`, !page.url().includes('/login') && (t.includes('灰度') || t.includes('暂未开放') || t.includes('即将上线')), page.url().split('3010')[1] + (t.includes('灰度') ? ' 有灰度文案' : ''));
}

// 获客首页：AI 简报卡
await page.goto(`${BASE}/growth`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);
const growthText = await page.evaluate(() => document.body.innerText);
check('获客首页 AI 简报卡', growthText.includes('AI 简报') || growthText.includes('今日 AI'), '');
check('获客首页 AI 价值', growthText.includes('价值') || growthText.includes('折算人工'), '');

// 创建任务页记忆预填提示
await page.goto(`${BASE}/apps/auto-acquisition`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);
const acqText = await page.evaluate(() => document.body.innerText);
check('自动获客页可达', !page.url().includes('/login') && !acqText.includes('服务器内部错误'), page.url().split('3010')[1]);

await browser.close();
console.log(`\n=== 发版核心验证: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
